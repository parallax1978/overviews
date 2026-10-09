import { describe, expect, it } from "vitest";
import { AnalysisSchema, DraftSchema, rankCandidateUrls } from "@/lib/claude";
import { buildAnalysisUserPrompt, type AnalysisInput, type CandidateUrl } from "@/lib/prompts";
import type { OverviewReference } from "@/lib/types";

function ref(url: string, title = "Page"): OverviewReference {
  return {
    url,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    title,
    snippet: `Snippet for ${title}`,
    source: null,
    element_index: 0,
  };
}

const sampleAnalysis = {
  patterns: {
    recurring_claims: [{ claim: "Typeform is the easiest to use", days_present: 5, example: "Typeform is known for ease of use" }],
    repeated_entities: [{ entity: "Typeform", days_present: 6, role: "recommended option" }],
    formats: {
      opening: "a list of options",
      structure: "intro sentence, then one bullet per tool",
      uses_table: false,
      uses_list: true,
      typical_length_words: 180,
    },
    frequent_sources: [
      { domain: "zapier.com", url: "https://zapier.com/blog/best-form-builder/", days_cited: 6, cited_for: "the list of tools" },
    ],
    differences: [{ day: 3, what_changed: "Jotform was added to the list" }],
    stable_core: "Google always lists Typeform, Jotform and Google Forms as the main options.",
  },
  citation_research: [
    {
      url: "https://zapier.com/blog/best-form-builder/",
      domain: "zapier.com",
      days_cited: 6,
      fetched: true,
      answers_how_fast: "paragraph 2",
      topics_covered: ["pricing", "templates"],
      entities_covered: ["Typeform", "Jotform"],
      structure: "intro, then one section per tool",
      uses_tables: true,
      uses_lists: true,
      data_included: ["prices as of 2026"],
      gaps: ["no setup time comparison"],
    },
  ],
  blueprint: {
    page_goal: "Help a small business pick a form builder in five minutes.",
    target_question: "What is the best form builder?",
    must_cover: [{ topic: "pricing", why: "cited on 6 of 7 days" }],
    must_mention: ["Typeform", "Jotform"],
    recommended_format: "direct answer, then comparison table, then per-option sections",
    opening_answer: "Typeform is the best form builder for most small teams.",
    sections: [{ heading: "Quick answer", purpose: "answer the question", format: "paragraph" as const }],
    something_new: [{ idea: "setup time per tool", why_google_would_cite_it: "no source compares it" }],
  },
  summary_md: "## What Google keeps saying\nTypeform leads.",
};

const sampleDraft = {
  title: "Best Form Builder in 2026",
  meta_description: "Typeform is the best form builder for most teams. Here is why.",
  h1: "The Best Form Builder in 2026",
  outline: [{ heading: "Quick answer", summary: "Typeform wins for most teams." }],
  content_md: "# The Best Form Builder in 2026\n\nTypeform is the best form builder for most teams.",
  why_better_md: "- [x] Answers in the first sentence",
};

describe("AnalysisSchema", () => {
  it("accepts a realistic analysis object", () => {
    const parsed = AnalysisSchema.parse(sampleAnalysis);
    expect(parsed.blueprint.sections[0].format).toBe("paragraph");
    expect(parsed.patterns.frequent_sources[0].days_cited).toBe(6);
  });

  it("rejects a missing required key", () => {
    const { stable_core: _dropped, ...patternsWithoutCore } = sampleAnalysis.patterns;
    void _dropped;
    expect(() => AnalysisSchema.parse({ ...sampleAnalysis, patterns: patternsWithoutCore })).toThrow();
  });

  it("rejects an unknown section format", () => {
    const bad = {
      ...sampleAnalysis,
      blueprint: {
        ...sampleAnalysis.blueprint,
        sections: [{ heading: "x", purpose: "y", format: "video" }],
      },
    };
    expect(() => AnalysisSchema.parse(bad)).toThrow();
  });
});

describe("DraftSchema", () => {
  it("accepts a realistic draft object", () => {
    expect(DraftSchema.parse(sampleDraft).title).toBe(sampleDraft.title);
  });

  it("rejects a missing required key", () => {
    const { content_md: _dropped, ...withoutBody } = sampleDraft;
    void _dropped;
    expect(() => DraftSchema.parse(withoutBody)).toThrow();
  });
});

const snapshots: AnalysisInput["snapshots"] = [
  {
    day_number: 1,
    captured_at: "2026-10-01T06:00:00.000Z",
    has_overview: true,
    overview_text: "Typeform is popular.",
    overview_markdown: "**Typeform** is popular.",
    references: [ref("https://zapier.com/best", "Zapier list"), ref("https://typeform.com/", "Typeform")],
    inline_links: [{ url: "https://typeform.com/", domain: "typeform.com", title: "Typeform" }],
  },
  {
    day_number: 2,
    captured_at: "2026-10-02T06:00:00.000Z",
    has_overview: false,
    overview_text: null,
    overview_markdown: null,
    references: [],
    inline_links: [],
  },
  {
    day_number: 3,
    captured_at: "2026-10-03T06:00:00.000Z",
    has_overview: true,
    overview_text: "Jotform is also popular.",
    overview_markdown: null,
    references: [ref("https://jotform.com/", "Jotform"), ref("https://zapier.com/best", "Zapier list")],
    inline_links: [],
  },
];

const input: AnalysisInput = {
  keyword: "best form builder",
  locationName: "United States",
  languageCode: "en",
  snapshots,
  targetDomain: "example.com",
  userEdge: "We tested setup time for 12 tools.",
};

describe("rankCandidateUrls", () => {
  it("ranks urls by distinct days cited, keeping first-seen order for ties", () => {
    const ranked = rankCandidateUrls(snapshots);
    expect(ranked.map((c) => c.url)).toEqual([
      "https://zapier.com/best",
      "https://typeform.com/",
      "https://jotform.com/",
    ]);
    expect(ranked[0].days_cited).toBe(2);
    expect(ranked[1].days_cited).toBe(1);
  });

  it("honours the limit", () => {
    expect(rankCandidateUrls(snapshots, 2)).toHaveLength(2);
  });
});

describe("buildAnalysisUserPrompt", () => {
  const candidates: CandidateUrl[] = [
    { url: "https://zapier.com/best", domain: "zapier.com", title: "Zapier list", days_cited: 2 },
    { url: "https://typeform.com/", domain: "typeform.com", title: "Typeform", days_cited: 1 },
    { url: "https://jotform.com/", domain: "jotform.com", title: "Jotform", days_cited: 1 },
  ];
  const prompt = buildAnalysisUserPrompt(input, candidates);

  it("includes every day, marking days without an overview", () => {
    expect(prompt).toContain("## Day 1 (2026-10-01)");
    expect(prompt).toContain("## Day 2 (2026-10-02)");
    expect(prompt).toContain("## Day 3 (2026-10-03)");
    expect(prompt).toContain("[no AI Overview appeared]");
    expect(prompt).toContain("Days captured: 3 (2 with an AI Overview)");
    expect(prompt).toContain("**Typeform** is popular.");
    expect(prompt).toContain("snippet: Snippet for Zapier list");
  });

  it("lists the candidate urls in ranked order", () => {
    const section = prompt.slice(prompt.indexOf("## Candidate pages to fetch"));
    const positions = candidates.map((c) => section.indexOf(c.url));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(section).toContain("1. https://zapier.com/best (zapier.com; cited on 2 of 3 days)");
  });

  it("includes the user's website and edge when given", () => {
    expect(prompt).toContain("example.com");
    expect(prompt).toContain("We tested setup time for 12 tools.");
  });
});
