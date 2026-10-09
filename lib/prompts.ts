/**
 * Prompt texts and prompt builders for the two Claude calls in lib/claude.ts.
 * Pure functions, no IO, so they can be unit tested.
 */

import type {
  AnalysisPatterns,
  CitationResearchItem,
  CompetitorPolicy,
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
  competitorPolicy: CompetitorPolicy;
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
  competitorPolicy: CompetitorPolicy;
  notes: string | null;
  previousDraft: { title: string; content_md: string } | null;
}

/** One line for the prompts explaining how other brands may be treated. */
export function competitorPolicyText(policy: CompetitorPolicy): string {
  return policy === "compare"
    ? "The author wants a fair comparison page: other brands, products and companies may be named and compared honestly."
    : "Never recommend, rank, praise or link to other brands, products or companies. The page positions the author's own site or product as the answer (honestly, with no invented claims) and otherwise answers in substance: what matters, what to check, what to avoid, what it costs. A competitor may be named only to quote what a source claims when settling a contradiction, neutrally.";
}

export const ANALYSIS_SYSTEM_PROMPT = `You are a senior SEO analyst. You apply Jake Ward's method for earning a citation in Google's AI Overview:

1. Pick one search that shows an AI Overview.
2. Track how the AI Overview changes over several days: the full answer, the citations, the date.
3. Find the patterns: recurring claims, repeated entities, common formats, frequent sources, differences between days.
4. Reverse engineer the most-cited pages: what they cover, how fast they answer, their structure, tables and lists, data, and gaps.
5. Build a better page around the findings, and add something new worth citing.
6. Publish, then keep tracking.

Steps 1 and 2 are done. Google generates a different AI Overview for every request, so each captured day holds several samples: separate requests for the same search, made minutes apart, often with different wording and different citations. The user message contains every sample of every day, grouped by day. Your job is steps 3 and 4, plus the blueprint for step 5.

The goal of step 5 is a page that is clearly better than every cited page, not one that matches them. Matching the sources only earns a share of what they already have. Everything you write about the cited pages should end in how to beat them: where they answer slowly, what they leave out, where they contradict each other, what structure they lack, and what the author can add that none of them has.

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
- how_to_beat: one or two sentences on the concrete way the author's page beats this one (answer faster, fill a named gap, settle a contradiction it leaves open, add a structure it lacks, add original data it does not have).

blueprint: the plan for a page that beats every cited page.
- page_goal: one sentence.
- target_question: the exact question the searcher is asking, written as a question.
- winning_angle: the one thing that will make this page the best answer, in one or two sentences. It must be something no cited page does. If the author gave an edge, build the angle on it.
- gaps_to_fill: specific things the searcher wants that no cited page gives, or only one gives badly. gap is the thing; found_in names the pages that lack it ("none of the eight pages", or "only freeformbuilders.com, and only partly"). Draw these from the gaps of every cited page. At least three unless the pages truly cover everything.
- contradictions_to_settle: places where the cited pages or the samples disagree (prices, counts, dates, which option is best). topic names it; what_sources_say states each side with its source. The page settles these with checked facts. Empty if there are none.
- must_cover: the questions the searcher has that the page must answer, each with why (how many samples, and which sources, show it matters). This is about the searcher's questions, not the sources' outlines.
- terms_to_cover: non-brand terms, concepts, policies, metrics, risks or steps the searcher expects to see explained. Never put a brand, product or company name here.
- brands_google_names: the brands, products and companies Google named in the samples, for reference only. The page is not required to mention any of them; the brand policy in the user message says whether it may.
- recommended_format: the order of formats, and it must beat every cited page's format: if none of them has a comparison table and the question calls for one, the page gets one; if they all open with long intros, this page opens with the answer.
- opening_answer: the one-paragraph direct answer the page should open with, written in full so it is ready to use. Base it on stable_core in substance. Obey the brand policy in the user message: under the default policy it recommends no other brand by name, answers in substance (what matters, what to check, what to avoid, what it costs), and, when the author's website or edge is given, positions that as the answer without invented claims.
- sections: the sections in order. format must be exactly one of "paragraph", "table", "list" or "faq". purpose says what the section must achieve. Do not copy any cited page's outline.
- something_new: at least three ideas for something the current sources lack and Google would cite. Be honest: suggest only things the user could actually add (their own data, a comparison nobody made, an unanswered question answered, a clearer table, a test they can run). Never suggest inventing numbers or quotes. If the user described an edge, build at least one idea on it.

summary_md: a report in plain English for someone who is not an SEO expert. Under 600 words. Markdown with exactly these four headings, in this order:
## What Google keeps saying
## Who Google keeps citing
## Where the cited pages fall short
## How to beat them
Short sentences. Quote every count as "in X of S samples", where S is the total number of samples captured. Add the day count only when it says something the sample count does not (for example a source cited in 6 samples that all fell on one day). Say once, in one short sentence, that Google gives a slightly different answer each time it is asked, which is why the report counts samples. Rank "Who Google keeps citing" by samples_cited, most cited first, and use real source names. "Where the cited pages fall short" names the gaps and contradictions with the pages responsible. "How to beat them" states the winning angle first, then the three or four moves that matter most, and ends with the single most important thing to do. No jargon: say "the sources Google cites" rather than "SERP features", and "the answer" rather than "the snippet". If the user's website was given, say whether it was cited in any sample.`;

