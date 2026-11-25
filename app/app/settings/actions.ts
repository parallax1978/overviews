"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { removeOwnKey, saveAnthropicKey, saveDataForSeoKeys } from "@/lib/own-keys";

/** What a key form shows after it was sent. */
export interface KeyFormState {
  ok: boolean;
  message: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Checks the DataForSEO API login with DataForSEO, then saves it encrypted. */
export async function saveDataForSeoAction(_prev: KeyFormState | null, formData: FormData): Promise<KeyFormState> {
  const user = await requireUser("/app/settings");
  const result = await saveDataForSeoKeys(user.id, field(formData, "login"), field(formData, "password"));
  revalidatePath("/app/settings");
  return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
}

/** Checks the Anthropic API key with Anthropic, then saves it encrypted. */
export async function saveAnthropicAction(_prev: KeyFormState | null, formData: FormData): Promise<KeyFormState> {
  const user = await requireUser("/app/settings");
  const result = await saveAnthropicKey(user.id, field(formData, "api_key"), field(formData, "workspace_id") || null);
  revalidatePath("/app/settings");
  return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
}

/** Deletes one saved key (`which` = "dataforseo" or "anthropic"). */
export async function removeKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser("/app/settings");
  const which = field(formData, "which");
  if (which !== "dataforseo" && which !== "anthropic") return;
  await removeOwnKey(user.id, which);
  revalidatePath("/app/settings");
}
