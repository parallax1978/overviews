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

type SnapshotInput = AnalysisInput["snapshots"][number];

function sample(
  day_number: number,
  sampleIndex: number,
  references: OverviewReference[],
  overrides: Partial<SnapshotInput> = {},
): SnapshotInput {
  const day = String(day_number).padStart(2, "0");
  return {
    day_number,
    sample: sampleIndex,
    captured_at: `2026-10-${day}T06:0${sampleIndex}:00.000Z`,
    has_overview: true,
    overview_text: `Day ${day_number} sample ${sampleIndex} text`,
    overview_markdown: null,
    references,
    inline_links: [],
    ...overrides,
  };
}

const sampleAnalysis = {
  patterns: {
    recurring_claims: [
      {
        claim: "Typeform is the easiest to use",
        samples_present: 14,
        days_present: 5,
        example: "Typeform is known for ease of use",
      },
    ],
    repeated_entities: [{ entity: "Typeform", samples_present: 18, days_present: 6, role: "recommended option" }],
    formats: {
      opening: "a list of options",
      structure: "intro sentence, then one bullet per tool",
      uses_table: false,
      uses_list: true,
      typical_length_words: 180,
    },
    frequent_sources: [
      {
        domain: "zapier.com",
        url: "https://zapier.com/blog/best-form-builder/",
        samples_cited: 17,
        days_cited: 6,
        cited_for: "the list of tools",
      },
    ],
    differences: [{ day: 3, what_changed: "Jotform was added to the list" }],
    stable_core: "Google always lists Typeform, Jotform and Google Forms as the main options.",
  },
  citation_research: [
    {
      url: "https://zapier.com/blog/best-form-builder/",
      domain: "zapier.com",
      samples_cited: 17,
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
    must_cover: [{ topic: "pricing", why: "cited in 17 of 21 samples" }],
    must_mention: ["Typeform", "Jotform"],
    recommended_format: "direct answer, then comparison table, then per-option sections",
    opening_answer: "Typeform is the best form builder for most small teams.",
    sections: [{ heading: "Quick answer", purpose: "answer the question", format: "paragraph" as const }],
    something_new: [{ idea: "setup time per tool", why_google_would_cite_it: "no source compares it" }],
  },
  summary_md: "## What Google keeps saying\nTypeform leads in 18 of 21 samples.",
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
    expect(parsed.patterns.frequent_sources[0].samples_cited).toBe(17);
    expect(parsed.patterns.frequent_sources[0].days_cited).toBe(6);
    expect(parsed.patterns.recurring_claims[0].samples_present).toBe(14);
    expect(parsed.citation_research[0].samples_cited).toBe(17);
  });

  it("rejects a missing required key", () => {
    const { stable_core: _dropped, ...patternsWithoutCore } = sampleAnalysis.patterns;
    void _dropped;
    expect(() => AnalysisSchema.parse({ ...sampleAnalysis, patterns: patternsWithoutCore })).toThrow();
  });

  it("rejects a source without a sample count", () => {
    const { samples_cited: _dropped, ...sourceWithoutSamples } = sampleAnalysis.patterns.frequent_sources[0];
    void _dropped;
    const bad = {
      ...sampleAnalysis,
      patterns: { ...sampleAnalysis.patterns, frequent_sources: [sourceWithoutSamples] },
    };
    expect(() => AnalysisSchema.parse(bad)).toThrow();
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

// One sample per day: the simplest case, where samples and days agree.
const snapshots: AnalysisInput["snapshots"] = [
  sample(1, 1, [ref("https://zapier.com/best", "Zapier list"), ref("https://typeform.com/", "Typeform")], {
    overview_text: "Typeform is popular.",
    overview_markdown: "**Typeform** is popular.",
    inline_links: [{ url: "https://typeform.com/", domain: "typeform.com", title: "Typeform" }],
  }),
  sample(2, 1, [], { has_overview: false, overview_text: null }),
  sample(3, 1, [ref("https://jotform.com/", "Jotform"), ref("https://zapier.com/best", "Zapier list")], {
    overview_text: "Jotform is also popular.",
  }),
];

const input: AnalysisInput = {
  keyword: "best form builder",
  locationName: "United States",
  languageCode: "en",
  snapshots,
  targetDomain: "example.com",
  userEdge: "We tested setup time for 12 tools.",
};

// Two days x two samples. zapier is cited in 3 of 4 samples; typeform and
// jotform are cited in 2 samples each, but jotform's fall on two different days.
const sampledSnapshots: AnalysisInput["snapshots"] = [
  sample(1, 1, [ref("https://zapier.com/best", "Zapier list"), ref("https://typeform.com/", "Typeform")]),
  sample(1, 2, [ref("https://typeform.com/", "Typeform"), ref("https://jotform.com/", "Jotform")]),
  sample(2, 1, [ref("https://zapier.com/best", "Zapier list"), ref("https://zapier.com/best", "Zapier list again")]),
  sample(2, 2, [ref("https://zapier.com/best", "Zapier list"), ref("https://jotform.com/", "Jotform")]),
];

describe("rankCandidateUrls", () => {
  it("ranks urls by distinct samples cited, keeping first-seen order for ties", () => {
    const ranked = rankCandidateUrls(snapshots);
    expect(ranked.map((c) => c.url)).toEqual([
      "https://zapier.com/best",
      "https://typeform.com/",
      "https://jotform.com/",
    ]);
    expect(ranked[0]).toMatchObject({ samples_cited: 2, days_cited: 2 });
    expect(ranked[1]).toMatchObject({ samples_cited: 1, days_cited: 1 });
  });

  it("counts samples across days, counts each sample once, and breaks ties by days", () => {
    const ranked = rankCandidateUrls(sampledSnapshots);
    expect(ranked.map((c) => [c.url, c.samples_cited, c.days_cited])).toEqual([
      ["https://zapier.com/best", 3, 2],
      ["https://jotform.com/", 2, 2],
      ["https://typeform.com/", 2, 1],
    ]);
  });

  it("ignores samples without an overview", () => {
    const withEmpty = [...sampledSnapshots, sample(3, 1, [ref("https://zapier.com/best")], { has_overview: false })];
    expect(rankCandidateUrls(withEmpty)[0]).toMatchObject({ samples_cited: 3, days_cited: 2 });
  });

  it("honours the limit", () => {
    expect(rankCandidateUrls(snapshots, 2)).toHaveLength(2);
  });
});

describe("buildAnalysisUserPrompt", () => {
  const candidates: CandidateUrl[] = [
    { url: "https://zapier.com/best", domain: "zapier.com", title: "Zapier list", samples_cited: 2, days_cited: 2 },
    { url: "https://typeform.com/", domain: "typeform.com", title: "Typeform", samples_cited: 1, days_cited: 1 },
    { url: "https://jotform.com/", domain: "jotform.com", title: "Jotform", samples_cited: 1, days_cited: 1 },
  ];
  const prompt = buildAnalysisUserPrompt(input, candidates);

  it("includes every day, marking samples without an overview", () => {
    expect(prompt).toContain("## Day 1 (2026-10-01)");
    expect(prompt).toContain("## Day 2 (2026-10-02)");
    expect(prompt).toContain("## Day 3 (2026-10-03)");
    expect(prompt).toContain("[no AI Overview appeared]");
    expect(prompt).toContain("Samples captured: 3 across 3 days (2 samples with an AI Overview)");
    expect(prompt).toContain("**Typeform** is popular.");
    expect(prompt).toContain("snippet: Snippet for Zapier list");
  });

  it("lists the candidate urls in ranked order with sample and day counts", () => {
    const section = prompt.slice(prompt.indexOf("## Candidate pages to fetch"));
    const positions = candidates.map((c) => section.indexOf(c.url));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(section).toContain("ranked by samples cited");
    expect(section).toContain("1. https://zapier.com/best (zapier.com) cited in 2 of 3 samples (2 of 3 days)");
  });

  it("includes the user's website and edge when given", () => {
    expect(prompt).toContain("example.com");
    expect(prompt).toContain("We tested setup time for 12 tools.");
  });

  it("groups samples under their day and numbers them within the day", () => {
    // Day 1 has three samples (the middle one empty); day 2 has one. Given out of order on purpose.
    const grouped = buildAnalysisUserPrompt(
      {
        ...input,
        snapshots: [
          sample(2, 1, [ref("https://jotform.com/", "Jotform")]),
          sample(1, 3, [ref("https://typeform.com/", "Typeform")]),
          sample(1, 1, [ref("https://zapier.com/best", "Zapier list")]),
          sample(1, 2, [], { has_overview: false, overview_text: null }),
        ],
      },
      [],
    );

    expect(grouped).toContain("Samples captured: 4 across 2 days (3 samples with an AI Overview)");

    const day1 = grouped.indexOf("## Day 1 (2026-10-01)");
    const day2 = grouped.indexOf("## Day 2 (2026-10-02)");
    const s1 = grouped.indexOf("### Sample 1 of 3");
    const s2 = grouped.indexOf("### Sample 2 of 3");
    const s3 = grouped.indexOf("### Sample 3 of 3");
    const day2s1 = grouped.indexOf("### Sample 1 of 1");
    expect([day1, s1, s2, s3, day2, day2s1].every((p) => p >= 0)).toBe(true);
    expect(day1).toBeLessThan(s1);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s3).toBeLessThan(day2);
    expect(day2).toBeLessThan(day2s1);

    // The empty sample is marked but stays inside day 1, and the day heading appears once.
    expect(grouped.slice(s2, s3)).toContain("[no AI Overview appeared]");
    expect(grouped.match(/## Day 1 /g)).toHaveLength(1);
    expect(grouped.slice(s1, s2)).toContain("Day 1 sample 1 text");
    expect(grouped.slice(s3, day2)).toContain("Day 1 sample 3 text");
    expect(grouped).toContain("None. Google cited no pages");
  });
});
