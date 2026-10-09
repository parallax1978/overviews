/**
 * Prompt texts and prompt builders for the two Claude calls in lib/claude.ts.
 * Pure functions, no IO, so they can be unit tested.
 */

import type {
  AnalysisPatterns,
  CitationResearchItem,
  OverviewInlineLink,
  OverviewReference,
  PageBlueprint,
} from "@/lib/types";
import { pluralize } from "@/lib/utils";

/**
 * One captured sample (one request on one day), as handed to the analysis
 * prompt. Google answers every request differently, so a day holds several.
 */
export interface AnalysisSnapshotInput {
  day_number: number;
  /** 1-based index of this sample within its day. */
  sample: number;
  captured_at: string;
  has_overview: boolean;
  overview_text: string | null;
  overview_markdown: string | null;
  references: OverviewReference[];
  inline_links: OverviewInlineLink[];
}

/** Everything the analysis call needs to know about one keyword. */
export interface AnalysisInput {
  keyword: string;
  locationName: string;
  languageCode: string;
  snapshots: AnalysisSnapshotInput[];
  targetDomain: string | null;
  userEdge: string | null;
}

/** A cited URL ranked by how many samples (then how many days) Google cited it in. */
export interface CandidateUrl {
  url: string;
  domain: string;
  title: string | null;
  /** Distinct samples, across all days, that cited the URL. */
  samples_cited: number;
  /** Distinct days on which at least one sample cited the URL. */
  days_cited: number;
}

/** Everything the draft call needs to write (or revise) the page. */
export interface DraftInput {
  keyword: string;
  blueprint: PageBlueprint;
  patterns: AnalysisPatterns;
  citationResearch: CitationResearchItem[];
  stableCore: string;
  userEdge: string | null;
  targetDomain: string | null;
  notes: string | null;
  previousDraft: { title: string; content_md: string } | null;
}

