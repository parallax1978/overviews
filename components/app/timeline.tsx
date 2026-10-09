import { Clock, ExternalLink, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { LocalTime } from "@/components/ui/local-time";
import { Markdown } from "@/components/ui/markdown";
import { NumberBadge } from "@/components/ui/number-badge";
import type { OverviewReference, Snapshot, Tracker } from "@/lib/types";
import { domainFromUrl, domainMatches, pluralize } from "@/lib/utils";

export interface TimelineProps {
  /** Any order; the component shows the newest day first. */
  snapshots: Snapshot[];
  tracker: Pick<Tracker, "status" | "target_domain">;
}

/** Timeline tab: one card per captured day with the AI Overview, its sources and what changed. */
export function Timeline({ snapshots, tracker }: TimelineProps) {
  if (snapshots.length === 0) return <TimelineEmpty tracker={tracker} />;

  const newestFirst = [...snapshots].sort((a, b) => b.day_number - a.day_number);
  return (
    <ol className="space-y-5">
      {newestFirst.map((snapshot) => (
        <li key={snapshot.id}>
          <DayCard snapshot={snapshot} targetDomain={tracker.target_domain} />
        </li>
      ))}
    </ol>
  );
}

function DayCard({ snapshot, targetDomain }: { snapshot: Snapshot; targetDomain: string | null }) {
  const diff = snapshot.day_number > 1 ? snapshot.diff : null;
  const added = new Set((diff?.added_refs ?? []).map(urlKey));
  const body = snapshot.overview_markdown ?? snapshot.overview_text;
  const references = snapshot.references ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <NumberBadge>{snapshot.day_number}</NumberBadge>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Day {snapshot.day_number}</h2>
          <p className="flex items-center gap-1 text-xs text-ink-muted">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <LocalTime iso={snapshot.captured_at} mode="datetime" />
          </p>
        </div>
        {snapshot.has_overview ? (
          <Chip tone="good" className="ml-auto">
            AI Overview shown
          </Chip>
        ) : (
          <Chip tone="warn" className="ml-auto">
            No AI Overview
          </Chip>
        )}
      </div>

      {diff ? <ChangeSummary diff={diff} /> : null}

      <div className="mt-4">
        {snapshot.has_overview && body ? (
          <Markdown>{body}</Markdown>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-warn-soft p-4 text-sm text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>No AI Overview appeared this day. We keep checking.</p>
          </div>
        )}
      </div>

      {references.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">Sources Google cited</h3>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {references.map((ref, index) => (
              <li key={`${ref.url}-${index}`}>
                <SourceLink
                  reference={ref}
                  isNew={added.has(urlKey(ref.url))}
                  isYours={!!targetDomain && domainMatches(ref.domain || domainFromUrl(ref.url), targetDomain)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff && (diff.changed_sentences.length > 0 || diff.removed_refs.length > 0) ? (
        <details className="group mt-4 rounded-xl border border-line bg-surface-alt px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">
            What changed since day {snapshot.day_number - 1}
          </summary>
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
    </Card>
  );
}

function ChangeSummary({ diff }: { diff: NonNullable<Snapshot["diff"]> }) {
  const addedCount = diff.added_refs.length;
  const removedCount = diff.removed_refs.length;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Chip tone={addedCount > 0 ? "good" : "neutral"}>{pluralize(addedCount, "new source")}</Chip>
      <Chip tone={removedCount > 0 ? "warn" : "neutral"}>{pluralize(removedCount, "dropped source")}</Chip>
      {diff.text_similarity != null ? (
        <Chip tone="neutral">Text {Math.round(diff.text_similarity * 100)}% similar to the day before</Chip>
      ) : null}
    </div>
  );
}

function SourceLink({
  reference,
  isNew,
  isYours,
}: {
  reference: OverviewReference;
  isNew: boolean;
  isYours: boolean;
}) {
  const domain = reference.domain || domainFromUrl(reference.url);
  return (
    <a
      href={reference.url}
      target="_blank"
      rel="nofollow noreferrer noopener"
      className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-alt"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{domain}</span>
          {isYours ? <Chip tone="brand">Your site</Chip> : null}
          {isNew ? <Chip tone="good">New today</Chip> : null}
        </span>
        {reference.title ? <span className="mt-0.5 block truncate text-ink-muted">{reference.title}</span> : null}
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

/** Loose match so a diff url and a reference url line up even if one has a trailing slash. */
function urlKey(url: string): string {
  return url.trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
}
