/**
 * Day-over-day comparison of AI Overview snapshots. Pure functions, used
 * for display only (the Timeline tab highlights what changed since yesterday).
 *
 * A day has several samples (Google writes a different overview for every
 * request), so a day is compared as the union of its samples' cited sources,
 * and its text is the first sample that had an overview.
 */
import type { OverviewReference, SnapshotDiff } from "@/lib/types";
import { normalizeUrl } from "@/lib/overview";

const MAX_CHANGED_SENTENCES = 40;
const MIN_SENTENCE_LENGTH = 20;
const MIN_TOKEN_LENGTH = 2; // tokens must be longer than this

/** One sample's text and citations: the only snapshot fields the diff needs. */
export interface Comparable {
  text: string | null;
  references: OverviewReference[];
}

/**
 * Compares today's samples with yesterday's. Citations are the union across
 * each day's samples; the text fields use the first sample of each day that
 * has an overview, and a sentence only counts as new when no sample of the
 * previous day had it. With no previous day every current citation counts as
 * added and the text fields are left empty.
 */
export function computeDayDiff(prev: Comparable[] | null, curr: Comparable[]): SnapshotDiff {
  const currUrls = uniqueUrls(curr);
  if (prev === null) {
    return {
      added_refs: [...currUrls.values()],
      removed_refs: [],
      text_similarity: null,
      changed_sentences: [],
    };
  }

  const prevUrls = uniqueUrls(prev);
  const added = [...currUrls].filter(([key]) => !prevUrls.has(key)).map(([, url]) => url);
  const removed = [...prevUrls].filter(([key]) => !currUrls.has(key)).map(([, url]) => url);
  const prevTexts = overviewTexts(prev);
  const currText = overviewTexts(curr)[0] ?? null;

  return {
    added_refs: added,
    removed_refs: removed,
    text_similarity: jaccardSimilarity(prevTexts[0] ?? null, currText),
    changed_sentences: newSentences(prevTexts, currText),
  };
}

/** One snapshot per day: the same comparison for callers written before sampling. */
export function computeDiff(prev: Comparable | null, curr: Comparable): SnapshotDiff {
  return computeDayDiff(prev ? [prev] : null, [curr]);
}

/** normalized url -> first url string seen with that key, across every sample of the day */
function uniqueUrls(samples: Comparable[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const sample of samples) {
    for (const ref of Array.isArray(sample.references) ? sample.references : []) {
      if (!ref || typeof ref.url !== "string" || !ref.url.trim()) continue;
      const key = normalizeUrl(ref.url);
      if (!map.has(key)) map.set(key, ref.url.trim());
    }
  }
  return map;
}

/** The texts of the samples that had an overview, in sample order. */
function overviewTexts(samples: Comparable[]): string[] {
  return samples.map((s) => s.text).filter((t): t is string => t !== null);
}

/** Lower-cased word tokens longer than two characters. */
export function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.filter((t) => t.length > MIN_TOKEN_LENGTH));
}

/** Jaccard similarity (0..1) of the two texts' token sets; null when either text is missing. */
export function jaccardSimilarity(a: string | null, b: string | null): number | null {
  if (a === null || b === null) return null;
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : Math.round((shared / union) * 10_000) / 10_000;
}

/** Sentences (split on . ! ? followed by whitespace, or a line break), whitespace-normalized, longer than 20 chars. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > MIN_SENTENCE_LENGTH);
}

/** Sentences in `curr` that do not appear verbatim in any of the `prev` texts, capped at 40. */
function newSentences(prev: string[], curr: string | null): string[] {
  if (curr === null) return [];
  const previous = new Set(prev.flatMap(splitSentences));
  const seen = new Set<string>();
  const changed: string[] = [];
  for (const sentence of splitSentences(curr)) {
    if (previous.has(sentence) || seen.has(sentence)) continue;
    seen.add(sentence);
    changed.push(sentence);
    if (changed.length >= MAX_CHANGED_SENTENCES) break;
  }
  return changed;
}
