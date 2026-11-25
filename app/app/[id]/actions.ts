"use server";

import { revalidatePath } from "next/cache";
import { restingStatus } from "@/lib/analyze";
import { requireUser } from "@/lib/auth";
import { getAccount, refundKeywordCharge } from "@/lib/billing";
import { captureSnapshot } from "@/lib/capture";
import { CREDIT_COSTS, isPlanActive, keepTrackingLimit } from "@/lib/plans";
import { nextCaptureAt } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Tracker, TrackerStatus } from "@/lib/types";

/** What every tracker action returns to the client. `upgrade`: the fix is on the billing page. */
export type TrackerActionResult = { ok: true } | { ok: false; error: string; upgrade?: boolean };

type UserClient = Awaited<ReturnType<typeof createClient>>;
type OwnedTracker = Pick<
  Tracker,
  "id" | "user_id" | "billing_source" | "status" | "day_count" | "days_target" | "keep_tracking" | "next_capture_at"
>;

const NOT_FOUND: TrackerActionResult = { ok: false, error: "We couldn't find that keyword." };
const PAUSABLE: TrackerStatus[] = ["tracking", "ready", "analyzed"];

function fail(error: string): TrackerActionResult {
  return { ok: false, error };
}

/** Loads the tracker as the signed-in user; RLS returns null for anything they do not own. */
async function loadOwned(trackerId: string): Promise<{ supabase: UserClient; tracker: OwnedTracker | null }> {
  await requireUser(`/app/${trackerId}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trackers")
    .select("id, user_id, billing_source, status, day_count, days_target, keep_tracking, next_capture_at")
    .eq("id", trackerId)
    .maybeSingle();
  if (error) {
    console.error("tracker ownership check failed", error.message);
    return { supabase, tracker: null };
  }
  return { supabase, tracker: (data as OwnedTracker | null) ?? null };
}

function revalidateTracker(trackerId: string): void {
  revalidatePath("/app");
  revalidatePath(`/app/${trackerId}`);
}

/**
 * Applies an update to a keyword the caller was just shown to own (loadOwned),
 * then refreshes the dashboard and keyword page. Uses the service role:
 * browsers can't change keywords directly, because some fields decide what is
 * paid for.
 */
async function updateTracker(trackerId: string, values: Partial<Tracker>): Promise<TrackerActionResult> {
  const { error } = await createAdminClient().from("trackers").update(values).eq("id", trackerId);
  if (error) {
    console.error("tracker update failed", trackerId, error.message);
    return fail("We couldn't save that change. Please try again.");
  }
  revalidateTracker(trackerId);
  return { ok: true };
}

/** Stops the daily capture. Only a tracking, ready or analyzed keyword can be paused. */
export async function pauseTracker(trackerId: string): Promise<TrackerActionResult> {
  const { tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;
  if (!PAUSABLE.includes(tracker.status)) return fail("This keyword can't be paused right now.");
  return updateTracker(trackerId, { status: "paused" });
}

/**
 * Restarts a paused keyword: back to analyzed when it has a report (it keeps capturing until all
 * days are in), else to ready when all days are in, else to tracking. Captures again right away.
 */
export async function resumeTracker(trackerId: string): Promise<TrackerActionResult> {
  const { supabase, tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;
  if (tracker.status !== "paused") return fail("This keyword isn't paused.");

  const { data: analysis } = await supabase
    .from("analyses")
    .select("id")
    .eq("tracker_id", trackerId)
    .eq("status", "done")
    .limit(1)
    .maybeSingle();

  return updateTracker(trackerId, {
    status: restingStatus(tracker, Boolean(analysis)),
    next_capture_at: new Date().toISOString(),
  });
}

/**
 * Turns "keep tracking after publish" on or off. Turning it on makes the next
 * daily run capture again; a capture that is already scheduled is never pushed later.
 */
export async function setKeepTracking(trackerId: string, on: boolean): Promise<TrackerActionResult> {
  const { tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;

  if (on && !tracker.keep_tracking) {
    const blocked = await keepTrackingBlocked(tracker);
    if (blocked) return blocked;
  }

  const values: Partial<Tracker> = { keep_tracking: on };
  const due = tracker.next_capture_at ? new Date(tracker.next_capture_at).getTime() : null;
  if (on && (due === null || due <= Date.now())) values.next_capture_at = nextCaptureAt().toISOString();
  return updateTracker(trackerId, values);
}

/**
 * Why this keyword can't be kept tracked, or null when it can. On the app's
 * keys it needs an active plan with a free keep-tracking slot; on your own keys
 * the fair-use limit applies.
 */
async function keepTrackingBlocked(tracker: OwnedTracker): Promise<TrackerActionResult | null> {
  const admin = createAdminClient();
  const source = tracker.billing_source ?? "platform";
  const account = await getAccount(tracker.user_id, admin);
  if (source === "platform" && !isPlanActive(account)) {
    return { ok: false, error: "Keeping a page tracked on our keys needs a plan.", upgrade: true };
  }
  const limit = keepTrackingLimit(account.plan, source);
  if (!Number.isFinite(limit)) return null;

  const { data, error } = await admin
    .from("trackers")
    .select("id")
    .eq("user_id", tracker.user_id)
    .eq("billing_source", source)
    .eq("keep_tracking", true)
    .neq("status", "paused")
    .neq("id", tracker.id);
  if (error) {
    console.error("keep tracking count failed", error.message);
    return fail("We couldn't save that change. Please try again.");
  }
  if ((data ?? []).length < limit) return null;
  return source === "platform"
    ? {
        ok: false,
        error: `Your plan keeps ${limit} published ${limit === 1 ? "page" : "pages"} tracked. Turn one off, or move to a bigger plan.`,
        upgrade: true,
      }
    : { ok: false, error: `You can keep ${limit} pages tracked on your own keys. Turn one off first.` };
}

/**
 * Deletes the keyword and, through the database cascade, every snapshot,
 * report and draft under it. A keyword on the app's keys that never got a
 * capture gives its credits back first.
 */
export async function deleteTracker(trackerId: string): Promise<TrackerActionResult> {
  const { tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;

  const admin = createAdminClient();
  if (tracker.billing_source !== "own_keys" && tracker.day_count === 0) {
    try {
      await refundKeywordCharge({
        userId: tracker.user_id,
        trackerId,
        amount: CREDIT_COSTS.newKeyword,
        why: "deleted",
        admin,
      });
    } catch (err) {
      console.error("keyword refund failed", trackerId, err instanceof Error ? err.message : err);
      return fail("We couldn't delete that keyword. Please try again.");
    }
  }

  const { error } = await admin.from("trackers").delete().eq("id", trackerId);
  if (error) {
    console.error("tracker delete failed", trackerId, error.message);
    return fail("We couldn't delete that keyword. Please try again.");
  }
  revalidatePath("/app");
  return { ok: true };
}

/** Runs the day-1 capture again after it failed. captureSnapshot records the outcome on the tracker either way. */
export async function retryFirstCapture(trackerId: string): Promise<TrackerActionResult> {
  const { tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;
  if (tracker.status !== "error") return fail("Today's capture already worked for this keyword.");

  try {
    await captureSnapshot(trackerId, { dayNumber: 1 });
  } catch (err) {
    console.error("day-1 retry failed", trackerId, err instanceof Error ? err.message : err);
    revalidateTracker(trackerId);
    return fail("The capture didn't work this time. Wait a minute and try again.");
  }
  revalidateTracker(trackerId);
  return { ok: true };
}
