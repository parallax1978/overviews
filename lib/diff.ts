/**
 * Day-over-day comparison of two AI Overview snapshots. Pure functions, used
 * for display only (the Timeline tab highlights what changed since yesterday).
 */
import type { OverviewReference, SnapshotDiff } from "@/lib/types";
import { normalizeUrl } from "@/lib/overview";

const MAX_CHANGED_SENTENCES = 40;
const MIN_SENTENCE_LENGTH = 20;
const MIN_TOKEN_LENGTH = 2; // tokens must be longer than this

interface Comparable {
  text: string | null;
  references: OverviewReference[];
}

/**
 * Compares today's snapshot with yesterday's. With no previous snapshot every
 * current citation counts as added and the text fields are left empty.
 */
export function computeDiff(prev: Comparable | null, curr: Comparable): SnapshotDiff {
  const currUrls = uniqueUrls(curr.references);
  if (prev === null) {
    return {
      added_refs: [...currUrls.values()],
      removed_refs: [],
      text_similarity: null,
      changed_sentences: [],
    };
  }

  const prevUrls = uniqueUrls(prev.references);
  const added = [...currUrls].filter(([key]) => !prevUrls.has(key)).map(([, url]) => url);
  const removed = [...prevUrls].filter(([key]) => !currUrls.has(key)).map(([, url]) => url);

  return {
    added_refs: added,
    removed_refs: removed,
    text_similarity: jaccardSimilarity(prev.text, curr.text),
    changed_sentences: newSentences(prev.text, curr.text),
  };
}

/** normalized url -> first url string seen with that key */
function uniqueUrls(references: OverviewReference[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ref of Array.isArray(references) ? references : []) {
    if (!ref || typeof ref.url !== "string" || !ref.url.trim()) continue;
    const key = normalizeUrl(ref.url);
    if (!map.has(key)) map.set(key, ref.url.trim());
  }
  return map;
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

/** Sentences in `curr` that do not appear verbatim in `prev`, capped at 40. */
function newSentences(prev: string | null, curr: string | null): string[] {
  if (curr === null) return [];
  const previous = new Set(prev === null ? [] : splitSentences(prev));
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
