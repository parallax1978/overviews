/**
 * Orchestrates the report and the draft for one tracker. The analysis and the
 * draft are separate Claude calls that run in separate requests (each takes
 * minutes), so neither one risks the platform's function time limit.
 * Writes analyses / drafts / api_log rows with the admin client: callers must
 * already have verified ownership (route handlers) or be the secret-protected cron.
 */

import { estimateAnthropicCost, logApiCall } from "@/lib/api-log";
import {
  CLAUDE_MODEL,
  analyzeOverviews,
  anthropicErrorStatus,
  writeDraft,
  type AnalysisSnapshotInput,
} from "@/lib/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Analysis, Draft, Snapshot, Tracker, TrackerStatus } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Thrown when a report is already being built for the tracker. */
export class AnalysisInProgressError extends Error {
  constructor() {
    super("Your report is already being built. Give it a minute.");
    this.name = "AnalysisInProgressError";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadTracker(admin: Admin, trackerId: string): Promise<Tracker> {
  const { data, error } = await admin.from("trackers").select("*").eq("id", trackerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Keyword not found");
  return data as Tracker;
}

async function loadSnapshots(admin: Admin, trackerId: string): Promise<Snapshot[]> {
  const { data, error } = await admin
    .from("snapshots")
    .select("*")
    .eq("tracker_id", trackerId)
    .order("day_number", { ascending: true })
    .order("sample", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Snapshot[];
}

async function loadLatestAnalysis(admin: Admin, trackerId: string, onlyDone = false): Promise<Analysis | null> {
  let query = admin.from("analyses").select("*").eq("tracker_id", trackerId);
  if (onlyDone) query = query.eq("status", "done");
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Analysis | null) ?? null;
}

function toAnalysisSnapshot(s: Snapshot): AnalysisSnapshotInput {
  return {
    day_number: s.day_number,
    sample: s.sample,
    captured_at: s.captured_at,
    has_overview: s.has_overview,
    overview_text: s.overview_text,
    overview_markdown: s.overview_markdown,
    references: s.references ?? [],
    inline_links: s.inline_links ?? [],
  };
}

/** Number of distinct captured days among the snapshots (each day holds several samples). */
function countDays(snapshots: Pick<Snapshot, "day_number">[]): number {
  return new Set(snapshots.map((s) => s.day_number)).size;
}

/**
 * Status for a tracker that is not being analyzed and has no usable prior
 * status: "analyzed" when a finished report exists (it keeps capturing until
 * all days are in), else "ready" once all days are in, else "tracking".
 */
export function restingStatus(tracker: Pick<Tracker, "day_count" | "days_target">, hasReport: boolean): TrackerStatus {
  if (hasReport) return "analyzed";
  return tracker.day_count >= tracker.days_target ? "ready" : "tracking";
}

/**
 * Status for a tracker whose report just finished. A paused keyword stays
 * paused: a report must not restart the daily capture the user stopped.
 */
export function statusAfterAnalysis(previous: TrackerStatus): TrackerStatus {
  return previous === "paused" ? "paused" : "analyzed";
}

/** Error recorded when the platform stopped a report before it finished (e.g. the function hit maxDuration). */
const STALE_ANALYSIS_MESSAGE = "This took too long and was stopped. Try again.";

/** An "analyzing" tracker whose newest analyses row is older than this is considered abandoned. */
const STALE_ANALYSIS_MS = 15 * 60 * 1000;

/**
 * Put a tracker that is stuck in "analyzing" back into a resting state. When
 * the platform stops the function mid-run nothing would ever update the rows
 * again. Idempotent and cheap, so callers run it before acting on the tracker.
 * Returns whether anything changed.
 */
export async function recoverStaleAnalysis(trackerId: string): Promise<{ recovered: boolean }> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  if (tracker.status !== "analyzing") return { recovered: false };

  const analysis = await loadLatestAnalysis(admin, trackerId);
  const stale = !analysis || Date.now() - new Date(analysis.created_at).getTime() > STALE_ANALYSIS_MS;
  if (!stale) return { recovered: false };

  if (analysis?.status === "running") {
    const { error } = await admin
      .from("analyses")
      .update({ status: "error", step: null, error: STALE_ANALYSIS_MESSAGE })
      .eq("id", analysis.id);
    if (error) throw new Error(error.message);
  }

  const done = await loadLatestAnalysis(admin, trackerId, true);
  const { error: trackerError } = await admin
    .from("trackers")
    .update({
      status: restingStatus(tracker, Boolean(done)),
      last_error: done ? null : STALE_ANALYSIS_MESSAGE,
    })
    .eq("id", trackerId);
  if (trackerError) throw new Error(trackerError.message);

  return { recovered: true };
}

/**
 * Build the report for a tracker: patterns, citation research, blueprint and
 * summary. Claims the tracker atomically (status "analyzing"), so two callers
 * cannot start two paid analyses; the loser gets AnalysisInProgressError.
 * On success the tracker is "analyzed", or stays "paused" if it was paused;
 * the draft is written separately (regenerateDraft), which the keyword page
 * starts automatically.
 * Throws on failure after recording the error on the analyses row and the tracker.
 */
export async function runAnalysis(trackerId: string): Promise<Analysis> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  if (tracker.status === "analyzing") throw new AnalysisInProgressError();
  const snapshots = await loadSnapshots(admin, trackerId);
  if (!snapshots.some((s) => s.has_overview)) {
    throw new Error("No AI Overview has appeared for this keyword yet");
  }

  // Where to put the tracker back if this run fails: its previous resting state
  // (a paused keyword stays paused, an analyzed one keeps its old report).
  const fallback: TrackerStatus = tracker.status;

  const { data: claimed, error: claimError } = await admin
    .from("trackers")
    .update({ status: "analyzing", last_error: null })
    .eq("id", trackerId)
    .neq("status", "analyzing")
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new AnalysisInProgressError();

  // How much data the report is built from, written up front so the progress UI can show it.
  const samplesTotal = snapshots.length;
  const daysTotal = countDays(snapshots);

  const { data: inserted, error: insertError } = await admin
    .from("analyses")
    .insert({
      tracker_id: trackerId,
      status: "running",
      step: "Starting",
      model: CLAUDE_MODEL,
      samples_total: samplesTotal,
      days_total: daysTotal,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    await admin.from("trackers").update({ status: fallback }).eq("id", trackerId);
    throw new Error(insertError?.message ?? "Could not start the analysis");
  }
  const analysisId = (inserted as Analysis).id;
  const startedAt = Date.now();

  try {
    const result = await analyzeOverviews(
      {
        keyword: tracker.keyword,
        locationName: tracker.location_name,
        languageCode: tracker.language_code,
        snapshots: snapshots.map(toAnalysisSnapshot),
        targetDomain: tracker.target_domain,
        userEdge: tracker.user_edge,
        competitorPolicy: tracker.competitor_policy ?? "avoid",
      },
      {
        onStep: async (step) => {
          await admin.from("analyses").update({ step }).eq("id", analysisId);
        },
      },
    );

    const { data: doneRow, error: doneError } = await admin
      .from("analyses")
      .update({
        patterns: result.patterns,
        citation_research: result.citation_research,
        blueprint: result.blueprint,
        summary_md: result.summary_md,
        samples_total: samplesTotal,
        days_total: daysTotal,
        usage: result.usage,
        model: result.model,
        status: "done",
        step: null,
      })
      .eq("id", analysisId)
      .select("*")
      .single();
    if (doneError || !doneRow) throw new Error(doneError?.message ?? "Could not save the analysis");

    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: "messages:analyze",
      status: 200,
      cost_usd: estimateAnthropicCost(result.usage),
      duration_ms: Date.now() - startedAt,
    });

    await admin
      .from("trackers")
      .update({ status: statusAfterAnalysis(fallback), last_error: null })
      .eq("id", trackerId);
    return doneRow as Analysis;
  } catch (err) {
    const message = errorMessage(err);
    await admin.from("analyses").update({ status: "error", error: message, step: null }).eq("id", analysisId);
    await admin.from("trackers").update({ status: fallback, last_error: message }).eq("id", trackerId);
    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: "messages:analyze",
      status: anthropicErrorStatus(err),
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: message,
    });
    throw err;
  }
}

