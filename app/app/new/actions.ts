"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  assertPlatformBudget,
  BillingError,
  chargeCredits,
  getAccount,
  insufficientCreditsError,
  planRequiredError,
} from "@/lib/billing";
import { captureSnapshot } from "@/lib/capture";
import { loadOwnKeysStatus } from "@/lib/own-keys";
import { CREDIT_COSTS, isPlanActive, OWN_KEYS_LIMITS } from "@/lib/plans";
import { nextCaptureAt } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_DAYS_TARGET, LANGUAGES, LOCATIONS, type Tracker } from "@/lib/types";
import { normalizeDomain } from "@/lib/utils";

/** What the form gets back when the keyword could not be created. On success the action redirects instead. */
export interface CreateTrackerState {
  error: string;
  /** The fix is a plan or more credits: the form links to the billing page. */
  upgrade?: boolean;
  /** The fix is saving your own keys: the form links to Settings. */
  settings?: boolean;
}

const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const formSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(2, "Type the search you want to win. At least 2 characters.")
    .max(200, "Keep the search under 200 characters."),
  location_code: z.coerce
    .number()
    .int()
    .refine((code) => LOCATIONS.some((l) => l.code === code), "Pick a country from the list."),
  language_code: z
    .string()
    .refine((code) => LANGUAGES.some((l) => l.code === code), "Pick a language from the list."),
  target_domain: z
    .string()
    .trim()
    .max(253, "That website address is too long.")
    .transform((value) => normalizeDomain(value))
    .refine(
      (domain) => domain === null || DOMAIN_PATTERN.test(domain),
      "Enter your website like example.com, or leave it blank.",
    ),
  user_edge: z
    .string()
    .trim()
    .max(2000, "Keep your edge under 2,000 characters.")
    .transform((value) => (value.length > 0 ? value : null)),
  competitor_policy: z.enum(["avoid", "compare"]).catch("avoid"),
  /** "platform": our keys, paid with plan credits. "own_keys": the user's own API keys, free. */
  billing_source: z.enum(["platform", "own_keys"]).catch("platform"),
});

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Keywords on the user's own keys that are still in their 7-day study (the fair-use limit counts these). */
async function countOwnKeyStudies(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<number> {
  const { data, error } = await admin
    .from("trackers")
    .select("id, day_count, days_target, status")
    .eq("user_id", userId)
    .eq("billing_source", "own_keys");
  if (error) throw new Error(error.message);
  type Row = Pick<Tracker, "day_count" | "days_target" | "status">;
  const inStudy = ((data ?? []) as Row[]).filter(
    (t) => t.day_count < t.days_target && t.status !== "paused" && t.status !== "error",
  );
  return inStudy.length;
}

/**
 * Server action for useActionState: validates the form, checks how the keyword
 * is paid for (credits on a plan, or the user's own keys), saves it, takes the
 * credits, captures day 1 right away, then redirects to the keyword page.
 */
export async function createTrackerAction(
  _prev: CreateTrackerState | null,
  formData: FormData,
): Promise<CreateTrackerState> {
  const user = await requireUser("/app/new");

  const parsed = formSchema.safeParse({
    keyword: field(formData, "keyword"),
    location_code: field(formData, "location_code"),
    language_code: field(formData, "language_code"),
    target_domain: field(formData, "target_domain"),
    user_edge: field(formData, "user_edge"),
    competitor_policy: field(formData, "competitor_policy") || "avoid",
    billing_source: field(formData, "billing_source") || "platform",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const input = parsed.data;
  const location = LOCATIONS.find((l) => l.code === input.location_code);
  if (!location) return { error: "Pick a country from the list." };

  // Who pays: the user's own keys (checked and within fair use) or plan credits.
  const admin = createAdminClient();
  const account = await getAccount(user.id, admin);
  if (input.billing_source === "own_keys") {
    const keys = await loadOwnKeysStatus(user.id, admin);
    if (!keys.complete) {
      return {
        error: "Save your DataForSEO login and Anthropic key in Settings first, or run this keyword on a plan.",
        settings: true,
      };
    }
    if ((await countOwnKeyStudies(admin, user.id)) >= OWN_KEYS_LIMITS.activeStudies) {
      return {
        error: `You can run ${OWN_KEYS_LIMITS.activeStudies} keywords at once on your own keys. Wait for one to finish its 7 days, or pause one.`,
      };
    }
  } else {
    // A quick check before saving anything; the charge below is the atomic one.
    if (account.plan !== "staff") {
      if (!isPlanActive(account)) {
        const err = planRequiredError();
        return { error: err.message, upgrade: true };
      }
      if (account.credits_balance < CREDIT_COSTS.newKeyword) {
        const err = insufficientCreditsError(CREDIT_COSTS.newKeyword, account.credits_balance);
        return { error: err.message, upgrade: true };
      }
    }
    try {
      await assertPlatformBudget(account, admin);
    } catch (err) {
      if (err instanceof BillingError) return { error: err.message, upgrade: err.upgrade };
      throw err;
    }
  }

  // Keywords are created with the service role: browsers can't write them directly (credits).
  const { data, error } = await admin
    .from("trackers")
    .insert({
      user_id: user.id,
      keyword: input.keyword,
      location_code: location.code,
      location_name: location.name,
      language_code: input.language_code,
      device: "desktop",
      target_domain: input.target_domain,
      user_edge: input.user_edge,
      competitor_policy: input.competitor_policy,
      billing_source: input.billing_source,
      status: "tracking",
      days_target: DEFAULT_DAYS_TARGET,
      day_count: 0,
      next_capture_at: nextCaptureAt().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("tracker insert failed", error?.message);
    return { error: "We could not save your keyword. Please try again." };
  }
  const trackerId = (data as Pick<Tracker, "id">).id;

  if (input.billing_source === "platform") {
    try {
      await chargeCredits({
        account,
        amount: CREDIT_COSTS.newKeyword,
        reason: "new_keyword",
        trackerId,
        note: input.keyword,
        admin,
      });
    } catch (err) {
      // Not paid for: take the keyword back out.
      await admin.from("trackers").delete().eq("id", trackerId);
      if (err instanceof BillingError) return { error: err.message, upgrade: err.upgrade };
      console.error("keyword charge failed", err instanceof Error ? err.message : err);
      return { error: "We couldn't use your credits. Please try again." };
    }
  }

  try {
    await captureSnapshot(trackerId, { dayNumber: 1 });
  } catch (err) {
    // captureSnapshot already set status "error" and last_error on the tracker;
    // the keyword page shows the problem and offers a retry.
    console.error("day-1 capture failed", trackerId, err instanceof Error ? err.message : err);
  }

  revalidatePath("/app");
  redirect(`/app/${trackerId}`);
}

/** Contract form for a plain `<form action={createTracker}>`: same behavior as createTrackerAction. */
export async function createTracker(formData: FormData): Promise<CreateTrackerState> {
  return createTrackerAction(null, formData);
}
