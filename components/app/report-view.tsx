import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  Quote,
  TriangleAlert,
} from "lucide-react";
import { AnalyzeButton } from "@/components/app/analyze-button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import { Markdown } from "@/components/ui/markdown";
import { NumberBadge } from "@/components/ui/number-badge";
import type { Analysis, Tracker } from "@/lib/types";
import { pluralize } from "@/lib/utils";

export interface ReportViewProps {
  tracker: Pick<Tracker, "id" | "status" | "days_target">;
  /** The newest analysis row of any status, or null when none has been started. */
  analysis: Analysis | null;
  /** The newest finished report, or null when none has finished yet. */
  report: Analysis | null;
  /** Samples (across all days) in which an AI Overview actually appeared. */
  snapshotsWithOverview: number;
  /** Days with at least one sample that had an AI Overview; a fallback denominator for reports without days_total. */
  daysWithOverview?: number;
  /** Days captured so far. */
  dayCount: number;
  /** All days are in and the report predates the newest capture: offer a fresh one. */
  staleReport?: boolean;
}

const REPORT_CONTENTS = [
  "What Google keeps saying, day after day",
  "The sources it keeps citing, and what those pages do well",
  "A blueprint for a page built to get cited",
  "A finished draft you can copy and publish",
];

/** Report tab: intro and "Analyze now" before the report exists, progress while it runs, then the report. */
export function ReportView({
  tracker,
  analysis,
  report,
  snapshotsWithOverview,
  daysWithOverview = 0,
  dayCount,
  staleReport = false,
}: ReportViewProps) {
  if (tracker.status === "analyzing" || analysis?.status === "running") {
    return <Progress step={analysis?.step ?? null} />;
  }

  const canAnalyze = snapshotsWithOverview >= 1;
  const allDaysIn = tracker.status === "ready" || dayCount >= tracker.days_target;
  const reason =
    snapshotsWithOverview < 1
      ? allDaysIn
        ? `No AI Overview appeared on any of the ${tracker.days_target} days. This search may not show one. Try a different search.`
        : "No AI Overview has appeared for this search yet. We need at least one sample with one."
      : null;

  if (!report) {
    return (
      <div className="space-y-5">
        {analysis?.status === "error" ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-line bg-bad-soft p-5 text-sm text-bad">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">The last report didn&apos;t finish.</p>
              <p className="mt-1">{analysis.error ?? "Something went wrong while writing it."}</p>
            </div>
          </div>
        ) : null}
        <Intro
          tracker={tracker}
          dayCount={dayCount}
          canAnalyze={canAnalyze}
          reason={reason}
          label={analysis?.status === "error" ? "Try again" : "Analyze now"}
        />
      </div>
    );
  }

  // One call to action above the report: a failed re-run comes first, else a report that predates the last captures.
  return (
    <div className="space-y-5">
      {analysis?.status === "error" ? (
        <div
          role="alert"
          className="flex flex-col gap-4 rounded-2xl border border-line bg-bad-soft p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3 text-sm text-bad">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                We couldn&apos;t update this report, so this is the one from{" "}
                <LocalTime iso={report.created_at} mode="date" />.
              </p>
              <p className="mt-1">{analysis.error ?? "Something went wrong while writing it."}</p>
            </div>
          </div>
          <AnalyzeButton trackerId={tracker.id} disabled={false} reason={null} label="Try again" />
        </div>
      ) : staleReport ? (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ink">All {tracker.days_target} days are in.</p>
            <p className="mt-1 text-sm text-ink-muted">
              This report was built before the last captures. A fresh one uses every sample from every day.
            </p>
          </div>
          <AnalyzeButton trackerId={tracker.id} disabled={false} reason={null} label="Update the report" />
        </Card>
      ) : null}
      <Report
        tracker={tracker}
        analysis={report}
        snapshotsWithOverview={snapshotsWithOverview}
        daysWithOverview={daysWithOverview}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before the report

function Intro({
  tracker,
  dayCount,
  canAnalyze,
  reason,
  label,
}: {
  tracker: Pick<Tracker, "id" | "status" | "days_target">;
  dayCount: number;
  canAnalyze: boolean;
  reason: string | null;
  label: string;
}) {
  const allDaysIn = tracker.status === "ready" || dayCount >= tracker.days_target;
  return (
    <Card>
      <Eyebrow>Report</Eyebrow>
      <h2 className="mt-2 text-xl font-bold tracking-tight text-ink">
        {allDaysIn ? `All ${tracker.days_target} days are in` : `Your report comes on day ${tracker.days_target}`}
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        {allDaysIn
          ? "Build your report now. It takes two to five minutes."
          : `After ${tracker.days_target} days we read every AI Overview we captured and write you a report with:`}
      </p>
      {allDaysIn ? null : (
        <ul className="mt-4 space-y-2 text-sm text-ink">
          {REPORT_CONTENTS.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 border-t border-line pt-5">
        {allDaysIn ? null : (
          <p className="mb-3 text-sm text-ink-muted">
            Can&apos;t wait? You can get a first report from today&apos;s samples. Patterns get clearer with
            every day, and we write a fresh report once all {tracker.days_target} days are in.
          </p>
        )}
        <AnalyzeButton trackerId={tracker.id} disabled={!canAnalyze} reason={reason} label={label} />
      </div>
    </Card>
  );
}

function Progress({ step }: { step: string | null }) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-faint text-brand-strong">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">Writing your report</h2>
          <p className="mt-1 text-sm font-semibold text-brand-strong" aria-live="polite">
            {step ?? "Starting"}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            This takes two to five minutes. The page refreshes by itself, so you can leave it open.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The report

function Report({
  tracker,
  analysis,
  snapshotsWithOverview,
  daysWithOverview,
}: {
  tracker: Pick<Tracker, "id">;
  analysis: Analysis;
  snapshotsWithOverview: number;
  daysWithOverview: number;
}) {
  const patterns = analysis.patterns;
  const research = analysis.citation_research ?? [];
  const blueprint = analysis.blueprint;
  const claims = patterns?.recurring_claims ?? [];
  const entities = patterns?.repeated_entities ?? [];
  const sources = patterns?.frequent_sources ?? [];
  const differences = patterns?.differences ?? [];
  // The report records how many samples and days it was built from. Older reports
  // (one sample per day, no totals) fall back to what the snapshots and the counts say.
  const totalSamples = Math.max(
    analysis.samples_total ?? snapshotsWithOverview,
    1,
    ...claims.map((c) => samplesOr(c.samples_present, c.days_present)),
    ...entities.map((e) => samplesOr(e.samples_present, e.days_present)),
    ...sources.map((s) => samplesOr(s.samples_cited, s.days_cited)),
    ...research.map((r) => samplesOr(r.samples_cited, r.days_cited)),
  );
  const totalDays = Math.max(
    analysis.days_total ?? daysWithOverview,
    1,
    ...claims.map((c) => c.days_present),
    ...entities.map((e) => e.days_present),
    ...sources.map((s) => s.days_cited),
    ...research.map((r) => r.days_cited),
  );

  return (
    <div>
      {analysis.summary_md ? (
        <Card>
          <Eyebrow>In plain English</Eyebrow>
          <Markdown className="mt-2">{analysis.summary_md}</Markdown>
        </Card>
      ) : null}

      {patterns?.stable_core ? (
        <Section eyebrow="The stable core" title="What Google says every single day">
          <blockquote className="rounded-2xl border border-brand-soft bg-brand-faint p-5 text-sm leading-relaxed text-ink">
            <Quote className="mb-2 h-4 w-4 text-brand" aria-hidden="true" />
            {patterns.stable_core}
          </blockquote>
        </Section>
      ) : null}

      {claims.length > 0 ? (
        <Section eyebrow="Patterns" title="What Google keeps saying">
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {claims.map((claim, index) => (
              <li key={index} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-ink">{claim.claim}</p>
                  <SeenIn
                    samples={samplesOr(claim.samples_present, claim.days_present)}
                    totalSamples={totalSamples}
                    days={claim.days_present}
                    totalDays={totalDays}
                    tone="brand"
                  />
                </div>
                {claim.example ? <p className="mt-1 text-sm text-ink-muted">&ldquo;{claim.example}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {entities.length > 0 ? (
        <Section eyebrow="Patterns" title="Names that keep appearing">
          <ul className="grid gap-3 sm:grid-cols-2">
            {entities.map((entity, index) => (
              <li key={index} className="rounded-xl border border-line bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{entity.entity}</span>
                  <SeenIn
                    samples={samplesOr(entity.samples_present, entity.days_present)}
                    totalSamples={totalSamples}
                    days={entity.days_present}
                    totalDays={totalDays}
                    tone="neutral"
                  />
                </div>
                {entity.role ? <p className="mt-1 text-sm text-ink-muted">{entity.role}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {patterns?.formats ? (
        <Section eyebrow="Patterns" title="How the answer is shaped">
          <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-line bg-white p-5 sm:grid-cols-2">
            <Fact label="Opens with" value={patterns.formats.opening} />
            <Fact label="Structure" value={patterns.formats.structure} />
            <Fact label="Uses a table" value={patterns.formats.uses_table ? "Yes" : "No"} />
            <Fact label="Uses a list" value={patterns.formats.uses_list ? "Yes" : "No"} />
            <Fact label="Typical length" value={`About ${pluralize(patterns.formats.typical_length_words, "word")}`} />
          </dl>
        </Section>
      ) : null}

      {sources.length > 0 ? (
        <Section eyebrow="Patterns" title="Sources Google keeps citing">
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {sources.map((source, index) => (
              <li key={index} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{source.domain}</span>
                    <SeenIn
                      samples={samplesOr(source.samples_cited, source.days_cited)}
                      totalSamples={totalSamples}
                      days={source.days_cited}
                      totalDays={totalDays}
                      tone="brand"
                    />
                  </div>
                  {source.cited_for ? <p className="mt-1 text-sm text-ink-muted">Cited for: {source.cited_for}</p> : null}
                </div>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="nofollow noreferrer noopener"
                    aria-label={`Open ${source.domain}`}
                    className="text-ink-soft hover:text-brand"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {differences.length > 0 ? (
        <Section eyebrow="Patterns" title="How it changed from day to day">
          <ul className="space-y-3">
            {differences.map((difference, index) => (
              <li key={index} className="flex items-start gap-3">
                <NumberBadge>{difference.day}</NumberBadge>
                <p className="pt-1 text-sm text-ink">{difference.what_changed}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {research.length > 0 ? (
        <Section eyebrow="Citation teardown" title="Inside the cited pages">
          <ul className="grid gap-4 lg:grid-cols-2">
            {research.map((item, index) => (
              <li key={index} className="rounded-2xl border border-line bg-white p-5 shadow-pop">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="nofollow noreferrer noopener"
                    className="inline-flex items-center gap-1 font-semibold text-ink hover:text-brand"
                  >
                    {item.domain}
                    <ExternalLink className="h-3.5 w-3.5 text-ink-soft" aria-hidden="true" />
                  </a>
                  <Chip tone="neutral">
                    {samplesOr(item.samples_cited, item.days_cited)} of {totalSamples} samples
                  </Chip>
                  <Chip tone={item.fetched ? "good" : "warn"}>
                    {item.fetched ? "We read the page" : "From Google's snippet only"}
                  </Chip>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <Fact label="How fast it answers" value={item.answers_how_fast} />
                  {item.topics_covered.length > 0 ? (
                    <Fact label="Covers" value={<ChipList items={item.topics_covered} />} />
                  ) : null}
                  <Fact
                    label="Layout"
                    value={[
                      item.structure,
                      item.uses_tables ? "Has tables" : null,
                      item.uses_lists ? "Has lists" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  {item.data_included.length > 0 ? (
                    <Fact label="Data it includes" value={<BulletList items={item.data_included} />} />
                  ) : null}
                  {item.gaps.length > 0 ? (
                    <Fact label="What it misses" value={<BulletList items={item.gaps} tone="warn" />} />
                  ) : null}
                  {item.how_to_beat ? (
                    <Fact label="How to beat it" value={<span className="font-medium text-good">{item.how_to_beat}</span>} />
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {blueprint ? (
        <Section eyebrow="Your page blueprint" title="How your page beats them">
          <Card>
            <div className="flex items-start gap-3">
              <BookOpen className="mt-1 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
              <div>
                <p className="text-sm text-ink-muted">Goal</p>
                <p className="font-medium text-ink">{blueprint.page_goal}</p>
                <p className="mt-3 text-sm text-ink-muted">The question to answer</p>
                <p className="font-semibold text-ink">{blueprint.target_question}</p>
              </div>
            </div>

            {blueprint.winning_angle ? (
              <div className="mt-5 rounded-xl bg-good-soft px-4 py-3">
                <p className="text-sm font-semibold text-good">Your winning angle</p>
                <p className="mt-1 text-sm text-ink">{blueprint.winning_angle}</p>
              </div>
            ) : null}

            {(blueprint.gaps_to_fill ?? []).length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Gaps to fill (what no cited page gives)</p>
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {blueprint.gaps_to_fill.map((item, index) => (
                    <li key={index} className="px-4 py-2.5 text-sm">
                      <span className="font-medium text-ink">{item.gap}</span>
                      {item.found_in ? <span className="text-ink-muted"> · missing from {item.found_in}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(blueprint.contradictions_to_settle ?? []).length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Contradictions to settle</p>
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {blueprint.contradictions_to_settle.map((item, index) => (
                    <li key={index} className="px-4 py-2.5 text-sm">
                      <span className="font-medium text-ink">{item.topic}</span>
                      {item.what_sources_say ? <span className="text-ink-muted"> · {item.what_sources_say}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {blueprint.opening_answer ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Open with this answer</p>
                <blockquote className="mt-2 rounded-xl border-l-4 border-brand bg-surface-alt px-4 py-3 text-sm text-ink">
                  {blueprint.opening_answer}
                </blockquote>
              </div>
            ) : null}

            {blueprint.recommended_format ? (
              <p className="mt-5 text-sm text-ink">
                <span className="font-semibold">Shape:</span> {blueprint.recommended_format}
              </p>
            ) : null}

            {blueprint.must_cover.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Questions the page must answer</p>
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {blueprint.must_cover.map((item, index) => (
                    <li key={index} className="px-4 py-2.5 text-sm">
                      <span className="font-medium text-ink">{item.topic}</span>
                      {item.why ? <span className="text-ink-muted"> · {item.why}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {(blueprint.terms_to_cover ?? []).length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Terms to explain</p>
                <div className="mt-2">
                  <ChipList items={blueprint.terms_to_cover} tone="brand" />
                </div>
              </div>
            ) : null}

            {(blueprint.brands_google_names ?? []).length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Brands Google named</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  For reference only. Your page does not need to mention them; the draft follows your
                  &ldquo;name other brands&rdquo; setting.
                </p>
                <div className="mt-2">
                  <ChipList items={blueprint.brands_google_names} tone="neutral" />
                </div>
              </div>
            ) : null}

            {blueprint.sections.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Sections, in order</p>
                <ol className="mt-2 space-y-2">
                  {blueprint.sections.map((section, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <NumberBadge>{index + 1}</NumberBadge>
                      <div className="min-w-0 pt-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{section.heading}</span>
                          <Chip tone="neutral">{section.format}</Chip>
                        </div>
                        {section.purpose ? <p className="text-sm text-ink-muted">{section.purpose}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {blueprint.something_new.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-semibold text-ink">Add something new</p>
                <ul className="mt-2 space-y-2">
                  {blueprint.something_new.map((idea, index) => (
                    <li key={index} className="flex items-start gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                      <div>
                        <p className="font-medium text-ink">{idea.idea}</p>
                        {idea.why_google_would_cite_it ? (
                          <p className="mt-0.5 text-ink-muted">{idea.why_google_would_cite_it}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <div className="mt-8 flex justify-end">
        <Link
          href={`/app/${tracker.id}?tab=draft`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-strong"
        >
          See the page we wrote
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks

/** Reports written before sampling carry only day counts; back then one sample was one day. */
function samplesOr(samples: number | null | undefined, days: number): number {
  return typeof samples === "number" && Number.isFinite(samples) ? samples : days;
}

/** "18 of 21 samples" as a chip, with the day count muted beside it. */
function SeenIn({
  samples,
  totalSamples,
  days,
  totalDays,
  tone,
}: {
  samples: number;
  totalSamples: number;
  days: number;
  totalDays: number;
  tone: "brand" | "neutral";
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip tone={tone}>
        {samples} of {totalSamples} samples
      </Chip>
      <span className="text-xs text-ink-muted">
        ({days} of {totalDays} days)
      </span>
    </span>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-1 text-xl font-bold tracking-tight text-ink">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function ChipList({ items, tone = "neutral" }: { items: string[]; tone?: "neutral" | "brand" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => (
        <Chip key={index} tone={tone}>
          {item}
        </Chip>
      ))}
    </div>
  );
}

function BulletList({ items, tone = "ink" }: { items: string[]; tone?: "ink" | "warn" }) {
  return (
    <ul className={tone === "warn" ? "list-disc pl-4 text-warn" : "list-disc pl-4 text-ink"}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
