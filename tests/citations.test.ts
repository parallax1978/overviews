import { describe, expect, it } from "vitest";
import { aggregateCitations, countDomains, type CitationSnapshot } from "@/lib/citations";
import type { OverviewReference } from "@/lib/types";

function ref(url: string, extra: Partial<OverviewReference> = {}): OverviewReference {
  return {
    url,
    domain: new URL(url).hostname.replace(/^www\./, ""),
    title: null,
    snippet: null,
    source: null,
    element_index: 0,
    ...extra,
  };
}

const dayOne: CitationSnapshot = {
  day_number: 1,
  has_overview: true,
  references: [
    ref("https://www.zapier.com/blog/best-form-builders/", { title: "The best form builders" }),
    ref("https://typeform.com/pricing"),
    // Same page cited twice on the same day by two different elements.
    ref("https://typeform.com/pricing", { element_index: 2, snippet: "Plans start at $29" }),
    ref("https://jotform.com/templates", { title: "Form templates" }),
  ],
};

const dayTwo: CitationSnapshot = {
  day_number: 2,
  has_overview: true,
  references: [
    // Trailing slash, hash and capitalized host all point at the day-one page.
    ref("https://Typeform.com/pricing/#plans", { title: "Typeform pricing" }),
    ref("https://zapier.com/blog/best-form-builders", { snippet: "Zapier's picks" }),
    ref("https://forms.google.com/", { title: "Google Forms" }),
  ],
};

const dayThree: CitationSnapshot = {
  day_number: 3,
  has_overview: false,
  // A day with no overview carries nothing, even if a row slipped through.
  references: [ref("https://example.com/ignored")],
};

describe("aggregateCitations", () => {
  const rows = aggregateCitations([dayOne, dayTwo, dayThree]);

  it("dedupes by url across days and within a day, counting each day once", () => {
    expect(rows.map((r) => r.url)).toEqual([
      "https://typeform.com/pricing",
      "https://www.zapier.com/blog/best-form-builders/",
      "https://forms.google.com/",
      "https://jotform.com/templates",
    ]);
    const typeform = rows[0];
    expect(typeform.days_cited).toBe(2);
    expect(typeform.days).toEqual([1, 2]);
    expect(typeform.first_day).toBe(1);
    expect(typeform.last_day).toBe(2);
  });

  it("sorts by days cited, then domain, then url", () => {
    expect(rows.map((r) => [r.days_cited, r.domain])).toEqual([
      [2, "typeform.com"],
      [2, "zapier.com"],
      [1, "forms.google.com"],
      [1, "jotform.com"],
    ]);
  });

  it("keeps the first title and snippet seen, filling gaps from later days", () => {
    const typeform = rows.find((r) => r.domain === "typeform.com");
    expect(typeform?.title).toBe("Typeform pricing");
    expect(typeform?.snippet).toBe("Plans start at $29");

    const zapier = rows.find((r) => r.domain === "zapier.com");
    expect(zapier?.title).toBe("The best form builders");
    expect(zapier?.snippet).toBe("Zapier's picks");
  });

  it("ignores days without an AI Overview and empty inputs", () => {
    expect(rows.some((r) => r.domain === "example.com")).toBe(false);
    expect(aggregateCitations([])).toEqual([]);
    expect(aggregateCitations([{ day_number: 1, has_overview: true, references: [] }])).toEqual([]);
  });

  it("falls back to the url when a reference has no domain", () => {
    const [row] = aggregateCitations([
      {
        day_number: 1,
        has_overview: true,
        references: [ref("https://www.example.org/page", { domain: "" })],
      },
    ]);
    expect(row.domain).toBe("example.org");
  });
});

describe("countDomains", () => {
  it("counts distinct domains across all days", () => {
    expect(countDomains([dayOne, dayTwo, dayThree])).toBe(4);
    expect(countDomains([])).toBe(0);
  });
});
