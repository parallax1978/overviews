import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Clock, Globe, TriangleAlert, X } from "lucide-react";
import { StatusChip } from "@/components/app/status-chip";
import { Chip } from "@/components/ui/chip";
import { LocalTime } from "@/components/ui/local-time";
import type { Tracker } from "@/lib/types";
import { pluralize } from "@/lib/utils";

/** Numbers the dashboard derives from a tracker's snapshots. */
export interface TrackerStats {
  /** The most recent captured day, or null when nothing has been captured yet. */
  latest: {
    dayNumber: number;
    /** Samples taken that day. */
    samples: number;
    /** Samples that day in which an AI Overview appeared. */
    samplesWithOverview: number;
    capturedAt: string;
  } | null;
  /** Distinct domains Google has cited across all samples. */
  sourcesSeen: number;
  /** Samples in which an AI Overview appeared, across all days. */
  samplesWithOverview: number;
  /** Samples captured so far, across all days. */
  samplesCaptured: number;
}

/** Stats for a tracker that has no snapshots yet. */
export const EMPTY_TRACKER_STATS: TrackerStats = {
  latest: null,
  sourcesSeen: 0,
  samplesWithOverview: 0,
  samplesCaptured: 0,
};

const ERROR_PREVIEW_LENGTH = 90;

/** True when the daily capture will run again for this tracker (same rule as the cron). */
function capturesContinue(t: Tracker): boolean {
  if (t.status === "tracking") return true;
  return t.keep_tracking && (t.status === "analyzed" || t.status === "ready");
}

/** One dashboard row: links to the keyword page and shows today's numbers at a glance. */
export function TrackerCard({ tracker, stats }: { tracker: Tracker; stats: TrackerStats }) {
  const errorPreview =
    tracker.last_error && tracker.last_error.length > ERROR_PREVIEW_LENGTH
      ? `${tracker.last_error.slice(0, ERROR_PREVIEW_LENGTH - 1)}…`
      : tracker.last_error;
  const showError = tracker.status === "error" && !!errorPreview;
  const showCited = tracker.cited_on_day != null;
  const nextCaptureAt = capturesContinue(tracker) ? tracker.next_capture_at : null;

  return (
    <Link
      href={`/app/${tracker.id}`}
      className="group block rounded-2xl border border-line bg-white p-5 shadow-pop transition-[border-color,box-shadow] hover:border-line-strong hover:ring-1 hover:ring-line-strong"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-ink">{tracker.keyword}</h2>
            <StatusChip tracker={tracker} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
            <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {tracker.location_name}
          </p>

          {showCited || showError ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {showCited ? (
                <Chip tone="good">
                  <CircleCheck className="h-3 w-3" aria-hidden="true" />
                  You were cited on day {tracker.cited_on_day}
                </Chip>
              ) : null}
              {showError ? (
                <Chip tone="bad" title={tracker.last_error ?? undefined}>
                  <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {errorPreview}
                </Chip>
              ) : null}
            </div>
          ) : null}

          {nextCaptureAt ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Next capture <LocalTime iso={nextCaptureAt} mode="relative" />
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-5 sm:shrink-0">
          <TrackerFacts stats={stats} />
          <ArrowRight
            className="hidden h-5 w-5 shrink-0 text-ink-soft transition-colors group-hover:text-brand sm:block"
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  );
}

function TrackerFacts({ stats }: { stats: TrackerStats }) {
  if (!stats.latest) {
    return (
      <dl className="text-sm">
        <Fact label="AI Overview today" value="Not captured yet" />
      </dl>
    );
  }

  const todayHasOverview = stats.latest.samplesWithOverview > 0;

  return (
    <dl className="grid w-full grid-cols-3 gap-3 text-sm sm:flex sm:w-auto sm:gap-6">
      <Fact
        label="AI Overview today"
        value={
          <span className="inline-flex items-center gap-1">
            {todayHasOverview ? (
              <CircleCheck className="h-4 w-4 text-good" aria-hidden="true" />
            ) : (
              <X className="h-4 w-4 text-ink-soft" aria-hidden="true" />
            )}
            in {stats.latest.samplesWithOverview} of {pluralize(stats.latest.samples, "sample")}
          </span>
        }
      />
      <Fact label="Sources seen" value={pluralize(stats.sourcesSeen, "source")} />
      <Fact
        label="Seen in"
        value={`${stats.samplesWithOverview} of ${pluralize(stats.samplesCaptured, "sample")}`}
      />
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
    </div>
  );
}
