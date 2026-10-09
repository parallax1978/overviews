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

/** One captured day, as handed to the analysis prompt. */
export interface AnalysisSnapshotInput {
  day_number: number;
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

/** A cited URL ranked by how many days Google cited it. */
export interface CandidateUrl {
  url: string;
  domain: string;
  title: string | null;
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

Steps 1 and 2 are done. The user message contains every captured day. Your job is steps 3 and 4, plus the blueprint for step 5.

## How to work

- Read every day before you write anything. Count precisely from the data: a claim present on 4 of 7 days has days_present 4; a source cited on 3 days has days_cited 3. "Days" means distinct captured days, never the number of mentions. Never guess a count.
- A day marked "[no AI Overview appeared]" is a day with no claims and no citations. It still counts toward the total number of days.
- Then study the cited pages. The user message lists "Candidate pages to fetch", ranked by days cited. Fetch them with the web_fetch tool, several at once if you like, up to the tool's limit. For a page you could read, set fetched to true and describe the real page. If a fetch fails or returns nothing useful, set fetched to false and work only from the title and snippet Google showed; say so in the structure field ("not fetched; based on Google's snippet"). Never describe a page you did not read as if you had read it.
- Finish with one JSON object that follows the output schema exactly. No prose before or after it.

## Output fields

patterns
- recurring_claims: statements the AI Overview makes on more than one day. claim is the statement in your words, days_present the number of days it appeared, example a short verbatim quote from one day.
- repeated_entities: brands, products, people, places, tools or concepts named on more than one day. role is what they are to the answer ("recommended option", "the thing being compared", "a cause", "a step").
- formats: opening describes how the overview starts (a direct definition, a list of options, a verdict). structure describes the shape of the whole answer. uses_table and uses_list are true if any day used one. typical_length_words is the average word count of the days that had an overview, rounded to a whole number.
- frequent_sources: one entry per cited URL that appeared on at least one day, highest days_cited first. cited_for is what Google used it for, in a few words.
- differences: one entry per day that differed from the day before. what_changed is a plain description (a new citation, a dropped claim, a reordered list, a day with no overview). Day 1 has nothing to compare against. Leave out days that were identical to the previous day.
- stable_core: one paragraph, in plain words, containing what Google included on every day that had an overview. This is the answer a page must give.

citation_research: one entry per candidate page, in the same order as the candidate list.
- days_cited: copy from the candidate list.
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
- must_cover: topics the page must include, each with why (which days and sources show it matters).
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
Short sentences. Use real numbers (days, counts) and real source names. No jargon: say "the sources Google cites" rather than "SERP features", and "the answer" rather than "the snippet". If the user's website was given, say whether it was cited on any day. End "What your page needs" with the single most important thing to do.`;

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

function renderDay(snap: AnalysisSnapshotInput): string {
  const header = `## Day ${snap.day_number} (${isoDay(snap.captured_at)})`;
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

/** Render the user message for the analysis call: every day, then the ranked pages to fetch. */
export function buildAnalysisUserPrompt(input: AnalysisInput, candidateUrls: CandidateUrl[]): string {
  const days = [...input.snapshots].sort((a, b) => a.day_number - b.day_number);
  const total = days.length;
  const withOverview = days.filter((d) => d.has_overview).length;

  const parts: string[] = [
    `Search: "${input.keyword}"`,
    `Country: ${input.locationName}`,
    `Language: ${input.languageCode}`,
    `Days captured: ${total} (${withOverview} with an AI Overview)`,
    "",
    ...days.map((d) => `${renderDay(d)}\n`),
    "## Candidate pages to fetch (ranked by days cited)",
  ];

  if (candidateUrls.length) {
    parts.push(
      ...candidateUrls.map(
        (c, i) =>
          `${i + 1}. ${c.url} (${c.domain}; cited on ${c.days_cited} of ${total} days)` +
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
    ...p.recurring_claims.map((c) => `- ${c.claim} (${c.days_present} days)`),
    "Repeated entities:",
    ...p.repeated_entities.map((e) => `- ${e.entity} — ${e.role} (${e.days_present} days)`),
    "Most cited sources:",
    ...p.frequent_sources.map((s) => `- ${s.domain} — ${s.url} (${s.days_cited} days) — ${s.cited_for}`),
  ].join("\n");
}

function renderCitationResearch(items: CitationResearchItem[]): string {
  if (!items.length) return "(no cited pages were studied)";
  return items
    .map((c) => {
      const data = c.data_included.length ? c.data_included.join("; ") : "none";
      const gaps = c.gaps.length ? c.gaps.join("; ") : "none found";
      return [
        `- ${c.domain} (${c.fetched ? "read in full" : "snippet only"}; cited ${c.days_cited} days)`,
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
