"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { captureSnapshot } from "@/lib/capture";
import { createClient } from "@/lib/supabase/server";
import type { Tracker, TrackerStatus } from "@/lib/types";

/** What every tracker action returns to the client. */
export type TrackerActionResult = { ok: true } | { ok: false; error: string };

type UserClient = Awaited<ReturnType<typeof createClient>>;
type OwnedTracker = Pick<Tracker, "id" | "status" | "day_count" | "days_target" | "keep_tracking">;

const DAY_MS = 24 * 60 * 60 * 1000;
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
    .select("id, status, day_count, days_target, keep_tracking")
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

/** Applies an owner update through RLS and refreshes the dashboard and keyword page. */
async function updateTracker(
  supabase: UserClient,
  trackerId: string,
  values: Partial<Tracker>,
): Promise<TrackerActionResult> {
  const { error } = await supabase.from("trackers").update(values).eq("id", trackerId);
  if (error) {
    console.error("tracker update failed", trackerId, error.message);
    return fail("We couldn't save that change. Please try again.");
  }
  revalidateTracker(trackerId);
  return { ok: true };
}

/** Stops the daily capture. Only a tracking, ready or analyzed keyword can be paused. */
export async function pauseTracker(trackerId: string): Promise<TrackerActionResult> {
  const { supabase, tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;
  if (!PAUSABLE.includes(tracker.status)) return fail("This keyword can't be paused right now.");
  return updateTracker(supabase, trackerId, { status: "paused" });
}

/** Restarts a paused keyword: back to tracking, or to ready/analyzed when all days are in. Captures again right away. */
export async function resumeTracker(trackerId: string): Promise<TrackerActionResult> {
  const { supabase, tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;
  if (tracker.status !== "paused") return fail("This keyword isn't paused.");

  let status: TrackerStatus = "tracking";
  if (tracker.day_count >= tracker.days_target) {
    const { data: analysis } = await supabase
      .from("analyses")
      .select("id")
      .eq("tracker_id", trackerId)
      .eq("status", "done")
      .limit(1)
      .maybeSingle();
    status = analysis ? "analyzed" : "ready";
  }

  return updateTracker(supabase, trackerId, {
    status,
    next_capture_at: new Date().toISOString(),
  });
}

/** Turns "keep tracking after publish" on or off. Turning it on schedules the next capture for tomorrow. */
export async function setKeepTracking(trackerId: string, on: boolean): Promise<TrackerActionResult> {
  const { supabase, tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;

  const values: Partial<Tracker> = { keep_tracking: on };
  if (on) values.next_capture_at = new Date(Date.now() + DAY_MS).toISOString();
  return updateTracker(supabase, trackerId, values);
}

/** Deletes the keyword and, through the database cascade, every snapshot, report and draft under it. */
export async function deleteTracker(trackerId: string): Promise<TrackerActionResult> {
  const { supabase, tracker } = await loadOwned(trackerId);
  if (!tracker) return NOT_FOUND;

  const { error } = await supabase.from("trackers").delete().eq("id", trackerId);
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
