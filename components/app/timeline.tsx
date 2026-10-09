import { Clock, ExternalLink, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { LocalTime } from "@/components/ui/local-time";
import { Markdown } from "@/components/ui/markdown";
import { NumberBadge } from "@/components/ui/number-badge";
import { aggregateCitations, type CitationRow } from "@/lib/citations";
import type { Snapshot, Tracker } from "@/lib/types";
import { domainFromUrl, domainMatches, pluralize } from "@/lib/utils";

export interface TimelineProps {
  /** Any order; the component groups samples by day and shows the newest day first. */
  snapshots: Snapshot[];
  tracker: Pick<Tracker, "status" | "target_domain">;
}

/** One captured day: its samples in sample order. */
interface Day {
  dayNumber: number;
  samples: Snapshot[];
}

/** Timeline tab: one card per captured day with its samples, the sources they cited and what changed. */
export function Timeline({ snapshots, tracker }: TimelineProps) {
  if (snapshots.length === 0) return <TimelineEmpty tracker={tracker} />;

  return (
    <ol className="space-y-5">
      {groupByDay(snapshots).map((day) => (
        <li key={day.dayNumber}>
          <DayCard day={day} targetDomain={tracker.target_domain} />
        </li>
      ))}
    </ol>
  );
}

/** Newest day first; within a day, sample 1 first. */
function groupByDay(snapshots: Snapshot[]): Day[] {
  const byDay = new Map<number, Snapshot[]>();
  for (const snapshot of snapshots) {
    const samples = byDay.get(snapshot.day_number);
    if (samples) samples.push(snapshot);
    else byDay.set(snapshot.day_number, [snapshot]);
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => b - a)
    .map(([dayNumber, samples]) => ({
      dayNumber,
      samples: samples.sort((a, b) => a.sample - b.sample || a.captured_at.localeCompare(b.captured_at)),
    }));
}

function DayCard({ day, targetDomain }: { day: Day; targetDomain: string | null }) {
  const { dayNumber, samples } = day;
  const total = samples.length;
  const withOverview = samples.filter((s) => s.has_overview).length;
  // The day-level diff is stored on the day's first sample only. Day 1 has nothing to compare against.
  const diff = dayNumber > 1 ? (samples.find((s) => s.diff != null)?.diff ?? null) : null;
  const added = new Set((diff?.added_refs ?? []).map(urlKey));
  // Every source any sample cited, with how many of the day's samples cited it.
  const sources = aggregateCitations(samples);
  const capturedAt = samples.reduce((min, s) => (s.captured_at < min ? s.captured_at : min), samples[0].captured_at);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <NumberBadge>{dayNumber}</NumberBadge>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Day {dayNumber}</h2>
          <p className="flex items-center gap-1 text-xs text-ink-muted">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <LocalTime iso={capturedAt} mode="datetime" />
          </p>
        </div>
        <Chip tone={withOverview > 0 ? "good" : "warn"} className="ml-auto">
          AI Overview in {withOverview} of {pluralize(total, "sample")}
        </Chip>
      </div>

      {withOverview === 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-warn-soft p-4 text-sm text-warn">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>No AI Overview appeared in any sample this day. We keep checking.</p>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Sources Google cited</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            Google gives a different answer each time it is asked. These are the sources from all{" "}
            {pluralize(total, "sample")}, most often cited first.
          </p>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {sources.map((source) => (
              <li key={source.url}>
                <SourceLink
                  source={source}
                  totalSamples={total}
                  isNew={added.has(urlKey(source.url))}
                  isYours={!!targetDomain && domainMatches(source.domain, targetDomain)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff ? <ChangeSummary diff={diff} /> : null}

      {diff && (diff.changed_sentences.length > 0 || diff.removed_refs.length > 0) ? (
        <details className="group mt-4 rounded-xl border border-line bg-surface-alt px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">What changed since day {dayNumber - 1}</summary>
          {diff.changed_sentences.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {pluralize(diff.changed_sentences.length, "new sentence")}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">
                {diff.changed_sentences.map((sentence, index) => (
                  <li key={index}>{sentence}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {diff.removed_refs.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {pluralize(diff.removed_refs.length, "dropped source")}
              </p>
              <ul className="mt-1.5 space-y-1 text-ink-muted">
                {diff.removed_refs.map((url) => (
                  <li key={url} className="truncate">
                    <span className="font-semibold text-ink">{domainFromUrl(url)}</span>{" "}
                    <span className="text-xs">{url}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </details>
      ) : null}

      <details className="group mt-4 rounded-xl border border-line px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">
          Read {total === 1 ? "the sample" : `all ${total} samples`}
        </summary>
        <ol className="mt-2 divide-y divide-line">
          {samples.map((snapshot) => (
            <li key={snapshot.id} className="py-4">
              <SampleView snapshot={snapshot} />
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

/** One sample: when it was taken and the full AI Overview it got, if any. */
function SampleView({ snapshot }: { snapshot: Snapshot }) {
  const body = snapshot.overview_markdown ?? snapshot.overview_text;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">Sample {snapshot.sample}</span>
        <span className="text-xs text-ink-muted">
          <LocalTime iso={snapshot.captured_at} mode="datetime" />
        </span>
        {snapshot.has_overview ? (
          <Chip tone="good">AI Overview shown</Chip>
        ) : (
          <Chip tone="warn">No AI Overview</Chip>
        )}
      </div>
      <div className="mt-3">
        {snapshot.has_overview && body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-warn-soft p-4 text-sm text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>No AI Overview appeared in this sample.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeSummary({ diff }: { diff: NonNullable<Snapshot["diff"]> }) {
  const addedCount = diff.added_refs.length;
  const removedCount = diff.removed_refs.length;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Chip tone={addedCount > 0 ? "good" : "neutral"}>{pluralize(addedCount, "new source")}</Chip>
      <Chip tone={removedCount > 0 ? "warn" : "neutral"}>{pluralize(removedCount, "dropped source")}</Chip>
      {diff.text_similarity != null ? (
        <Chip tone="neutral">Text {Math.round(diff.text_similarity * 100)}% similar to the day before</Chip>
      ) : null}
    </div>
  );
}

function SourceLink({
  source,
  totalSamples,
  isNew,
  isYours,
}: {
  source: CitationRow;
  totalSamples: number;
  isNew: boolean;
  isYours: boolean;
}) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="nofollow noreferrer noopener"
      className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-alt"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{source.domain}</span>
          <Chip tone="neutral">
            in {source.samples_cited} of {pluralize(totalSamples, "sample")}
          </Chip>
          {isYours ? <Chip tone="brand">Your site</Chip> : null}
          {isNew ? <Chip tone="good">New today</Chip> : null}
        </span>
        {source.title ? <span className="mt-0.5 block truncate text-ink-muted">{source.title}</span> : null}
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
    </a>
  );
}

function TimelineEmpty({ tracker }: { tracker: Pick<Tracker, "status"> }) {
  if (tracker.status === "error") {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-ink">Today&apos;s capture didn&apos;t work</h2>
            <p className="mt-1 text-sm text-ink-muted">
              We couldn&apos;t fetch the search results for this keyword, so there is nothing to show yet.
              The reason is shown at the top of the page. Use{" "}
              <span className="font-semibold text-ink">Retry today&apos;s capture</span> above to try again.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-base font-bold text-ink">Nothing captured yet</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Your first day is on its way. Refresh this page in a minute.
      </p>
    </Card>
  );
}

/** Loose match so a diff url and a source url line up even if one has a trailing slash. */
function urlKey(url: string): string {
  return url.trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
}
