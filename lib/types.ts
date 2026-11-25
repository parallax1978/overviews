/**
 * Shared domain types. These mirror the Postgres schema in
 * supabase/migrations/0001_init.sql and the JSON shapes produced by
 * lib/dataforseo.ts and lib/claude.ts. Keep the three in sync.
 */

import type { BillingSource, PlanId } from "@/lib/plans";

export type { BillingSource, PlanId } from "@/lib/plans";

export type TrackerStatus =
  | "tracking" // capturing daily snapshots, not yet at days_target
  | "ready" // days_target reached, analysis not run (or failed)
  | "analyzing" // analysis + draft in progress
  | "analyzed" // report and draft exist
  | "paused" // user paused daily capture
  | "error"; // day-1 capture failed; user can retry

export type CompetitorPolicy = "avoid" | "compare";

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
  /** "avoid": the written page never recommends other brands (default). "compare": it may name them in a fair comparison. */
  competitor_policy: CompetitorPolicy;
  /** Which keys this keyword's API calls run on: the app's (paid with credits) or the owner's own. */
  billing_source: BillingSource;
  status: TrackerStatus;
  days_target: number;
  day_count: number;
  next_capture_at: string | null;
  keep_tracking: boolean;
  cited_on_day: number | null;
  last_error: string | null;
  /** Set while the report is shared: anyone with /share/<token> can read it. */
  share_token: string | null;
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
  /** The concrete way the new page beats this one. */
  how_to_beat: string;
}

/** The plan for a page that beats every cited page, not one that matches them. */
export interface PageBlueprint {
  page_goal: string;
  target_question: string;
  /** The one thing that makes this page the best answer. */
  winning_angle: string;
  /** What no cited page gives the searcher, and which pages lack it. */
  gaps_to_fill: { gap: string; found_in: string }[];
  /** Where the cited pages disagree; the new page settles it with checked facts. */
  contradictions_to_settle: { topic: string; what_sources_say: string }[];
  /** The questions the searcher has, each with the evidence it matters. */
  must_cover: { topic: string; why: string }[];
  /** Non-brand terms and concepts the searcher expects (policies, metrics, risks, steps). */
  terms_to_cover: string[];
  /** Brands Google named, for reference only; the page is not required to mention them. */
  brands_google_names: string[];
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
  /** Set while a draft for this report is being written (claim with a 15-minute TTL); null otherwise. */
  draft_started_at: string | null;
  usage: unknown;
  error: string | null;
}

/**
 * "researched": ready to publish, every figure sourced from the web and cited.
 * "placeholders": the author fills in their own data where [ADD YOUR DATA: ...] marks it.
 */
export type DraftMode = "researched" | "placeholders";

export interface DraftSource {
  url: string;
  title: string;
  /** What the page took from this source, in a few words. */
  used_for: string;
}

export interface Draft {
  id: string;
  tracker_id: string;
  analysis_id: string | null;
  created_at: string;
  mode: DraftMode;
  /** Sources a researched draft relied on; null or empty for placeholder drafts. */
  sources: DraftSource[] | null;
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
  provider: "dataforseo" | "anthropic" | "stripe" | "google" | "getresponse";
  endpoint: string;
  status: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  error?: string | null;
  /** Whose keys made the call. Defaults to "platform". */
  billing_source?: BillingSource;
  /** The keyword owner, so per-user spend can be read back. */
  user_id?: string | null;
}

/** A user's plan, Stripe link and credit balance (table accounts). */
export interface Account {
  user_id: string;
  plan: PlanId;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  credits_balance: number;
  /** When the user was added to the GetResponse mailing list; null until then. */
  marketing_synced_at?: string | null;
  /** The plan whose monthly credits were granted for the billing period starting granted_period_start. */
  granted_plan: PlanId | null;
  granted_period_start: string | null;
  created_at: string;
  updated_at: string;
}

/** One credit movement (table credit_ledger). */
export interface CreditLedgerEntry {
  id: number;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  tracker_id: string | null;
  external_id: string | null;
  note: string | null;
  created_at: string;
}

/** What the settings page may show about a user's own keys. Never contains a secret. */
export interface OwnKeysStatus {
  dataforseo: { saved: boolean; hint: string | null; checkedAt: string | null };
  anthropic: { saved: boolean; hint: string | null; workspaceId: string | null; checkedAt: string | null };
  /** Both keys saved: keywords can run on them. */
  complete: boolean;
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
