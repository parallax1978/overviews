/**
 * Captures one AI Overview snapshot for a tracker and runs the daily batch.
 * Uses the service-role client: callers must have verified ownership first
 * (server actions) or be the secret-protected cron.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAnalysisAndDraft } from "@/lib/analyze";
import { logApiCall } from "@/lib/api-log";
import { DATAFORSEO_ENDPOINT, DataForSeoError, fetchSerpWithAiOverview } from "@/lib/dataforseo";
import { computeDiff } from "@/lib/diff";
import { normalizeAiOverview } from "@/lib/overview";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Snapshot, Tracker, TrackerStatus } from "@/lib/types";
import { domainMatches } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = "23505";
const DEFAULT_LIMIT = 200;
const DEFAULT_CONCURRENCY = 4;
/** Stop starting new work after this long so the 300s function returns cleanly. */
const TIME_BUDGET_MS = 240_000;

export interface CaptureRunSummary {
  captured: string[];
  failed: { trackerId: string; error: string }[];
  analyzed: string[];
  analysisFailed: { trackerId: string; error: string }[];
}

/**
 * Fetches today's SERP, stores the snapshot for `dayNumber` (default: the next
 * day) and advances the tracker. Logs the API call either way and rethrows on failure.
 */
export async function captureSnapshot(
  trackerId: string,
  opts?: { dayNumber?: number },
): Promise<{ snapshot: Snapshot; tracker: Tracker }> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  const dayNumber = opts?.dayNumber ?? tracker.day_count + 1;
  const startedAt = Date.now();
  let apiLogged = false;

  try {
    const result = await fetchSerpWithAiOverview({
      keyword: tracker.keyword,
      location_code: tracker.location_code,
      language_code: tracker.language_code,
      device: tracker.device,
    });
    apiLogged = true;
    await logApiCall(admin, {
      tracker_id: tracker.id,
      provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINT,
      status: 200,
      cost_usd: result.cost,
      duration_ms: Date.now() - startedAt,
    });
    return await storeSnapshot(admin, tracker, dayNumber, result);
  } catch (err) {
    const message = shortErrorMessage(err);
    if (!apiLogged) {
      await logApiCall(admin, {
        tracker_id: tracker.id,
        provider: "dataforseo",
        endpoint: DATAFORSEO_ENDPOINT,
        status: err instanceof DataForSeoError && err.statusCode > 0 ? err.statusCode : null,
        cost_usd: 0,
        duration_ms: Date.now() - startedAt,
        error: message,
      });
    }
    await markCaptureFailed(admin, tracker.id, dayNumber, message);
    throw err;
  }
}

/**
 * Captures every tracker whose next_capture_at has passed, four at a time,
 * and auto-runs the analysis for trackers that just reached their day target.
 */
