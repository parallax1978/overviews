/**
 * Orchestrates the analysis and draft for one tracker: loads the snapshots,
 * runs the two Claude calls, and writes analyses / drafts / api_log rows with
 * the admin client. Callers must already have verified ownership (route
 * handlers) or be the secret-protected cron.
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
import type { Analysis, Draft, Snapshot, Tracker } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

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
    .order("day_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Snapshot[];
}

function toAnalysisSnapshot(s: Snapshot): AnalysisSnapshotInput {
  return {
    day_number: s.day_number,
    captured_at: s.captured_at,
    has_overview: s.has_overview,
    overview_text: s.overview_text,
    overview_markdown: s.overview_markdown,
    references: s.references ?? [],
    inline_links: s.inline_links ?? [],
  };
}

/** Status to fall back to when an analysis fails. */
function restingStatus(tracker: Tracker): Tracker["status"] {
  return tracker.day_count >= tracker.days_target ? "ready" : "tracking";
}

/** Error recorded when the platform stopped a report before it finished (e.g. the function hit maxDuration). */
const STALE_ANALYSIS_MESSAGE = "This took too long and was stopped. Try again.";

/** An "analyzing" tracker whose newest analyses row is older than this is considered abandoned. */
const STALE_ANALYSIS_MS = 15 * 60 * 1000;

/**
 * Put a tracker that is stuck in "analyzing" back into a resting state. The
 * analysis and the draft run inside one request; when the platform stops that
 * function nothing would ever update the rows again. Idempotent and cheap, so
 * callers run it before acting on the tracker. Returns whether anything changed.
 */
export async function recoverStaleAnalysis(trackerId: string): Promise<{ recovered: boolean }> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  if (tracker.status !== "analyzing") return { recovered: false };

  const { data: analysisRow, error: analysisError } = await admin
    .from("analyses")
    .select("*")
    .eq("tracker_id", trackerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisError) throw new Error(analysisError.message);
  const analysis = analysisRow as Analysis | null;

  const stale = !analysis || Date.now() - new Date(analysis.created_at).getTime() > STALE_ANALYSIS_MS;
  if (!stale) return { recovered: false };

  if (analysis?.status === "running") {
    const { error } = await admin
      .from("analyses")
      .update({ status: "error", step: null, error: STALE_ANALYSIS_MESSAGE })
      .eq("id", analysis.id);
    if (error) throw new Error(error.message);
  } else if (analysis?.status === "done" && analysis.step) {
    // The report finished but the page was never written: drop the leftover progress label.
    await admin.from("analyses").update({ step: null }).eq("id", analysis.id);
  }

  const analyzed = analysis?.status === "done";
  const { error: trackerError } = await admin
    .from("trackers")
    .update({
      status: analyzed ? "analyzed" : restingStatus(tracker),
      last_error: analyzed ? null : (analysis?.status === "error" && analysis.error) || STALE_ANALYSIS_MESSAGE,
    })
    .eq("id", trackerId);
  if (trackerError) throw new Error(trackerError.message);

  return { recovered: true };
}

/**
 * Run the full pipeline for a tracker: analysis (patterns, citation research,
 * blueprint, summary) followed by the first draft. Marks the tracker
 * "analyzing" while running and "analyzed" on success. Throws on failure after
 * recording the error on the analyses row and the tracker.
 */
export async function runAnalysisAndDraft(trackerId: string): Promise<{ analysis: Analysis; draft: Draft }> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);
  const snapshots = await loadSnapshots(admin, trackerId);
  if (!snapshots.some((s) => s.has_overview)) {
    throw new Error("No AI Overview has appeared for this keyword yet");
  }

  {
    const { error } = await admin.from("trackers").update({ status: "analyzing", last_error: null }).eq("id", trackerId);
    if (error) throw new Error(error.message);
  }

  const { data: inserted, error: insertError } = await admin
    .from("analyses")
    .insert({ tracker_id: trackerId, status: "running", step: "Starting", model: CLAUDE_MODEL })
    .select("*")
    .single();
  if (insertError || !inserted) {
    await admin.from("trackers").update({ status: restingStatus(tracker) }).eq("id", trackerId);
    throw new Error(insertError?.message ?? "Could not start the analysis");
  }
  const analysisId = (inserted as Analysis).id;

  let phase: "messages:analyze" | "messages:draft" = "messages:analyze";
  let startedAt = Date.now();

  try {
    const result = await analyzeOverviews(
      {
        keyword: tracker.keyword,
        locationName: tracker.location_name,
        languageCode: tracker.language_code,
        snapshots: snapshots.map(toAnalysisSnapshot),
        targetDomain: tracker.target_domain,
        userEdge: tracker.user_edge,
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
        usage: result.usage,
        model: result.model,
        status: "done",
        step: null,
      })
      .eq("id", analysisId)
      .select("*")
      .single();
    if (doneError || !doneRow) throw new Error(doneError?.message ?? "Could not save the analysis");
    const analysis = doneRow as Analysis;

    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: "messages:analyze",
      status: 200,
      cost_usd: estimateAnthropicCost(result.usage),
      duration_ms: Date.now() - startedAt,
    });

    phase = "messages:draft";
    startedAt = Date.now();
    await admin.from("analyses").update({ step: "Writing your page" }).eq("id", analysisId);

    const written = await writeDraft({
      keyword: tracker.keyword,
      blueprint: result.blueprint,
      patterns: result.patterns,
      citationResearch: result.citation_research,
      stableCore: result.patterns.stable_core,
      userEdge: tracker.user_edge,
      targetDomain: tracker.target_domain,
      notes: null,
      previousDraft: null,
    });

    const { data: draftRow, error: draftError } = await admin
      .from("drafts")
      .insert({
        tracker_id: trackerId,
        analysis_id: analysisId,
        title: written.title,
        meta_description: written.meta_description,
        h1: written.h1,
        outline: written.outline,
        content_md: written.content_md,
        why_better_md: written.why_better_md,
        notes: null,
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

    await admin.from("analyses").update({ step: null }).eq("id", analysisId);
    await admin.from("trackers").update({ status: "analyzed", last_error: null }).eq("id", trackerId);

    return { analysis, draft: draftRow as Draft };
  } catch (err) {
    const message = errorMessage(err);
    await admin.from("analyses").update({ status: "error", error: message, step: null }).eq("id", analysisId);
    await admin
      .from("trackers")
      .update({ status: restingStatus(tracker), last_error: message })
      .eq("id", trackerId);
    await logApiCall(admin, {
      tracker_id: trackerId,
      provider: "anthropic",
      endpoint: phase,
      status: anthropicErrorStatus(err),
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: message,
    });
    throw err;
  }
}

/**
 * Write a new draft from the latest finished analysis, revising the latest
 * draft according to the user's notes. Returns the new drafts row.
 */
export async function regenerateDraft(trackerId: string, notes?: string | null): Promise<Draft> {
  const admin = createAdminClient();
  const tracker = await loadTracker(admin, trackerId);

  const { data: analysisRow, error: analysisError } = await admin
    .from("analyses")
    .select("*")
    .eq("tracker_id", trackerId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisError) throw new Error(analysisError.message);
  const analysis = analysisRow as Analysis | null;
  if (!analysis?.patterns || !analysis.blueprint) {
    throw new Error("Build the report first, then you can write a new draft");
  }

  const { data: previousRow, error: previousError } = await admin
    .from("drafts")
    .select("*")
    .eq("tracker_id", trackerId)
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
      notes: cleanNotes,
      previousDraft: previous?.content_md
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
