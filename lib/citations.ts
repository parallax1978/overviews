/**
 * Pure helpers for the Citations tab and the Timeline: fold every sample's
 * references into one row per source, so the user can see what Google keeps
 * including. Google writes a different AI Overview for every request, so a
 * day holds several samples (SAMPLES_PER_DAY) and the main count is how many
 * samples cited a source; distinct days is the secondary number.
 * No IO here; the page passes in the snapshots it already loaded.
 */
import type { Snapshot } from "@/lib/types";
import { domainFromUrl } from "@/lib/utils";

/** The only snapshot fields the citation views need. */
export type CitationSnapshot = Pick<Snapshot, "day_number" | "sample" | "references" | "has_overview">;

/** One source Google cited in at least one sample, with how often it appeared. */
export interface CitationRow {
  url: string;
  domain: string;
  title: string | null;
  /** The snippet Google showed for it (first one seen). */
  snippet: string | null;
  /** Number of samples (across all days) whose references include this source. A sample counts once. */
  samples_cited: number;
  /** Number of distinct days this source was cited on. */
  days_cited: number;
  /** Ascending list of the day numbers it was cited on. */
  days: number[];
  first_day: number;
  last_day: number;
}

/** Totals the citation views use as denominators. */
export interface CitationTotals {
  /** Samples captured, across all days. */
  samples: number;
  /** Distinct days captured. */
  days: number;
  /** Samples in which an AI Overview appeared. */
  samplesWithOverview: number;
  /** Distinct days with at least one sample that had an AI Overview. */
  daysWithOverview: number;
}

/** Key that treats "https://www.A.com/x/" and "https://a.com/x#top" as the same source. */
function citationKey(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}${parsed.search}`;
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
  }
}

/** Bare lower-case domain for a reference, derived from the URL when the row has none. */
function cleanDomain(domain: string | null | undefined, url: string): string {
  const given = (domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  return given || domainFromUrl(url).toLowerCase();
}

/**
 * One row per distinct URL across all samples of all days, sorted by samples
 * cited (most first), then days cited, then domain, then URL. A sample that
 * cites the same page twice counts once. Samples without an AI Overview
 * contribute nothing.
 */
export function aggregateCitations(snapshots: CitationSnapshot[]): CitationRow[] {
  const byKey = new Map<string, { row: CitationRow; days: Set<number> }>();

  for (const snapshot of snapshots) {
    if (!snapshot.has_overview) continue;
    const seenInSample = new Set<string>();
    for (const ref of snapshot.references ?? []) {
      if (!ref?.url) continue;
      const key = citationKey(ref.url);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          row: {
            url: ref.url,
            domain: cleanDomain(ref.domain, ref.url),
            title: ref.title ?? null,
            snippet: ref.snippet ?? null,
            samples_cited: 0,
            days_cited: 0,
            days: [],
            first_day: snapshot.day_number,
            last_day: snapshot.day_number,
          },
          days: new Set<number>(),
        };
        byKey.set(key, entry);
      }
      if (!seenInSample.has(key)) {
        seenInSample.add(key);
        entry.row.samples_cited += 1;
      }
      entry.days.add(snapshot.day_number);
      if (!entry.row.title && ref.title) entry.row.title = ref.title;
      if (!entry.row.snippet && ref.snippet) entry.row.snippet = ref.snippet;
    }
  }

  const rows = Array.from(byKey.values(), ({ row, days }) => {
    const sorted = Array.from(days).sort((a, b) => a - b);
    return {
      ...row,
      days: sorted,
      days_cited: sorted.length,
      first_day: sorted[0],
      last_day: sorted[sorted.length - 1],
    };
  });

  rows.sort(
    (a, b) =>
      b.samples_cited - a.samples_cited ||
      b.days_cited - a.days_cited ||
      a.domain.localeCompare(b.domain) ||
      a.url.localeCompare(b.url),
  );
  return rows;
}

/** How many samples and days were captured, and how many of each had an AI Overview. */
export function countTotals(snapshots: CitationSnapshot[]): CitationTotals {
  const days = new Set<number>();
  const daysWithOverview = new Set<number>();
  let samplesWithOverview = 0;
  for (const snapshot of snapshots) {
    days.add(snapshot.day_number);
    if (snapshot.has_overview) {
      samplesWithOverview += 1;
      daysWithOverview.add(snapshot.day_number);
    }
  }
  return {
    samples: snapshots.length,
    days: days.size,
    samplesWithOverview,
    daysWithOverview: daysWithOverview.size,
  };
}

/** Number of distinct domains Google cited across all samples. */
export function countDomains(snapshots: CitationSnapshot[]): number {
  const domains = new Set<string>();
  for (const row of aggregateCitations(snapshots)) domains.add(row.domain);
  return domains.size;
}