export async function runDueCaptures(opts?: {
  now?: Date;
  limit?: number;
  concurrency?: number;
}): Promise<CaptureRunSummary> {
  const now = opts?.now ?? new Date();
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("trackers")
    .select("id, status, keep_tracking, day_count, days_target, next_capture_at")
    .lte("next_capture_at", now.toISOString())
    .or("status.eq.tracking,and(keep_tracking.eq.true,status.in.(analyzed,ready))")
    .order("next_capture_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load due trackers: ${error.message}`);

  const due = (data ?? []) as Pick<Tracker, "id" | "status">[];
  const summary: CaptureRunSummary = { captured: [], failed: [], analyzed: [], analysisFailed: [] };
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > TIME_BUDGET_MS;

  type Job = () => Promise<void>;
  const queue: Job[] = [];

  const analysisJob = (trackerId: string): Job => async () => {
    if (overBudget()) {
      summary.analysisFailed.push({ trackerId, error: "skipped: time budget" });
      return;
    }
    try {
      await runAnalysisAndDraft(trackerId);
      summary.analyzed.push(trackerId);
    } catch (err) {
      summary.analysisFailed.push({ trackerId, error: shortErrorMessage(err) });
    }
  };

  const captureJob = (before: Pick<Tracker, "id" | "status">): Job => async () => {
    if (overBudget()) {
      summary.failed.push({ trackerId: before.id, error: "skipped: time budget" });
      return;
    }
    try {
      const { tracker: after } = await captureSnapshot(before.id);
      summary.captured.push(before.id);
      if (before.status === "tracking" && after.status === "ready") {
        queue.push(analysisJob(before.id));
      }
    } catch (err) {
      summary.failed.push({ trackerId: before.id, error: shortErrorMessage(err) });
    }
  };

  for (const tracker of due) queue.push(captureJob(tracker));

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await job();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  return summary;
}

// ---------------------------------------------------------------------------

async function loadTracker(admin: SupabaseClient, trackerId: string): Promise<Tracker> {
  const { data, error } = await admin.from("trackers").select("*").eq("id", trackerId).maybeSingle();
  if (error) throw new Error(`Could not load tracker: ${error.message}`);
  if (!data) throw new Error(`Tracker ${trackerId} not found`);
  return data as Tracker;
}

async function loadSnapshot(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
): Promise<Snapshot | null> {
  const { data, error } = await admin
    .from("snapshots")
    .select("*")
    .eq("tracker_id", trackerId)
    .eq("day_number", dayNumber)
    .maybeSingle();
  if (error) throw new Error(`Could not load snapshot: ${error.message}`);
  return (data as Snapshot | null) ?? null;
}

async function storeSnapshot(
  admin: SupabaseClient,
  tracker: Tracker,
  dayNumber: number,
  result: Awaited<ReturnType<typeof fetchSerpWithAiOverview>>,
): Promise<{ snapshot: Snapshot; tracker: Tracker }> {
  const overview = normalizeAiOverview(result.aiOverviewItem);
  const previous = dayNumber > 1 ? await loadSnapshot(admin, tracker.id, dayNumber - 1) : null;
  const diff = computeDiff(
    previous ? { text: previous.overview_text, references: previous.references ?? [] } : null,
    { text: overview.text, references: overview.references },
  );

  const { data: inserted, error: insertError } = await admin
    .from("snapshots")
    .insert({
      tracker_id: tracker.id,
      day_number: dayNumber,
      captured_at: new Date().toISOString(),
      has_overview: overview.hasOverview,
      overview_text: overview.text,
      overview_markdown: overview.markdown,
      references: overview.references,
      inline_links: overview.inlineLinks,
      raw: result.raw,
      content_hash: overview.contentHash,
      diff,
      cost_usd: result.cost,
    })
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      // Another run already stored this day (overlapping cron): reuse it.
      const existing = await loadSnapshot(admin, tracker.id, dayNumber);
      if (existing) return { snapshot: existing, tracker: await loadTracker(admin, tracker.id) };
    }
    throw new Error(`Could not save snapshot: ${insertError.message}`);
  }

  const dayCount = Math.max(tracker.day_count, dayNumber);
  let status: TrackerStatus = tracker.status === "error" ? "tracking" : tracker.status;
  if (status === "tracking" && dayCount >= tracker.days_target) status = "ready";

  const update: Partial<Tracker> = {
    day_count: dayCount,
    next_capture_at: new Date(Date.now() + DAY_MS).toISOString(),
    last_error: null,
    status,
  };
  const target = tracker.target_domain;
  if (tracker.cited_on_day == null && target) {
    const cited = overview.references.some((ref) => domainMatches(ref.domain, target));
    if (cited) update.cited_on_day = dayNumber;
  }

  const { data: updated, error: updateError } = await admin
    .from("trackers")
    .update(update)
    .eq("id", tracker.id)
    .select("*")
    .single();
  if (updateError) throw new Error(`Could not update tracker: ${updateError.message}`);

  return { snapshot: inserted as Snapshot, tracker: updated as Tracker };
}

async function markCaptureFailed(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
  message: string,
): Promise<void> {
  const update: Partial<Tracker> = { last_error: message };
  if (dayNumber === 1) update.status = "error";
  const { error } = await admin.from("trackers").update(update).eq("id", trackerId);
  if (error) console.error("tracker last_error update failed", error.message);
}

/** A short, plain-English message safe to show in the UI. */
function shortErrorMessage(err: unknown): string {
  if (err instanceof DataForSeoError) {
    if (err.statusCode === 0) return "Could not reach the search data service. Try again in a minute.";
    return `Search data service error: ${err.statusMessage} (code ${err.statusCode})`.slice(0, 200);
  }
  const message = err instanceof Error ? err.message : String(err);
  return (message || "Unknown error").slice(0, 200);
}
