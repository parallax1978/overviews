/**
 * Captures one day of AI Overview samples for a tracker and runs the daily batch.
 * Google writes a different overview for every request, so a day is
 * SAMPLES_PER_DAY requests fired in parallel and stored as one snapshot row each.
 * Uses the service-role client: callers must have verified ownership first
 * (server actions) or be the secret-protected cron.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverStaleAnalysis, regenerateDraft, runAnalysis } from "@/lib/analyze";
import { logApiCall } from "@/lib/api-log";
import { assertPlatformBudget, BillingError, getAccount, getAccounts, refundKeywordCharge } from "@/lib/billing";
import {
  type CaptureResult,
  DATAFORSEO_ENDPOINT,
  DataForSeoError,
  type DataForSeoCredentials,
  fetchSerpWithAiOverview,
} from "@/lib/dataforseo";
import { type Comparable, computeDayDiff } from "@/lib/diff";
import { dataforseoCredentialsFor } from "@/lib/own-keys";
import { normalizeAiOverview } from "@/lib/overview";
import { isPlanActive, keepTrackingLimit, NO_OVERVIEW_REFUND } from "@/lib/plans";
import { isCaptureDue, nextCaptureAt } from "@/lib/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { SAMPLES_PER_DAY, type Account, type Snapshot, type Tracker, type TrackerStatus } from "@/lib/types";
import { domainMatches } from "@/lib/utils";

const UNIQUE_VIOLATION = "23505";
const DEFAULT_LIMIT = 200;
const DEFAULT_CONCURRENCY = 4;
/**
 * The cron function has 800s (app/api/cron/capture/route.ts). Stop starting
 * new captures after this long so the reports below still fit in the rest.
 * A tracker takes about 20s: its samples run in parallel.
 */
const CAPTURE_BUDGET_MS = 240_000;
/** Only start a report (about 3 minutes) while no more than this much of the function's time is used. */
const ANALYSIS_START_BUDGET_MS = 150_000;
/**
 * Also write the ready-to-publish draft (up to about 6 minutes: it searches
 * the web and reads pages) only when the report finished early enough.
 */
const DRAFT_START_BUDGET_MS = 300_000;
/** Reports to pick up per run for trackers that reached their target earlier but were never analyzed. */
const PENDING_REPORTS_PER_RUN = 1;
/** Stuck "analyzing" trackers to check per run; each check is a few quick queries. */
const STUCK_ANALYSES_PER_RUN = 50;

export interface CaptureRunSummary {
  /** Trackers that were stuck in "analyzing" from a stopped run and were put back to a resting state. */
  recovered: string[];
  captured: string[];
  failed: { trackerId: string; error: string }[];
  analyzed: string[];
  analysisFailed: { trackerId: string; error: string }[];
  /** Kept-tracked pages not captured because their owner's plan ended or is over its keep-tracking limit. */
  skipped: string[];
  /** Keywords whose credits came back because no AI Overview appeared in their whole study. */
  refunded: string[];
}

export { isCaptureDue, nextCaptureAt };

/** The parts of a stored sample the day diff needs (no raw SERP payload). */
type SampleText = Pick<Snapshot, "sample" | "overview_text" | "references">;

/**
 * Takes the samples for `dayNumber` (default: the next day), stores one
 * snapshot row per sample, writes the day's diff on its first sample and
 * advances the tracker once. Samples the day already has (an overlapping cron
 * run, a retry after a partial failure) are kept; only the missing ones are
 * fetched. Logs every API call. Throws when the day ends up with no sample at
 * all, after marking the tracker as before.
 */
