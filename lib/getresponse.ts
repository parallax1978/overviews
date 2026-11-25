/**
 * Adds people who sign up to the owner's GetResponse list (GETRESPONSE_LIST_ID,
 * tagged GETRESPONSE_TAG_ID), once per user. Off until GETRESPONSE_API_KEY and
 * GETRESPONSE_LIST_ID are set. Server only.
 * Docs: https://apireference.getresponse.com/ (POST /contacts answers 202, or
 * 409 when the email is already on the list).
 */
import { logApiCall } from "@/lib/api-log";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const API = "https://api.getresponse.com/v3";
const TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GetResponseConfig {
  apiKey: string;
  listId: string;
  tagId: string | null;
}

export function getResponseConfig(): GetResponseConfig | null {
  const apiKey = serverEnv.getresponseApiKey;
  const listId = serverEnv.getresponseListId;
  return apiKey && listId ? { apiKey, listId, tagId: serverEnv.getresponseTagId } : null;
}

/** Addresses that are never real signups: the app's own throwaway test accounts. */
export function isTestAddress(email: string): boolean {
  return /@example\.(com|org|net)$/i.test(email.trim());
}

async function call(config: GetResponseConfig, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  return fetchImpl(`${API}${path}`, {
    ...init,
    headers: { "X-Auth-Token": `api-key ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Puts the email on the list with the tag; autoresponders on the list start
 * at day 0. When the email is already on the list, just adds the tag.
 */
export async function addContact(
  config: GetResponseConfig,
  email: string,
  fetchImpl: FetchLike = fetch,
): Promise<"added" | "already_on_list"> {
  const tags = config.tagId ? [{ tagId: config.tagId }] : undefined;
  const created = await call(
    config,
    "/contacts",
    { method: "POST", body: JSON.stringify({ email, campaign: { campaignId: config.listId }, dayOfCycle: 0, ...(tags ? { tags } : {}) }) },
    fetchImpl,
  );
  if (created.status === 202 || created.status === 201) return "added";
  if (created.status !== 409) {
    throw new Error(`GetResponse answered ${created.status}: ${(await created.text()).slice(0, 200)}`);
  }

  // Already on the list: make sure it carries the tag too.
  if (tags) {
    const query = `?query[email]=${encodeURIComponent(email)}&fields=contactId`;
    const found = await call(config, `/campaigns/${config.listId}/contacts${query}`, { method: "GET" }, fetchImpl);
    const contacts = found.ok ? ((await found.json()) as { contactId?: string }[]) : [];
    const contactId = contacts[0]?.contactId;
    if (contactId) {
      const tagged = await call(config, `/contacts/${contactId}/tags`, { method: "POST", body: JSON.stringify({ tags }) }, fetchImpl);
      if (!tagged.ok) throw new Error(`GetResponse tag answered ${tagged.status}`);
    }
  }
  return "already_on_list";
}

/**
 * Adds a signed-in user to the GetResponse list the first time it is called
 * for them (accounts.marketing_synced_at), and never again. Safe to call on
 * every page load: a claim on the account row stops two requests from both
 * adding the user, and a failure is retried on the next visit. Never throws.
 */
export async function addUserToMailingList(user: { id: string; email: string | null }): Promise<void> {
  const config = getResponseConfig();
  if (!config || !user.email || isTestAddress(user.email)) return;

  const admin = createAdminClient();
  const now = new Date().toISOString();
  try {
    await admin.from("accounts").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
    const { data: claimed, error: claimError } = await admin
      .from("accounts")
      .update({ marketing_synced_at: now })
      .eq("user_id", user.id)
      .is("marketing_synced_at", null)
      .select("user_id");
    if (claimError || !claimed?.length) return;
  } catch (err) {
    console.error("mailing list claim failed", err instanceof Error ? err.message : err);
    return;
  }

  const startedAt = Date.now();
  try {
    const outcome = await addContact(config, user.email);
    await logApiCall(admin, {
      provider: "getresponse",
      endpoint: "contacts",
      status: outcome === "added" ? 202 : 409,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      user_id: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("getresponse add failed", message);
    await logApiCall(admin, {
      provider: "getresponse",
      endpoint: "contacts",
      status: null,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: message.slice(0, 200),
      user_id: user.id,
    });
    // Let the next visit try again.
    await admin.from("accounts").update({ marketing_synced_at: null }).eq("user_id", user.id);
  }
}