export const ANALYSIS_SYSTEM_PROMPT = `You are a senior SEO analyst. You apply Jake Ward's method for earning a citation in Google's AI Overview:

1. Pick one search that shows an AI Overview.
2. Track how the AI Overview changes over several days: the full answer, the citations, the date.
3. Find the patterns: recurring claims, repeated entities, common formats, frequent sources, differences between days.
4. Reverse engineer the most-cited pages: what they cover, how fast they answer, their structure, tables and lists, data, and gaps.
5. Build a better page around the findings, and add something new worth citing.
6. Publish, then keep tracking.

Steps 1 and 2 are done. Google generates a different AI Overview for every request, so each captured day holds several samples: separate requests for the same search, made minutes apart, often with different wording and different citations. The user message contains every sample of every day, grouped by day. Your job is steps 3 and 4, plus the blueprint for step 5.

## How to work

- Read every sample before you write anything. Count precisely from the data. Never guess a count.
- Two kinds of count appear in the output. samples_present and samples_cited are the number of distinct samples, across all days, in which the claim, entity or source appeared: a claim found in 2 of day 1's samples and 1 of day 2's has samples_present 3. days_present and days_cited are the number of distinct days on which it appeared in at least one sample: that same claim has days_present 2. A sample counts once, however many times it mentions the thing. The user message states how many samples and days were captured; no count can exceed those totals.
- A sample marked "[no AI Overview appeared]" is a sample with no claims and no citations. It still counts toward the total number of samples.
- Then study the cited pages. The user message lists "Candidate pages to fetch", ranked by samples cited. Fetch them with the web_fetch tool, several at once if you like, up to the tool's limit. For a page you could read, set fetched to true and describe the real page. If a fetch fails or returns nothing useful, set fetched to false and work only from the title and snippet Google showed; say so in the structure field ("not fetched; based on Google's snippet"). Never describe a page you did not read as if you had read it.
- Finish with one JSON object that follows the output schema exactly. No prose before or after it.

## Output fields

patterns
- recurring_claims: statements the AI Overview makes in more than one sample. claim is the statement in your words, samples_present and days_present the counts defined above, example a short verbatim quote from one sample.
- repeated_entities: brands, products, people, places, tools or concepts named in more than one sample. role is what they are to the answer ("recommended option", "the thing being compared", "a cause", "a step").
- formats: opening describes how the overview usually starts (a direct definition, a list of options, a verdict). structure describes the shape of the whole answer. uses_table and uses_list are true if any sample used one. typical_length_words is the average word count of the samples that had an overview, rounded to a whole number.
- frequent_sources: one entry per cited URL that appeared in at least one sample, highest samples_cited first. cited_for is what Google used it for, in a few words.
- differences: one entry per day whose samples, taken together, differed from the previous day's samples: a source cited on one day and in none of the next day's samples, a claim that appeared or vanished across the day, a reordered list, a day with no overview in any sample. Ordinary sample-to-sample variation within one day is not a difference. what_changed is a plain description. Day 1 has nothing to compare against. Leave out days that matched the previous day.
- stable_core: one paragraph, in plain words, containing what Google included in every sample, or nearly every sample, that had an overview. This is the answer a page must give.

citation_research: one entry per candidate page, in the same order as the candidate list.
- samples_cited and days_cited: copy from the candidate list.
- fetched: true only if web_fetch returned the page.
- answers_how_fast: where the direct answer first appears ("first sentence", "paragraph 2, after a short intro", "only in a table halfway down", "never directly").
- topics_covered and entities_covered: what the page actually covers and names.
- structure: the shape of the page in one or two sentences (order of headings, intro length, FAQ at the end).
- uses_tables and uses_lists: as found on the page.
- data_included: original numbers, tests, prices, dates, studies or screenshots the page has. An empty list if none.
- gaps: things a searcher would want that this page does not give. Be specific.

blueprint: what a better page must be.
- page_goal: one sentence.
- target_question: the exact question the searcher is asking, written as a question.
- must_cover: topics the page must include, each with why (how many samples, and which sources, show it matters).
- must_mention: the entities the page must name, taken from repeated_entities and the cited pages.
- recommended_format: the order of formats, for example "direct answer, then comparison table, then one section per option, then FAQ".
- opening_answer: the one-paragraph direct answer the page should open with. Write it in full so it is ready to use. Base it on stable_core, not on invention.
- sections: the sections in order. format must be exactly one of "paragraph", "table", "list" or "faq". purpose says what the section must achieve.
- something_new: ideas for something the current sources lack and Google would cite. Be honest: suggest only things the user could actually add (their own data, a comparison nobody made, an unanswered question answered, a clearer table). Never suggest inventing numbers or quotes. If the user described an edge, build at least one idea on it.

summary_md: a report in plain English for someone who is not an SEO expert. Under 600 words. Markdown with exactly these four headings, in this order:
## What Google keeps saying
## Who Google keeps citing
## What the winning pages do
## What your page needs
Short sentences. Quote every count as "in X of S samples", where S is the total number of samples captured. Add the day count only when it says something the sample count does not (for example a source cited in 6 samples that all fell on one day). Say once, in one short sentence, that Google gives a slightly different answer each time it is asked, which is why the report counts samples. Rank "Who Google keeps citing" by samples_cited, most cited first, and use real source names. No jargon: say "the sources Google cites" rather than "SERP features", and "the answer" rather than "the snippet". If the user's website was given, say whether it was cited in any sample. End "What your page needs" with the single most important thing to do.`;

export const DRAFT_SYSTEM_PROMPT = `You are an expert writer. You produce the page described by a blueprint so it can earn a citation in Google's AI Overview for the target search.

Rules
1. Answer the target question in the first two sentences of the body. No warm-up, no "In today's world". The opening paragraph must match the blueprint's opening_answer in substance.
2. Follow the blueprint's sections in order and use each section's format. When a section's format is "table", write a real Markdown table with a header row and a separator row. When it is "list", use a bulleted or numbered list. When it is "faq", write each question in bold followed by a short answer.
3. Mention every entity in must_mention naturally, where it fits. Do not stuff them in.
4. Never invent statistics, experience, testimonials, quotes, studies, prices or dates. Where original data or first-hand experience belongs (especially where the blueprint's something_new calls for it), write a visible placeholder in exactly this form: [ADD YOUR DATA: what to add]. Make each placeholder specific, for example [ADD YOUR DATA: how many of your customers switched in the last year]. Keep placeholders few and useful.
5. If the author's edge is given, use it and present it as the author's own experience, data or product ("we", "our"). Do not add detail beyond what the edge says; where more detail is needed, use a placeholder.
6. Length: 1,200 to 2,500 words, unless the typical length of the winning overviews and pages clearly suggests a shorter or longer page. Every paragraph must earn its place.
7. Plain, confident, specific language. Short paragraphs. Headings that say what the section answers. No fluff intros and no "In conclusion".
8. content_md starts with the H1 as a line beginning with "# " and uses "## " for the sections. Do not put the title or meta description inside content_md.
9. outline: one entry per "## " heading in content_md, each with a one-sentence summary.
10. title: under 60 characters and containing the main phrase of the target question. meta_description: under 155 characters, stating the answer or the benefit plainly. h1: the title or a fuller version of it.
11. why_better_md: a Markdown checklist (lines starting with "- [x] ") comparing this page to the top cited pages: what it covers that they do not, how much faster it answers, what original element it adds, which gaps it closes. Name the pages by domain. Be honest; never claim an advantage the draft does not have.
12. When a previous draft and revision notes are given, revise that draft according to the notes. Keep everything the notes do not ask you to change.

Return one JSON object that follows the output schema exactly. No prose before or after it.`;

function isoDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function renderReferences(refs: OverviewReference[]): string {
  if (!refs.length) return "Citations: none";
  const lines = refs.map((ref, i) => {
    const parts = [`url: ${ref.url}`, `domain: ${ref.domain}`];
    if (ref.title) parts.push(`title: ${clean(ref.title)}`);
    if (ref.snippet) parts.push(`snippet: ${clean(ref.snippet)}`);
    return `${i + 1}. ${parts.join(" | ")}`;
  });
  return `Citations:\n${lines.join("\n")}`;
}

function renderInlineLinks(links: OverviewInlineLink[]): string {
  if (!links.length) return "Inline links: none";
  const lines = links.map(
    (link) => `- ${link.url} (${link.domain})${link.title ? ` ${clean(link.title)}` : ""}`,
  );
  return `Inline links:\n${lines.join("\n")}`;
}

function renderSample(snap: AnalysisSnapshotInput, samplesInDay: number): string {
  const header = `### Sample ${snap.sample} of ${samplesInDay}`;
  if (!snap.has_overview) return `${header}\n[no AI Overview appeared]`;
  const body =
    snap.overview_markdown?.trim() || snap.overview_text?.trim() || "(overview text unavailable)";
  return [
    header,
    body,
    "",
    renderReferences(snap.references ?? []),
    "",
    renderInlineLinks(snap.inline_links ?? []),
  ].join("\n");
}