export async function captureSnapshot(
  trackerId: string,
  opts?: { dayNumber?: number },
): Promise<{ snapshots: Snapshot[]; tracker: Tracker }> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  const dayNumber = opts?.dayNumber ?? tracker.day_count + 1;

  const snapshots = await loadDaySnapshots(admin, tracker.id, dayNumber);
  const have = new Set(snapshots.map((s) => s.sample));
  const missing = Array.from({ length: SAMPLES_PER_DAY }, (_, i) => i + 1).filter((s) => !have.has(s));

  // The app's DataForSEO account, or the owner's own for a keyword on their own keys.
  let credentials: DataForSeoCredentials;
  try {
    credentials = await dataforseoCredentialsFor(tracker, admin);
  } catch (err) {
    await markCaptureFailed(admin, tracker.id, dayNumber, shortErrorMessage(err));
    throw err;
  }

  const settled = await Promise.allSettled(
    missing.map((sample) => captureSample(admin, tracker, dayNumber, sample, credentials)),
  );
  let firstError: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") snapshots.push(outcome.value);
    else if (firstError === null) firstError = outcome.reason;
  }

  if (snapshots.length === 0) {
    const err = firstError ?? new Error("No sample was captured");
    await markCaptureFailed(admin, tracker.id, dayNumber, shortErrorMessage(err));
    throw err;
  }
  if (firstError !== null) {
    console.warn(
      `capture ${tracker.id} day ${dayNumber}: kept ${snapshots.length} of ${SAMPLES_PER_DAY} samples;`,
      shortErrorMessage(firstError),
    );
  }
  snapshots.sort((a, b) => a.sample - b.sample);

  await storeDayDiff(admin, tracker.id, dayNumber, snapshots);
  const advanced = await advanceTracker(admin, tracker, dayNumber, snapshots);
  return { snapshots, tracker: advanced };
}

/**
 * First puts back any tracker left stuck in "analyzing" by a run the platform
 * stopped, then captures every tracker that is due today, four at a time (each
 * tracker's samples run in parallel, about 20s per tracker), then builds the
 * report for trackers that just reached their day target (one at a time, while
 * the function still has time). Reports it could not start are built when the
 * user next opens the keyword page.
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

  const summary: CaptureRunSummary = {
    recovered: [],
    captured: [],
    failed: [],
    analyzed: [],
    analysisFailed: [],
    skipped: [],
    refunded: [],
  };
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // A report the platform stopped mid-run (the function hit its time limit)
  // leaves its keyword "analyzing" for good: nothing touches it again unless
  // the user opens its page. Put those back first, before the due query, so a
  // recovered keyword can still be captured and queued for a report today.
  // Best effort: recoverStaleAnalysis leaves a report that is really running alone.
  for (const trackerId of await loadAnalyzingTrackers(admin, STUCK_ANALYSES_PER_RUN)) {
    try {
      const { recovered } = await recoverStaleAnalysis(trackerId);
      if (recovered) summary.recovered.push(trackerId);
    } catch (err) {
      console.error(`stale analysis recovery failed for ${trackerId}:`, shortErrorMessage(err));
    }
  }

  const { data, error } = await admin
    .from("trackers")
    .select("id, user_id, billing_source, status, keep_tracking, day_count, days_target, next_capture_at, created_at")
    .lte("next_capture_at", now.toISOString())
    .in("status", ["tracking", "analyzed", "ready"])
    .order("next_capture_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load due trackers: ${error.message}`);

  const dueRows = ((data ?? []) as DueRow[]).filter((t) => isCaptureDue(t, now));
  const accounts = await getAccounts(
    dueRows.map((t) => t.user_id),
    admin,
  );
  const keptTracked = await loadKeptTrackedOnPlatform(
    admin,
    dueRows.filter((t) => isKeepTrackingCapture(t) && t.billing_source !== "own_keys").map((t) => t.user_id),
  );
  const due: DueRow[] = [];
  for (const tracker of dueRows) {
    if (mayCapture(tracker, accounts, keptTracked)) due.push(tracker);
    else summary.skipped.push(tracker.id);
  }

  // Reports owed from earlier runs: trackers at their target, with an overview, that were never analyzed.
  const pending = await loadPendingReports(admin, PENDING_REPORTS_PER_RUN);
  const needsReport: string[] = [...pending];
  const finishedStudies: DueRow[] = [];

  type Job = () => Promise<void>;
  const queue: Job[] = [];

  const captureJob = (before: DueRow): Job => async () => {
    if (elapsed() > CAPTURE_BUDGET_MS) {
      summary.failed.push({ trackerId: before.id, error: "skipped: time budget" });
      return;
    }
    try {
      const { tracker: after } = await captureSnapshot(before.id);
      summary.captured.push(before.id);
      if (before.day_count < before.days_target && after.day_count >= after.days_target) {
        finishedStudies.push(before);
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

  // A study that just ended gets its report, which adding the keyword paid for.
  // With no AI Overview in the whole study there is nothing to report, so a
  // keyword on the app's keys gets most of its credits back. A keyword on the
  // app's keys whose report was already built early keeps that report: a fresh
  // one is an update the owner chooses (and pays for). On their own keys the
  // owner pays the APIs directly, so the fresh report is built as before.
  for (const study of finishedStudies) {
    try {
      if (!(await hasOverviewSample(admin, study.id))) {
        if (study.billing_source !== "own_keys") {
          const refunded = await refundKeywordCharge({
            userId: study.user_id,
            trackerId: study.id,
            amount: NO_OVERVIEW_REFUND,
            why: "no_overview",
            admin,
          });
          if (refunded) summary.refunded.push(study.id);
        }
        continue;
      }
      if (study.billing_source !== "own_keys" && (await hasFinishedReport(admin, study.id))) continue;
      needsReport.push(study.id);
    } catch (err) {
      summary.analysisFailed.push({ trackerId: study.id, error: shortErrorMessage(err) });
    }
  }

  // Reports run one at a time: each is a single multi-minute Claude call.
  for (const trackerId of [...new Set(needsReport)]) {
    if (elapsed() > ANALYSIS_START_BUDGET_MS) {
      summary.analysisFailed.push({ trackerId, error: "skipped: time budget" });
      continue;
    }
    try {
      const owner = await loadBilling(admin, trackerId);
      if (owner.billing_source !== "own_keys") {
        await assertPlatformBudget(accounts.get(owner.user_id) ?? (await getAccount(owner.user_id, admin)), admin);
      }
      await runAnalysis(trackerId);
      summary.analyzed.push(trackerId);
      if (elapsed() < DRAFT_START_BUDGET_MS) await regenerateDraft(trackerId, null, "researched");
    } catch (err) {
      // Over the daily ceiling: the keyword page builds the report when its owner opens it.
      const reason = err instanceof BillingError ? `skipped: ${err.message}` : shortErrorMessage(err);
      summary.analysisFailed.push({ trackerId, error: reason });
    }
  }

  return summary;
}

type DueRow = Pick<
  Tracker,
  | "id"
  | "user_id"
  | "billing_source"
  | "status"
  | "keep_tracking"
  | "day_count"
  | "days_target"
  | "next_capture_at"
  | "created_at"
>;

/** A capture after the 7-day study: the page is being kept tracked. */
function isKeepTrackingCapture(t: Pick<Tracker, "day_count" | "days_target">): boolean {
  return t.day_count >= t.days_target;
}

