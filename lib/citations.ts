/**
 * Pure helpers for the Citations tab: fold every day's references into one
 * row per source, so the user can see what Google keeps including.
 * No IO here; the page passes in the snapshots it already loaded.
 */
import type { Snapshot } from "@/lib/types";
import { domainFromUrl } from "@/lib/utils";

/** The only snapshot fields the citation views need. */
export type CitationSnapshot = Pick<Snapshot, "day_number" | "references" | "has_overview">;

/** One source Google cited on at least one day, with the days it appeared. */
export interface CitationRow {
  url: string;
  domain: string;
  title: string | null;
  /** Number of distinct days this source was cited. */
  days_cited: number;
  first_day: number;
  last_day: number;
  /** Ascending list of the day numbers it was cited on. */
  days: number[];
  /** The snippet Google showed for it (first one seen). */
  snippet: string | null;
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
 * One row per distinct URL across all days, sorted by days cited (most first),
 * then domain, then URL. Days without an AI Overview contribute nothing.
 */
export function aggregateCitations(snapshots: CitationSnapshot[]): CitationRow[] {
  const byKey = new Map<string, { row: CitationRow; days: Set<number> }>();

  for (const snapshot of snapshots) {
    if (!snapshot.has_overview) continue;
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
            days_cited: 0,
            first_day: snapshot.day_number,
            last_day: snapshot.day_number,
            days: [],
            snippet: ref.snippet ?? null,
          },
          days: new Set<number>(),
        };
        byKey.set(key, entry);
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
      b.days_cited - a.days_cited || a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url),
  );
  return rows;
}

/** Number of distinct domains Google cited across all days. */
export function countDomains(snapshots: CitationSnapshot[]): number {
  const domains = new Set<string>();
  for (const row of aggregateCitations(snapshots)) domains.add(row.domain);
  return domains.size;
}
