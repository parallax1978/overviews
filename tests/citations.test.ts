import { describe, expect, it } from "vitest";
import { aggregateCitations, countDomains, countTotals, type CitationSnapshot } from "@/lib/citations";
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

function sample(
  day_number: number,
  sampleNumber: number,
  references: OverviewReference[],
  has_overview = true,
): CitationSnapshot {
  return { day_number, sample: sampleNumber, has_overview, references };
}

// Two days, three samples each. Google writes a different overview per request,
// so the samples of one day cite different pages.
const day1 = [
  sample(1, 1, [
    ref("https://www.zapier.com/blog/best-form-builders/", { title: "The best form builders" }),
    ref("https://typeform.com/pricing"),
    // Same page cited twice in the same sample by two different elements.
    ref("https://typeform.com/pricing", { element_index: 2, snippet: "Plans start at $29" }),
    ref("https://jotform.com/templates", { title: "Form templates" }),
  ]),
  sample(1, 2, [
    ref("https://typeform.com/pricing"),
    ref("https://forms.google.com/", { title: "Google Forms" }),
    ref("https://example.net/a"),
  ]),
  sample(1, 3, [ref("https://forms.google.com/"), ref("https://example.net/a")]),
];

const day2 = [
  sample(2, 1, [
    // Trailing slash, hash and capitalized host all point at the day-one page.
    ref("https://Typeform.com/pricing/#plans", { title: "Typeform pricing" }),
    ref("https://zapier.com/blog/best-form-builders", { snippet: "Zapier's picks" }),
  ]),
  sample(2, 2, [ref("https://zapier.com/blog/best-form-builders"), ref("https://jotform.com/templates")]),
  // A sample with no overview carries nothing, even if a row slipped through.
  sample(2, 3, [ref("https://example.com/ignored")], false),
];

const snapshots = [...day1, ...day2];

describe("aggregateCitations", () => {
  const rows = aggregateCitations(snapshots);

  it("counts each sample once per url, deduping across days, samples and elements", () => {
    const typeform = rows.find((r) => r.domain === "typeform.com");
    expect(typeform?.url).toBe("https://typeform.com/pricing");
    expect(typeform?.samples_cited).toBe(3); // day 1 samples 1 and 2, day 2 sample 1
    expect(typeform?.days_cited).toBe(2);
    expect(typeform?.days).toEqual([1, 2]);
    expect(typeform?.first_day).toBe(1);
    expect(typeform?.last_day).toBe(2);

    const google = rows.find((r) => r.domain === "forms.google.com");
    expect(google?.samples_cited).toBe(2); // two samples, both on day 1
    expect(google?.days_cited).toBe(1);
    expect(google?.days).toEqual([1]);
    expect(google?.first_day).toBe(1);
    expect(google?.last_day).toBe(1);
  });

  it("sorts by samples cited, then days cited, then domain", () => {
    expect(rows.map((r) => [r.samples_cited, r.days_cited, r.domain])).toEqual([
      [3, 2, "typeform.com"],
      [3, 2, "zapier.com"],
      [2, 2, "jotform.com"],
      [2, 1, "example.net"],
      [2, 1, "forms.google.com"],
    ]);
  });

  it("keeps the first title and snippet seen, filling gaps from later samples", () => {
    const typeform = rows.find((r) => r.domain === "typeform.com");
    expect(typeform?.title).toBe("Typeform pricing");
    expect(typeform?.snippet).toBe("Plans start at $29");

    const zapier = rows.find((r) => r.domain === "zapier.com");
    expect(zapier?.title).toBe("The best form builders");
    expect(zapier?.snippet).toBe("Zapier's picks");
  });

  it("ignores samples without an AI Overview and empty inputs", () => {
    expect(rows.some((r) => r.domain === "example.com")).toBe(false);
    expect(aggregateCitations([])).toEqual([]);
    expect(aggregateCitations([sample(1, 1, [])])).toEqual([]);
  });

  it("gives a single day's samples per-day counts", () => {
    const dayOnly = aggregateCitations(day1);
    expect(dayOnly.map((r) => [r.domain, r.samples_cited, r.days_cited])).toEqual([
      ["example.net", 2, 1],
      ["forms.google.com", 2, 1],
      ["typeform.com", 2, 1],
      ["jotform.com", 1, 1],
      ["zapier.com", 1, 1],
    ]);
  });

  it("falls back to the url when a reference has no domain", () => {
    const [row] = aggregateCitations([sample(1, 1, [ref("https://www.example.org/page", { domain: "" })])]);
    expect(row.domain).toBe("example.org");
  });
});

describe("countTotals", () => {
  it("counts samples and distinct days, with and without an overview", () => {
    expect(countTotals(snapshots)).toEqual({
      samples: 6,
      days: 2,
      samplesWithOverview: 5,
      daysWithOverview: 2,
    });
  });

  it("does not count a day with no overview in any sample as a day with one", () => {
    const quietDay = [sample(3, 1, [], false), sample(3, 2, [], false), sample(3, 3, [], false)];
    expect(countTotals([...snapshots, ...quietDay])).toEqual({
      samples: 9,
      days: 3,
      samplesWithOverview: 5,
      daysWithOverview: 2,
    });
  });

  it("is all zeros for no snapshots", () => {
    expect(countTotals([])).toEqual({ samples: 0, days: 0, samplesWithOverview: 0, daysWithOverview: 0 });
  });
});

describe("countDomains", () => {
  it("counts distinct domains across all samples", () => {
    expect(countDomains(snapshots)).toBe(5);
    expect(countDomains([])).toBe(0);
  });
});