/** Snapshots grouped by day, days ascending, samples ascending within each day. */
function groupByDay(snapshots: AnalysisSnapshotInput[]): AnalysisSnapshotInput[][] {
  const byDay = new Map<number, AnalysisSnapshotInput[]>();
  for (const snap of snapshots) {
    const group = byDay.get(snap.day_number);
    if (group) group.push(snap);
    else byDay.set(snap.day_number, [snap]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => [...group].sort((a, b) => a.sample - b.sample));
}

function renderDay(samples: AnalysisSnapshotInput[]): string {
  const first = samples[0];
  // Normally the day's sample count; if a sample is missing, the highest index keeps "k of M" honest.
  const samplesInDay = Math.max(samples.length, ...samples.map((s) => s.sample));
  const header = `## Day ${first.day_number} (${isoDay(first.captured_at)})`;
  return [header, ...samples.map((s) => renderSample(s, samplesInDay))].join("\n\n");
}

/** Render the user message for the analysis call: every sample of every day, then the ranked pages to fetch. */
export function buildAnalysisUserPrompt(input: AnalysisInput, candidateUrls: CandidateUrl[]): string {
  const days = groupByDay(input.snapshots);
  const sampleCount = input.snapshots.length;
  const dayCount = days.length;
  const withOverview = input.snapshots.filter((s) => s.has_overview).length;

  const parts: string[] = [
    `Search: "${input.keyword}"`,
    `Country: ${input.locationName}`,
    `Language: ${input.languageCode}`,
    `Samples captured: ${sampleCount} across ${pluralize(dayCount, "day")} (${pluralize(withOverview, "sample")} with an AI Overview)`,
    "",
    ...days.map((d) => `${renderDay(d)}\n`),
    "## Candidate pages to fetch (ranked by samples cited)",
  ];

  if (candidateUrls.length) {
    parts.push(
      ...candidateUrls.map(
        (c, i) =>
          `${i + 1}. ${c.url} (${c.domain}) cited in ${c.samples_cited} of ${sampleCount} samples (${c.days_cited} of ${dayCount} days)` +
          (c.title ? ` — ${clean(c.title)}` : ""),
      ),
    );
  } else {
    parts.push("None. Google cited no pages, so set citation_research to an empty list.");
  }

  if (input.targetDomain) {
    parts.push("", "## The user's website", input.targetDomain);
  }
  if (input.userEdge?.trim()) {
    parts.push("", "## The user's edge (what they know, have or can show that competitors cannot)", input.userEdge.trim());
  }

  return parts.join("\n");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/** "12 samples, 5 days". Reports built before sampling carry no sample counts, so those fall back to days alone. */
function seenIn(samples: number | undefined, days: number): string {
  const dayLabel = pluralize(days, "day");
  return typeof samples === "number" ? `${pluralize(samples, "sample")}, ${dayLabel}` : dayLabel;
}

function renderBlueprint(b: PageBlueprint): string {
  return [
    `Page goal: ${b.page_goal}`,
    `Target question: ${b.target_question}`,
    `Recommended format: ${b.recommended_format}`,
    `Opening answer: ${b.opening_answer}`,
    "Must cover:",
    ...b.must_cover.map((m) => `- ${m.topic} — ${m.why}`),
    `Must mention: ${b.must_mention.join(", ") || "(none)"}`,
    "Sections, in order:",
    ...b.sections.map((s, i) => `${i + 1}. ${s.heading} [${s.format}] — ${s.purpose}`),
    "Something new worth adding:",
    ...(b.something_new.length
      ? b.something_new.map((s) => `- ${s.idea} — why Google would cite it: ${s.why_google_would_cite_it}`)
      : ["- (none suggested)"]),
  ].join("\n");
}

function renderPatterns(p: AnalysisPatterns): string {
  return [
    `Opening: ${p.formats.opening}`,
    `Structure: ${p.formats.structure}`,
    `Uses a table: ${yesNo(p.formats.uses_table)}. Uses a list: ${yesNo(p.formats.uses_list)}. Typical length: ${p.formats.typical_length_words} words.`,
    "Recurring claims:",
    ...p.recurring_claims.map((c) => `- ${c.claim} (${seenIn(c.samples_present, c.days_present)})`),
    "Repeated entities:",
    ...p.repeated_entities.map((e) => `- ${e.entity} — ${e.role} (${seenIn(e.samples_present, e.days_present)})`),
    "Most cited sources:",
    ...p.frequent_sources.map(
      (s) => `- ${s.domain} — ${s.url} (cited in ${seenIn(s.samples_cited, s.days_cited)}) — ${s.cited_for}`,
    ),
  ].join("\n");
}

function renderCitationResearch(items: CitationResearchItem[]): string {
  if (!items.length) return "(no cited pages were studied)";
  return items
    .map((c) => {
      const data = c.data_included.length ? c.data_included.join("; ") : "none";
      const gaps = c.gaps.length ? c.gaps.join("; ") : "none found";
      return [
        `- ${c.domain} (${c.fetched ? "read in full" : "snippet only"}; cited in ${seenIn(c.samples_cited, c.days_cited)})`,
        `  answers: ${c.answers_how_fast}`,
        `  structure: ${c.structure}`,
        `  data: ${data}`,
        `  gaps: ${gaps}`,
      ].join("\n");
    })
    .join("\n");
}

/** Render the user message for the draft call: blueprint, stable core, patterns, research, edge, notes. */
export function buildDraftUserPrompt(input: DraftInput): string {
  const parts: string[] = [
    `Search to win: "${input.keyword}"`,
    "",
    "## Blueprint",
    renderBlueprint(input.blueprint),
    "",
    "## What Google always includes (the stable core)",
    input.stableCore,
    "",
    "## Patterns in the AI Overview",
    renderPatterns(input.patterns),
    "",
    "## The top cited pages, in short",
    renderCitationResearch(input.citationResearch),
  ];

  if (input.userEdge?.trim()) {
    parts.push("", "## The author's edge (present this as the author's own)", input.userEdge.trim());
  } else {
    parts.push("", "## The author's edge", "None given. Use [ADD YOUR DATA: ...] placeholders where original data belongs.");
  }
  if (input.targetDomain) {
    parts.push("", "## The author's website", input.targetDomain);
  }

  if (input.previousDraft) {
    parts.push(
      "",
      "## Previous draft",
      `Title: ${input.previousDraft.title}`,
      "---",
      input.previousDraft.content_md,
      "---",
    );
  }

  if (input.notes?.trim()) {
    parts.push("", "## Revision notes from the author", input.notes.trim());
  }

  if (input.previousDraft) {
    parts.push(
      "",
      input.notes?.trim()
        ? "Revise the previous draft according to the revision notes. Keep everything the notes do not ask you to change, and return the complete revised page."
        : "Write an improved version of the previous draft. Keep its strengths, fix its weaknesses against the blueprint, and return the complete page.",
    );
  } else {
    parts.push("", "Write the complete page now.");
  }

  return parts.join("\n");
}