export const DRAFT_SYSTEM_PROMPT = `You are an expert writer. You produce the page described by a blueprint so it can earn a citation in Google's AI Overview for the target search. The page must be clearly better than every cited page, not a tidier copy of them.

Rules
1. Answer the target question in the first two sentences of the body, faster than the fastest cited page. No warm-up, no "In today's world". The opening paragraph must match the blueprint's opening_answer in substance.
2. Build the page on the winning_angle. Fill every item in gaps_to_fill. Settle every item in contradictions_to_settle with checked facts; where a fact must be checked by the author, state the conflict plainly and add a placeholder for the checked figure.
3. Follow the blueprint's sections in order and use each section's format. When a section's format is "table", write a real Markdown table with a header row and a separator row. When it is "list", use a bulleted or numbered list. When it is "faq", write each question in bold followed by a short answer. Do not copy any cited page's outline or wording.
4. Explain every term in terms_to_cover where it fits, naturally. Do not stuff them in.
5. Brands: obey the brand policy in the user message exactly. brands_google_names is reference material, not a list to include.
6. Never invent statistics, experience, testimonials, quotes, studies, prices or dates. Where original data or first-hand experience belongs (especially where the blueprint's something_new calls for it), write a visible placeholder in exactly this form: [ADD YOUR DATA: what to add]. Make each placeholder specific, for example [ADD YOUR DATA: how many of your customers switched in the last year]. Keep placeholders few and useful.
7. If the author's edge is given, use it and present it as the author's own experience, data or product ("we", "our"). Do not add detail beyond what the edge says; where more detail is needed, use a placeholder.
8. Length: 1,200 to 2,500 words, unless the typical length of the winning overviews and pages clearly suggests a shorter or longer page. Every paragraph must earn its place.
9. Plain, confident, specific language. Short paragraphs. Headings that say what the section answers. No fluff intros and no "In conclusion".
10. content_md starts with the H1 as a line beginning with "# " and uses "## " for the sections. Do not put the title or meta description inside content_md.
11. outline: one entry per "## " heading in content_md, each with a one-sentence summary.
12. title: under 60 characters and containing the main phrase of the target question. meta_description: under 155 characters, stating the answer or the benefit plainly. h1: the title or a fuller version of it.
13. why_better_md: a Markdown checklist (lines starting with "- [x] ") of how this page beats the top cited pages, named by domain: how much faster it answers, which gaps it fills, which contradictions it settles, what structure it has that they lack, what original element it adds. Be honest; never claim an advantage the draft does not have.
14. When a previous draft and revision notes are given, revise that draft according to the notes. Keep everything the notes do not ask you to change.

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

  parts.push("", "## Brand policy for the page", competitorPolicyText(input.competitorPolicy));
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
    `Winning angle: ${b.winning_angle || "(none given)"}`,
    `Recommended format: ${b.recommended_format}`,
    `Opening answer: ${b.opening_answer}`,
    "Gaps to fill (what no cited page gives):",
    ...((b.gaps_to_fill ?? []).length
      ? (b.gaps_to_fill ?? []).map((g) => `- ${g.gap} — missing from: ${g.found_in}`)
      : ["- (none listed)"]),
    "Contradictions to settle:",
    ...((b.contradictions_to_settle ?? []).length
      ? (b.contradictions_to_settle ?? []).map((c) => `- ${c.topic} — ${c.what_sources_say}`)
      : ["- (none)"]),
    "Must cover (the searcher's questions):",
    ...b.must_cover.map((m) => `- ${m.topic} — ${m.why}`),
    `Terms to cover: ${(b.terms_to_cover ?? []).join(", ") || "(none)"}`,
    `Brands Google named (reference only, see the brand policy): ${(b.brands_google_names ?? []).join(", ") || "(none)"}`,
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
  parts.push("", "## Brand policy (binding)", competitorPolicyText(input.competitorPolicy));

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
