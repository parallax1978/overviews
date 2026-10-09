/**
 * Pure scheduling rules for the daily capture. No IO, so they are unit tested
 * and safe to import anywhere.
 */
import type { Tracker } from "@/lib/types";

/**
 * When the next capture becomes due: the start of the next UTC calendar day.
 * The daily cron (06:00 UTC) then captures every tracker exactly once per day,
 * whatever time of day the previous capture ran.
 */
export function nextCaptureAt(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/** True when the cron should capture this tracker today. */
export function isCaptureDue(
  t: Pick<Tracker, "status" | "keep_tracking" | "day_count" | "days_target" | "next_capture_at">,
  now: Date,
): boolean {
  if (!t.next_capture_at || new Date(t.next_capture_at) > now) return false;
  if (t.status === "tracking") return true;
  if (t.status === "analyzed" || t.status === "ready") return t.keep_tracking || t.day_count < t.days_target;
  return false;
}
