import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck, Globe, TriangleAlert } from "lucide-react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { CitationsTable } from "@/components/app/citations-table";
import { DraftAutoStart } from "@/components/app/draft-auto-start";
import { DraftView } from "@/components/app/draft-view";
import { ReportView } from "@/components/app/report-view";
import { StatusChip } from "@/components/app/status-chip";
import { Timeline } from "@/components/app/timeline";
import { TrackerControls } from "@/components/app/tracker-controls";
import { Chip } from "@/components/ui/chip";
import { isReportStale, recoverStaleAnalysis } from "@/lib/analyze";
import { ReportAutoStart } from "@/components/app/report-auto-start";
import { aggregateCitations, countTotals } from "@/lib/citations";
import { createClient } from "@/lib/supabase/server";
import { LANGUAGES, type Analysis, type Draft, type Snapshot, type Tracker } from "@/lib/types";
import { Tabs, resolveTab } from "./tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

/** Postgres "invalid input syntax" (e.g. an id that is not a uuid): treat as not found. */
const INVALID_TEXT_REPRESENTATION = "22P02";

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("trackers").select("keyword").eq("id", id).maybeSingle();
  const keyword = (data as Pick<Tracker, "keyword"> | null)?.keyword;
  return { title: keyword ?? "Keyword" };
}

/** Keyword page: header with status and controls, then the Timeline / Citations / Report / Draft tab. */
export default async function TrackerPage({ params, searchParams }: PageProps) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: trackerRow, error: trackerError } = await supabase
    .from("trackers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (trackerError) {
    if (trackerError.code === INVALID_TEXT_REPRESENTATION) notFound();
    throw new Error(`Could not load the keyword: ${trackerError.message}`);
  }
  if (!trackerRow) notFound();
  let tracker = trackerRow as Tracker;

  // A report the platform stopped mid-way would show "Writing your report" forever.
  // Recovery is idempotent and only touches trackers stuck for 15+ minutes.
  if (tracker.status === "analyzing") {
    try {
      const { recovered } = await recoverStaleAnalysis(id);
      if (recovered) {
        const { data: fresh } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
        if (fresh) tracker = fresh as Tracker;
      }
    } catch (err) {
      console.error("stale analysis recovery failed", err instanceof Error ? err.message : err);
    }
  }

  const [snapshotsRes, analysisRes, draftRes] = await Promise.all([
    supabase
      .from("snapshots")
      .select("*")
      .eq("tracker_id", id)
      .order("day_number", { ascending: true })
      .order("sample", { ascending: true }),
    supabase
      .from("analyses")
      .select("*")
      .eq("tracker_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("drafts")
      .select("*")
      .eq("tracker_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (snapshotsRes.error) console.error("snapshots query failed", snapshotsRes.error.message);
  if (analysisRes.error) console.error("analysis query failed", analysisRes.error.message);
  if (draftRes.error) console.error("draft query failed", draftRes.error.message);

  const snapshots = (snapshotsRes.data ?? []) as Snapshot[];
  const analysis = (analysisRes.data as Analysis | null) ?? null;
  const draft = (draftRes.data as Draft | null) ?? null;

  const citationRows = aggregateCitations(snapshots);
  // Each day holds several samples (one snapshot row each); the report and the Citations tab count samples.
  const totals = countTotals(snapshots);
  const snapshotsWithOverview = totals.samplesWithOverview;
  const activeTab = resolveTab(tab, tracker.status);
  const analyzing = tracker.status === "analyzing";
  // The report is done but its page was never written (the function was stopped in between).
  const needsDraft = tracker.status === "analyzed" && analysis?.status === "done" && draft?.analysis_id !== analysis.id;
  // All days are in but no report was ever built (the cron ran out of time): build it on open.
  const needsReport = tracker.status === "ready" && !analysis && snapshotsWithOverview > 0;
  // A report exists but days were captured after it: offer a fresh one once all days are in.
  const reportStale =
    tracker.status === "analyzed" && tracker.day_count >= tracker.days_target && isReportStale(analysis, snapshots);
  const languageName = LANGUAGES.find((l) => l.code === tracker.language_code)?.name ?? tracker.language_code;
  const deviceName = tracker.device === "mobile" ? "Mobile" : "Desktop";

  return (
    <div>
      {analyzing ? <AutoRefresh intervalMs={4000} /> : null}
      {needsDraft && activeTab !== "draft" ? <DraftAutoStart trackerId={tracker.id} silent /> : null}

      <Link href="/app" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Your keywords
      </Link>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="max-w-full break-words text-3xl font-bold tracking-tight text-ink">{tracker.keyword}</h1>
            <StatusChip tracker={tracker} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {tracker.location_name}
            </span>
            <span aria-hidden="true">·</span>
            <span>{languageName}</span>
            <span aria-hidden="true">·</span>
            <span>{deviceName}</span>
            {tracker.target_domain ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Watching for {tracker.target_domain}</span>
              </>
            ) : null}
          </p>
          {tracker.cited_on_day != null ? (
            <div className="mt-3">
              <Chip tone="good">
                <CircleCheck className="h-3 w-3" aria-hidden="true" />
                You were cited on day {tracker.cited_on_day}
              </Chip>
            </div>
          ) : null}
          {tracker.status === "error" && tracker.last_error ? (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{tracker.last_error}</p>
            </div>
          ) : null}
        </div>

        <TrackerControls tracker={{ id: tracker.id, status: tracker.status, keep_tracking: tracker.keep_tracking }} />
      </div>

      <div className="mt-8">
        <Tabs trackerId={tracker.id} active={activeTab} citationsCount={citationRows.length} analyzing={analyzing} />
      </div>

      <div className="mt-6">
        {activeTab === "timeline" ? (
          <Timeline snapshots={snapshots} tracker={tracker} />
        ) : activeTab === "citations" ? (
          <CitationsTable
            rows={citationRows}
            totalSamples={totals.samples}
            totalDays={totals.days}
            targetDomain={tracker.target_domain}
          />
        ) : activeTab === "report" ? (
          needsReport ? (
            <ReportAutoStart trackerId={tracker.id} daysTarget={tracker.days_target} />
          ) : (
            <ReportView
              tracker={tracker}
              analysis={analysis}
              snapshotsWithOverview={snapshotsWithOverview}
              daysWithOverview={totals.daysWithOverview}
              dayCount={tracker.day_count}
              staleReport={reportStale}
            />
          )
        ) : needsDraft ? (
          <DraftAutoStart trackerId={tracker.id} />
        ) : (
          <DraftView
            trackerId={tracker.id}
            keyword={tracker.keyword}
            draft={draft}
            canRegenerate={tracker.status === "analyzed"}
          />
        )}
      </div>
    </div>
  );
}