/**
 * Whether the daily job may capture this keyword on its owner's behalf. A
 * study in progress was paid for when it started, so it always runs. Keeping a
 * page tracked afterwards on the app's keys needs an active plan, and only the
 * plan's oldest kept-tracked pages, up to its limit, run. On the owner's own
 * keys it always runs (the limit is checked when they turn it on). Pure.
 */
export function mayCapture(
  tracker: Pick<Tracker, "id" | "user_id" | "billing_source" | "day_count" | "days_target">,
  accounts: Map<string, Pick<Account, "plan" | "subscription_status">>,
  keptTrackedByUser: Map<string, string[]>,
): boolean {
  if (!isKeepTrackingCapture(tracker) || tracker.billing_source === "own_keys") return true;
  const account = accounts.get(tracker.user_id) ?? null;
  if (!account || !isPlanActive(account)) return false;
  const limit = keepTrackingLimit(account.plan, "platform");
  const order = keptTrackedByUser.get(tracker.user_id) ?? [];
  const rank = order.indexOf(tracker.id);
  return rank === -1 ? order.length < limit : rank < limit;
}

/** Every kept-tracked, unpaused keyword on the app's keys for these users, oldest first, so the plan limit picks the same ones every run. */
async function loadKeptTrackedOnPlatform(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return byUser;
  const { data, error } = await admin
    .from("trackers")
    .select("id, user_id, billing_source, status, day_count, days_target, created_at")
    .in("user_id", ids)
    .eq("keep_tracking", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load kept-tracked keywords: ${error.message}`);
  type Row = Pick<Tracker, "id" | "user_id" | "billing_source" | "status" | "day_count" | "days_target">;
  for (const row of (data ?? []) as Row[]) {
    // A paused keyword isn't captured, so it doesn't take one of the plan's slots.
    if (row.billing_source === "own_keys" || row.status === "paused" || !isKeepTrackingCapture(row)) continue;
    const list = byUser.get(row.user_id) ?? [];
    list.push(row.id);
    byUser.set(row.user_id, list);
  }
  return byUser;
}

async function loadBilling(admin: SupabaseClient, trackerId: string): Promise<Pick<Tracker, "user_id" | "billing_source">> {
  const { data, error } = await admin
    .from("trackers")
    .select("user_id, billing_source")
    .eq("id", trackerId)
    .maybeSingle();
  if (error) throw new Error(`Could not load tracker: ${error.message}`);
  if (!data) throw new Error(`Tracker ${trackerId} not found`);
  return data as Pick<Tracker, "user_id" | "billing_source">;
}

/** True when any sample of the keyword had an AI Overview. */
async function hasOverviewSample(admin: SupabaseClient, trackerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("snapshots")
    .select("id")
    .eq("tracker_id", trackerId)
    .eq("has_overview", true)
    .limit(1);
  if (error) throw new Error(`Could not load snapshots: ${error.message}`);
  return (data ?? []).length > 0;
}

/** True when the keyword already has a finished report. */
async function hasFinishedReport(admin: SupabaseClient, trackerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("analyses")
    .select("id")
    .eq("tracker_id", trackerId)
    .eq("status", "done")
    .limit(1);
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------

async function loadTracker(admin: SupabaseClient, trackerId: string): Promise<Tracker> {
  const { data, error } = await admin.from("trackers").select("*").eq("id", trackerId).maybeSingle();
  if (error) throw new Error(`Could not load tracker: ${error.message}`);
  if (!data) throw new Error(`Tracker ${trackerId} not found`);
  return data as Tracker;
}

/** Every sample stored for a day, lowest sample first. */
async function loadDaySnapshots(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
): Promise<Snapshot[]> {
  const { data, error } = await admin
    .from("snapshots")
    .select("*")
    .eq("tracker_id", trackerId)
    .eq("day_number", dayNumber)
    .order("sample", { ascending: true });
  if (error) throw new Error(`Could not load snapshots: ${error.message}`);
  return (data ?? []) as Snapshot[];
}

/** A day's samples without their raw SERP payloads, lowest sample first. */
async function loadDayTexts(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
): Promise<SampleText[]> {
  const { data, error } = await admin
    .from("snapshots")
    .select("sample, overview_text, references")
    .eq("tracker_id", trackerId)
    .eq("day_number", dayNumber)
    .order("sample", { ascending: true });
  if (error) throw new Error(`Could not load snapshots: ${error.message}`);
  return (data ?? []) as SampleText[];
}

/** One stored sample of a day, or null. */
async function loadSample(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
  sample: number,
): Promise<Snapshot | null> {
  const { data, error } = await admin
    .from("snapshots")
    .select("*")
    .eq("tracker_id", trackerId)
    .eq("day_number", dayNumber)
    .eq("sample", sample)
    .maybeSingle();
  if (error) throw new Error(`Could not load snapshot: ${error.message}`);
  return (data as Snapshot | null) ?? null;
}

/** Trackers marked "analyzing". recoverStaleAnalysis decides which of them are really stuck. */
async function loadAnalyzingTrackers(admin: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await admin.from("trackers").select("id").eq("status", "analyzing").limit(limit);
  if (error) {
    console.error("analyzing trackers query failed", error.message);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Trackers at their day target with at least one AI Overview sample and no
 * analysis at all, oldest first. A keyword that never showed an overview cannot
 * be analyzed (runAnalysis refuses it before claiming the tracker), so it must
 * not take the slot every run; the filter runs server-side so a backlog of
 * such trackers cannot crowd out real candidates within the row limit.
 */
async function loadPendingReports(admin: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await admin
    .from("trackers")
    .select("id, analyses(id), snapshots!inner(id)")
    .eq("status", "ready")
    .eq("snapshots.has_overview", true) // !inner drops trackers with no matching sample
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("pending reports query failed", error.message);
    return [];
  }
  const rows = (data ?? []) as { id: string; analyses: { id: string }[] | null }[];
  return rows
    .filter((r) => !r.analyses || r.analyses.length === 0)
    .slice(0, limit)
    .map((r) => r.id);
}

/** One DataForSEO request for sample `sample` of the day, logged either way, stored on success. */
async function captureSample(
  admin: SupabaseClient,
  tracker: Tracker,
  dayNumber: number,
  sample: number,
  credentials: DataForSeoCredentials,
): Promise<Snapshot> {
  const startedAt = Date.now();
  const billing = { billing_source: tracker.billing_source ?? "platform", user_id: tracker.user_id ?? null };
  let result: CaptureResult;
  try {
    result = await fetchSerpWithAiOverview(
      {
        keyword: tracker.keyword,
        location_code: tracker.location_code,
        language_code: tracker.language_code,
        device: tracker.device,
      },
      credentials,
    );
  } catch (err) {
    await logApiCall(admin, {
      tracker_id: tracker.id,
      provider: "dataforseo",
      endpoint: DATAFORSEO_ENDPOINT,
      status: err instanceof DataForSeoError && err.statusCode > 0 ? err.statusCode : null,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: shortErrorMessage(err),
      ...billing,
    });
    throw err;
  }
  await logApiCall(admin, {
    tracker_id: tracker.id,
    provider: "dataforseo",
    endpoint: DATAFORSEO_ENDPOINT,
    status: 200,
    cost_usd: result.cost,
    duration_ms: Date.now() - startedAt,
    ...billing,
  });
  return storeSample(admin, tracker, dayNumber, sample, result);
}

/** Inserts the sample's snapshot row. The day diff is added later, once every sample is in. */
async function storeSample(
  admin: SupabaseClient,
  tracker: Tracker,
  dayNumber: number,
  sample: number,
  result: CaptureResult,
): Promise<Snapshot> {
  const overview = normalizeAiOverview(result.aiOverviewItem);

  const { data: inserted, error: insertError } = await admin
    .from("snapshots")
    .insert({
      tracker_id: tracker.id,
      day_number: dayNumber,
      sample,
      captured_at: new Date().toISOString(),
      has_overview: overview.hasOverview,
      overview_text: overview.text,
      overview_markdown: overview.markdown,
      references: overview.references,
      inline_links: overview.inlineLinks,
      raw: result.raw,
      content_hash: overview.contentHash,
      diff: null,
      cost_usd: result.cost,
    })
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      // Another run already stored this sample (overlapping cron, or a retry
      // racing the first attempt): keep that row.
      const existing = await loadSample(admin, tracker.id, dayNumber, sample);
      if (existing) return existing;
    }
    throw new Error(`Could not save snapshot: ${insertError.message}`);
  }
  return inserted as Snapshot;
}

/**
 * Compares the day's samples with the previous day's and stores the result on
 * the day's first sample. Every other sample keeps diff = null, so the
 * Timeline reads one diff per day.
 */
async function storeDayDiff(
  admin: SupabaseClient,
  trackerId: string,
  dayNumber: number,
  snapshots: Snapshot[],
): Promise<void> {
  const previous = dayNumber > 1 ? await loadDayTexts(admin, trackerId, dayNumber - 1) : [];
  const diff = computeDayDiff(previous.length ? previous.map(comparable) : null, snapshots.map(comparable));

  const [first, ...rest] = snapshots;
  const { error } = await admin.from("snapshots").update({ diff }).eq("id", first.id);
  if (error) throw new Error(`Could not save day diff: ${error.message}`);
  first.diff = diff;

  // A sample that was the day's first on an earlier, partial run still carries that run's diff.
  const stale = rest.filter((s) => s.diff !== null);
  if (stale.length === 0) return;
  const { error: clearError } = await admin
    .from("snapshots")
    .update({ diff: null })
    .in(
      "id",
      stale.map((s) => s.id),
    );
  if (clearError) console.error("stale day diff clear failed", clearError.message);
  else for (const s of stale) s.diff = null;
}

function comparable(sample: Pick<Snapshot, "overview_text" | "references">): Comparable {
  return { text: sample.overview_text, references: sample.references ?? [] };
}

/** Day count, next capture time, status transitions and the "you were cited" mark after a day's capture. */
async function advanceTracker(
  admin: SupabaseClient,
  tracker: Tracker,
  dayNumber: number,
  snapshots: Snapshot[],
): Promise<Tracker> {
  const dayCount = Math.max(tracker.day_count, dayNumber);
  let status: TrackerStatus = tracker.status === "error" ? "tracking" : tracker.status;
  if (status === "tracking" && dayCount >= tracker.days_target) status = "ready";

  const update: Partial<Tracker> = {
    day_count: dayCount,
    next_capture_at: nextCaptureAt().toISOString(),
    last_error: null,
    status,
  };
  const target = tracker.target_domain;
  if (tracker.cited_on_day == null && target) {
    // Any sample counts: Google cited the site in at least one of today's overviews.
    const cited = snapshots.some((s) => (s.references ?? []).some((ref) => domainMatches(ref.domain, target)));
    if (cited) update.cited_on_day = dayNumber;
  }

  const { data: updated, error: updateError } = await admin
    .from("trackers")
    .update(update)
    .eq("id", tracker.id)
    .select("*")
    .single();
  if (updateError) throw new Error(`Could not update tracker: ${updateError.message}`);
  return updated as Tracker;
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
