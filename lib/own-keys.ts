/**
 * A user's own DataForSEO and Anthropic keys. They are checked before they are
 * saved, stored encrypted (lib/crypto.ts), never sent back to the browser, and
 * used for every API call of the keywords that run on the user's own keys.
 * Server only (it uses the service-role client, which is guarded by
 * server-only), so callers must already know who the user is.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logApiCall } from "@/lib/api-log";
import { checkAnthropicKey, type AnthropicCredentials } from "@/lib/claude";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import {
  checkDataForSeoAccount,
  DATAFORSEO_ACCOUNT_ENDPOINT,
  DataForSeoError,
  platformDataForSeoCredentials,
  type DataForSeoCredentials,
} from "@/lib/dataforseo";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OwnKeysStatus, Tracker } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;
type KeywordBilling = Pick<Tracker, "user_id" | "billing_source">;

interface KeysRow {
  user_id: string;
  dataforseo_login_enc: string | null;
  dataforseo_password_enc: string | null;
  dataforseo_hint: string | null;
  dataforseo_checked_at: string | null;
  anthropic_key_enc: string | null;
  anthropic_workspace_id: string | null;
  anthropic_hint: string | null;
  anthropic_checked_at: string | null;
}

/** A keyword runs on the owner's keys but one of them is not saved (or can no longer be read). */
export class OwnKeysMissingError extends Error {
  constructor(which: "dataforseo" | "anthropic") {
    super(
      which === "dataforseo"
        ? "This keyword runs on your own keys, but your DataForSEO login isn't saved. Add it in Settings."
        : "This keyword runs on your own keys, but your Anthropic API key isn't saved. Add it in Settings.",
    );
    this.name = "OwnKeysMissingError";
  }
}

async function loadRow(admin: Admin, userId: string): Promise<KeysRow | null> {
  const { data, error } = await admin.from("user_api_keys").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not load your saved keys: ${error.message}`);
  return (data as KeysRow | null) ?? null;
}

/** What the settings page may show. Contains no secret. Pure. */
export function ownKeysStatusFromRow(row: KeysRow | null): OwnKeysStatus {
  const dataforseoSaved = Boolean(row?.dataforseo_login_enc && row.dataforseo_password_enc);
  const anthropicSaved = Boolean(row?.anthropic_key_enc);
  return {
    dataforseo: {
      saved: dataforseoSaved,
      hint: dataforseoSaved ? (row?.dataforseo_hint ?? null) : null,
      checkedAt: dataforseoSaved ? (row?.dataforseo_checked_at ?? null) : null,
    },
    anthropic: {
      saved: anthropicSaved,
      hint: anthropicSaved ? (row?.anthropic_hint ?? null) : null,
      workspaceId: anthropicSaved ? (row?.anthropic_workspace_id ?? null) : null,
      checkedAt: anthropicSaved ? (row?.anthropic_checked_at ?? null) : null,
    },
    complete: dataforseoSaved && anthropicSaved,
  };
}

export async function loadOwnKeysStatus(userId: string, admin: Admin = createAdminClient()): Promise<OwnKeysStatus> {
  return ownKeysStatusFromRow(await loadRow(admin, userId));
}

/** The DataForSEO login a keyword's captures use: the app's, or the owner's own. */
export async function dataforseoCredentialsFor(
  tracker: KeywordBilling,
  admin: Admin = createAdminClient(),
): Promise<DataForSeoCredentials> {
  if (tracker.billing_source !== "own_keys") return platformDataForSeoCredentials();
  const row = await loadRow(admin, tracker.user_id);
  if (!row?.dataforseo_login_enc || !row.dataforseo_password_enc) throw new OwnKeysMissingError("dataforseo");
  try {
    return {
      login: decryptSecret(row.dataforseo_login_enc, tracker.user_id),
      password: decryptSecret(row.dataforseo_password_enc, tracker.user_id),
    };
  } catch {
    throw new OwnKeysMissingError("dataforseo");
  }
}

/** The Anthropic key a keyword's report and pages use: null means the app's own key. */
export async function anthropicCredentialsFor(
  tracker: KeywordBilling,
  admin: Admin = createAdminClient(),
): Promise<AnthropicCredentials | null> {
  if (tracker.billing_source !== "own_keys") return null;
  const row = await loadRow(admin, tracker.user_id);
  if (!row?.anthropic_key_enc) throw new OwnKeysMissingError("anthropic");
  try {
    return { apiKey: decryptSecret(row.anthropic_key_enc, tracker.user_id), workspaceId: row.anthropic_workspace_id };
  } catch {
    throw new OwnKeysMissingError("anthropic");
  }
}

export type SaveKeysResult = { ok: true; message: string } | { ok: false; error: string };

/** "jo•••@example.com": enough to recognise the login, not to reuse it. */
export function maskLogin(login: string): string {
  const value = login.trim();
  const at = value.indexOf("@");
  if (at > 0) return `${value.slice(0, Math.min(2, at))}•••${value.slice(at)}`;
  return value.length <= 4 ? "••••" : `${value.slice(0, 2)}•••${value.slice(-2)}`;
}

function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Checks a DataForSEO API login with the free account endpoint, then saves it encrypted. */
export async function saveDataForSeoKeys(userId: string, login: string, password: string): Promise<SaveKeysResult> {
  const credentials = { login: login.trim(), password: password.trim() };
  if (!credentials.login || !credentials.password) {
    return { ok: false, error: "Enter both your DataForSEO API login and API password." };
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  let balanceUsd: number | null;
  try {
    ({ balanceUsd } = await checkDataForSeoAccount(credentials));
    await logApiCall(admin, {
      provider: "dataforseo",
      endpoint: DATAFORSEO_ACCOUNT_ENDPOINT,
      status: 200,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      billing_source: "own_keys",
      user_id: userId,
    });
  } catch (err) {
    const status = err instanceof DataForSeoError && err.statusCode > 0 ? err.statusCode : null;
    await logApiCall(admin, {
      provider: "dataforseo",
      endpoint: DATAFORSEO_ACCOUNT_ENDPOINT,
      status,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      billing_source: "own_keys",
      user_id: userId,
    });
    if (err instanceof DataForSeoError && err.statusCode === 0) {
      return { ok: false, error: "We couldn't reach DataForSEO. Try again in a minute." };
    }
    return {
      ok: false,
      error:
        "DataForSEO didn't accept that login. Use the API login and API password from the API Access page of your DataForSEO dashboard, not your website password.",
    };
  }

  const { error } = await admin.from("user_api_keys").upsert(
    {
      user_id: userId,
      dataforseo_login_enc: encryptSecret(credentials.login, userId),
      dataforseo_password_enc: encryptSecret(credentials.password, userId),
      dataforseo_hint: maskLogin(credentials.login),
      dataforseo_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("dataforseo key save failed", error.message);
    return { ok: false, error: "We couldn't save your login. Please try again." };
  }

  if (balanceUsd === null) return { ok: true, message: "Saved. Your DataForSEO login works." };
  if (balanceUsd <= 0) {
    return {
      ok: true,
      message: `Saved, but your DataForSEO balance is ${usd(balanceUsd)}. Add funds there before you start a keyword.`,
    };
  }
  return { ok: true, message: `Saved. Your DataForSEO balance is ${usd(balanceUsd)}.` };
}

/** Plain-English reason an Anthropic key check failed. */
function anthropicKeyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Anthropic didn't accept that key. Check that you copied all of it.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "That key isn't allowed to use Claude Opus 5.5. Check the key's workspace in the Claude Console.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "That key can't see Claude Opus 5.5, which writes your reports and pages. Use a key from a workspace that has it.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Anthropic said: ${err.message}`.slice(0, 300);
  }
  if (err instanceof Anthropic.RateLimitError) return "Anthropic is busy right now. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "We couldn't reach Anthropic. Try again in a minute.";
  return "We couldn't check that key. Try again in a minute.";
}

