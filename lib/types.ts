/**
 * Shared domain types. These mirror the Postgres schema in
 * supabase/migrations/0001_init.sql and the JSON shapes produced by
 * lib/dataforseo.ts and lib/claude.ts. Keep the three in sync.
 */

export type TrackerStatus =
  | "tracking" // capturing daily snapshots, not yet at days_target
  | "ready" // days_target reached, analysis not run (or failed)
  | "analyzing" // analysis + draft in progress
  | "analyzed" // report and draft exist
  | "paused" // user paused daily capture
  | "error"; // day-1 capture failed; user can retry

export interface Tracker {
  id: string;
  user_id: string;
  keyword: string;
  location_code: number;
  location_name: string;
  language_code: string;
  device: "desktop" | "mobile";
  target_domain: string | null;
  user_edge: string | null;
  status: TrackerStatus;
  days_target: number;
  day_count: number;
  next_capture_at: string | null;
  keep_tracking: boolean;
  cited_on_day: number | null;
  last_error: string | null;
  created_at: string;
}

/** One source Google cited inside the AI Overview. */
export interface OverviewReference {
  url: string;
  domain: string;
  title: string | null;
  /** The snippet Google showed for this source (from DataForSEO `text`). */
  snippet: string | null;
  source: string | null;
  /** Index of the ai_overview item (paragraph/table/expanded block) that cited it; -1 for top-level references. */
  element_index: number;
}

/** A link embedded inline in the AI Overview text (e.g. a product name linked to its site). */
export interface OverviewInlineLink {
  url: string;
  domain: string;
  title: string | null;
}

export interface SnapshotDiff {
  added_refs: string[]; // urls present today, absent yesterday
  removed_refs: string[]; // urls present yesterday, absent today
  /** 0..1 token Jaccard similarity of overview text vs previous day; null when either day has no overview */
  text_similarity: number | null;
  /** sentences present today but not yesterday */
  changed_sentences: string[];
}

/**
 * Google generates a different AI Overview for every request (three identical
 * back-to-back requests shared no cited source), so each daily capture takes
 * this many samples. Reports count appearances across all samples.
 */
export const SAMPLES_PER_DAY = 3;

export interface Snapshot {
  id: string;
  tracker_id: string;
  day_number: number;
  /** 1-based index of this sample within its day (1..SAMPLES_PER_DAY). */
  sample: number;
  captured_at: string;
  has_overview: boolean;
  overview_text: string | null;
  overview_markdown: string | null;
  references: OverviewReference[];
  inline_links: OverviewInlineLink[];
  raw: unknown;
  content_hash: string | null;
  /** Day-level change versus the previous day; stored on the day's first sample only, null on the others. */
  diff: SnapshotDiff | null;
  cost_usd: number;
}

/** Output of the first Claude call (patterns + citation teardown + page blueprint). */
export interface AnalysisPatterns {
  /** samples_present = distinct samples the claim appeared in; days_present = distinct days. */
  recurring_claims: { claim: string; samples_present: number; days_present: number; example: string }[];
  repeated_entities: { entity: string; samples_present: number; days_present: number; role: string }[];
  formats: {
    opening: string;
    structure: string;
    uses_table: boolean;
    uses_list: boolean;
    typical_length_words: number;
  };
  frequent_sources: {
    domain: string;
    url: string;
    samples_cited: number;
    days_cited: number;
    cited_for: string;
  }[];
  differences: { day: number; what_changed: string }[];
  stable_core: string;
}

export interface CitationResearchItem {
  url: string;
  domain: string;
  samples_cited: number;
  days_cited: number;
  fetched: boolean;
  answers_how_fast: string;
  topics_covered: string[];
  entities_covered: string[];
  structure: string;
  uses_tables: boolean;
  uses_lists: boolean;
  data_included: string[];
  gaps: string[];
}

export interface PageBlueprint {
  page_goal: string;
  target_question: string;
  must_cover: { topic: string; why: string }[];
  must_mention: string[];
  recommended_format: string;
  opening_answer: string;
  sections: {
    heading: string;
    purpose: string;
    format: "paragraph" | "table" | "list" | "faq";
  }[];
  something_new: { idea: string; why_google_would_cite_it: string }[];
}

export type AnalysisStatus = "running" | "done" | "error";

export interface Analysis {
  id: string;
  tracker_id: string;
  created_at: string;
  status: AnalysisStatus;
  /** Progress label shown to the user while status = running. */
  step: string | null;
  model: string | null;
  patterns: AnalysisPatterns | null;
  citation_research: CitationResearchItem[] | null;
  blueprint: PageBlueprint | null;
  summary_md: string | null;
  /** How many samples / distinct days the report was built from (null on rows from before sampling). */
  samples_total: number | null;
  days_total: number | null;
  usage: unknown;
  error: string | null;
}

export interface Draft {
  id: string;
  tracker_id: string;
  analysis_id: string | null;
  created_at: string;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  outline: { heading: string; summary: string }[] | null;
  content_md: string | null;
  why_better_md: string | null;
  notes: string | null;
  model: string | null;
  usage: unknown;
}

/** Row written for every external API call, used for cost reporting. */
export interface ApiLogInsert {
  tracker_id?: string | null;
  provider: "dataforseo" | "anthropic";
  endpoint: string;
  status: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error?: string | null;
}

/** Supported countries for the "Add keyword" form (DataForSEO location codes). */
export const LOCATIONS: { code: number; name: string }[] = [
  { code: 2840, name: "United States" },
  { code: 2826, name: "United Kingdom" },
  { code: 2124, name: "Canada" },
  { code: 2036, name: "Australia" },
  { code: 2372, name: "Ireland" },
  { code: 2554, name: "New Zealand" },
  { code: 2276, name: "Germany" },
  { code: 2250, name: "France" },
  { code: 2724, name: "Spain" },
  { code: 2380, name: "Italy" },
  { code: 2528, name: "Netherlands" },
  { code: 2356, name: "India" },
];

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
];

export const DEFAULT_DAYS_TARGET = 7;