/**
 * Write a draft from the latest finished analysis. With `notes`, revises the
 * latest draft of that analysis; otherwise writes a fresh page (a draft left
 * over from an older analysis is not reused). Returns the new drafts row.
 */
export async function regenerateDraft(trackerId: string, notes?: string | null): Promise<Draft> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);

  const analysis = await loadLatestAnalysis(admin, trackerId, true);
  if (!analysis?.patterns || !analysis.blueprint) {
    throw new Error("Build the report first, then you can write a new draft");
  }

  const { data: previousRow, error: previousError } = await admin
    .from("drafts")
    .select("*")
    .eq("tracker_id", trackerId)
    .eq("analysis_id", analysis.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw new Error(previousError.message);
  const previous = previousRow as Draft | null;

  const cleanNotes = notes?.trim() ? notes.trim() : null;
  const startedAt = Date.now();

  try {
    const written = await writeDraft({
      keyword: tracker.keyword,
      blueprint: analysis.blueprint,
      patterns: analysis.patterns,
      citationResearch: analysis.citation_research ?? [],
      stableCore: analysis.patterns.stable_core,
      userEdge: tracker.user_edge,
      targetDomain: tracker.target_domain,
      competitorPolicy: tracker.competitor_policy ?? "avoid",
      notes: cleanNotes,
      previousDraft:
        cleanNotes && previous?.content_md
          ? { title: previous.title ?? "", content_md: previous.content_md }
          : null,
    });

    const { data: draftRow, error: draftError } = await admin
      .from("drafts")
      .insert({
        tracker_id: trackerId,
        analysis_id: analysis.id,
        title: written.title,
        meta_description: written.meta_description,
        h1: written.h1,
        outline: written.outline,
        content_md: written.content_md,
        why_better_md: written.why_better_md,
        notes: cleanNotes,
        model: written.model,
        usage: written.usage,
      })
      .select("*")
      .single();
    if (draftError || !draftRow) throw new Error(draftError?.message ?? "Could not save the draft");

    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: "messages:draft",
      status: 200,
      cost_usd: estimateAnthropicCost(written.usage),
      duration_ms: Date.now() - startedAt,
    });

    return draftRow as Draft;
  } catch (err) {
    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: "messages:draft",
      status: anthropicErrorStatus(err),
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: errorMessage(err),
    });
    throw err;
  }
}

/** Report then draft, back to back. For scripts and callers with their own time budget. */
export async function runAnalysisAndDraft(trackerId: string): Promise<{ analysis: Analysis; draft: Draft }> {
  const analysis = await runAnalysis(trackerId);
  const draft = await regenerateDraft(trackerId, null);
  return { analysis, draft };
}

/** True when a finished analysis exists but a newer snapshot has landed since it was built. */
export function isReportStale(
  analysis: Pick<Analysis, "status" | "created_at"> | null,
  snapshots: Pick<Snapshot, "captured_at">[],
): boolean {
  if (!analysis || analysis.status !== "done") return false;
  const latest = snapshots.reduce((max, s) => (s.captured_at > max ? s.captured_at : max), "");
  return Boolean(latest) && latest > analysis.created_at;
}