/**
 * Checks an Anthropic API key against the Models API (free), then saves it
 * encrypted, with the workspace id when the user gave one (some personal
 * sk-ant-usr- keys need it to say which workspace pays).
 */
export async function saveAnthropicKey(
  userId: string,
  apiKey: string,
  workspaceId: string | null,
): Promise<SaveKeysResult> {
  const credentials: AnthropicCredentials = { apiKey: apiKey.trim(), workspaceId: workspaceId?.trim() || null };
  if (!credentials.apiKey) return { ok: false, error: "Paste your Anthropic API key." };

  const admin = createAdminClient();
  const startedAt = Date.now();
  try {
    await checkAnthropicKey(credentials);
    await logApiCall(admin, {
      provider: "anthropic",
      endpoint: "models:retrieve",
      status: 200,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      billing_source: "own_keys",
      user_id: userId,
    });
  } catch (err) {
    await logApiCall(admin, {
      provider: "anthropic",
      endpoint: "models:retrieve",
      status: err instanceof Anthropic.APIError && typeof err.status === "number" ? err.status : null,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      billing_source: "own_keys",
      user_id: userId,
    });
    return { ok: false, error: anthropicKeyError(err) };
  }

  const { error } = await admin.from("user_api_keys").upsert(
    {
      user_id: userId,
      anthropic_key_enc: encryptSecret(credentials.apiKey, userId),
      anthropic_workspace_id: credentials.workspaceId,
      anthropic_hint: secretHint(credentials.apiKey),
      anthropic_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("anthropic key save failed", error.message);
    return { ok: false, error: "We couldn't save your key. Please try again." };
  }
  return { ok: true, message: "Saved. Your key can use Claude Opus 5.5." };
}

/** Deletes one saved key. Keywords on your own keys stop until it is added again. */
export async function removeOwnKey(userId: string, which: "dataforseo" | "anthropic"): Promise<void> {
  const admin = createAdminClient();
  const values =
    which === "dataforseo"
      ? { dataforseo_login_enc: null, dataforseo_password_enc: null, dataforseo_hint: null, dataforseo_checked_at: null }
      : { anthropic_key_enc: null, anthropic_workspace_id: null, anthropic_hint: null, anthropic_checked_at: null };
  const { error } = await admin
    .from("user_api_keys")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not remove the key: ${error.message}`);
}
