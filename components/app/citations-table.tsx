import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { CitationRow } from "@/lib/citations";
import { cn, domainMatches, pluralize } from "@/lib/utils";

export interface CitationsTableProps {
  rows: CitationRow[];
  /** Samples captured so far, across all days; the "x of N samples" denominator. */
  totalSamples: number;
  /** Days captured so far; the "y of D days" denominator. */
  totalDays: number;
  /** The user's own website, to highlight their rows. */
  targetDomain: string | null;
}

/** Citations tab: every source Google has cited, most consistent first. */
export function CitationsTable({ rows, totalSamples, totalDays, targetDomain }: CitationsTableProps) {
  if (rows.length === 0) {
    return (
      <Card>
        <h2 className="text-base font-bold text-ink">No sources yet</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Google has not cited any pages for this search so far. Sources show up here as soon as an AI
          Overview appears.
        </p>
      </Card>
    );
  }

  const sampleDenominator = Math.max(totalSamples, 1);
  const dayDenominator = Math.max(totalDays, 1);

  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted">
        {rows.length === 1 ? "One source" : `${rows.length} sources`} seen in{" "}
        {pluralize(sampleDenominator, "sample")} over {pluralize(dayDenominator, "day")}. Google gives a
        slightly different answer each time it is asked, so we count every sample. The ones at the top are
        what Google keeps coming back to.
      </p>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  Source
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  Samples
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  Days
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  First seen
                </th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  Last seen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const yours = !!targetDomain && domainMatches(row.domain, targetDomain);
                const share = Math.min(1, row.samples_cited / sampleDenominator);
                return (
                  <tr key={row.url} className={cn(yours && "bg-brand-faint")}>
                    <td className="max-w-md px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{row.domain}</span>
                        {yours ? <Chip tone="brand">Your site</Chip> : null}
                      </div>
                      <a
                        href={row.url}
                        target="_blank"
                        rel="nofollow noreferrer noopener"
                        title={row.title ?? row.url}
                        className="mt-0.5 inline-flex max-w-full items-center gap-1 text-ink-muted hover:text-brand"
                      >
                        <span className="line-clamp-1 break-all">{row.title ?? row.url}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <span className="font-semibold text-ink">
                        {row.samples_cited} of {sampleDenominator} samples
                      </span>
                      <span
                        className="mt-1.5 block h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken"
                        aria-hidden="true"
                      >
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${share * 100}%` }} />
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-ink-muted">
                      {row.days_cited} of {dayDenominator} days
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-ink-muted">Day {row.first_day}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-ink-muted">Day {row.last_day}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
