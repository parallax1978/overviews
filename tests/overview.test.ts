import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findAiOverviewItem, normalizeAiOverview, normalizeUrl } from "@/lib/overview";
import sample from "./fixtures/dataforseo-ai-overview.documented-sample.json";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const realFixture = path.join(fixturesDir, "dataforseo-ai-overview.real.json");

type Dict = Record<string, unknown>;

function aiOverviewItem(): Dict {
  const item = findAiOverviewItem(sample);
  if (!item) throw new Error("sample fixture has no ai_overview item");
  return item as Dict;
}

describe("normalizeUrl", () => {
  it("lower-cases the host, strips utm params, fragments and trailing slashes", () => {
    expect(normalizeUrl("https://WWW.Example.com/Path/?utm_source=google&utm_medium=x#:~:text=hi")).toBe(
      "https://www.example.com/Path",
    );
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com/a?b=1&utm_campaign=z")).toBe("https://example.com/a?b=1");
  });

  it("keeps non-utm query params and survives non-URLs", () => {
    expect(normalizeUrl("https://example.com/a?page=2")).toBe("https://example.com/a?page=2");
    expect(normalizeUrl("not a url/")).toBe("not a url");
  });
});

describe("findAiOverviewItem", () => {
  it("finds the ai_overview item in a full response", () => {
    const item = findAiOverviewItem(sample) as Dict;
    expect(item).not.toBeNull();
    expect(item.type).toBe("ai_overview");
    expect(item.asynchronous_ai_overview).toBe(true);
  });

  it("also accepts a result object, an items array, or the item itself", () => {
    const result = (sample.tasks[0].result as Dict[])[0];
    expect((findAiOverviewItem(result) as Dict).type).toBe("ai_overview");
    expect((findAiOverviewItem(result.items) as Dict).type).toBe("ai_overview");
    expect(findAiOverviewItem(aiOverviewItem())).toBe(aiOverviewItem());
  });

  it("returns null when there is no overview or the input is garbage", () => {
    expect(findAiOverviewItem({ tasks: [{ result: [{ items: [{ type: "organic" }] }] }] })).toBeNull();
    expect(findAiOverviewItem({ tasks: [{ result: null }] })).toBeNull();
    expect(findAiOverviewItem(null)).toBeNull();
    expect(findAiOverviewItem(undefined)).toBeNull();
    expect(findAiOverviewItem("garbage")).toBeNull();
    expect(findAiOverviewItem(42)).toBeNull();
    expect(findAiOverviewItem([null, 1, "x"])).toBeNull();
  });
});

describe("normalizeAiOverview (documented sample)", () => {
  const overview = normalizeAiOverview(aiOverviewItem());

  it("reports an overview with text, markdown and a hash", () => {
    expect(overview.hasOverview).toBe(true);
    expect(overview.text).toBeTruthy();
    expect(overview.markdown).toBeTruthy();
    expect(overview.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dedupes references across elements and top level by normalized url", () => {
    // 2 + 1 + 1 + 1 element refs, plus 1 new top-level ref; the other top-level ref is a duplicate.
    expect(overview.references).toHaveLength(6);
    const urls = overview.references.map((r) => r.url);
    expect(new Set(urls).size).toBe(6);
    expect(urls).toContain("https://www.example-reviews.com/best-form-builders");
    expect(urls).not.toContain(
      "https://www.example-reviews.com/best-form-builders/?utm_source=google&utm_medium=ai_overview",
    );
  });

  it("keeps the first title/snippet seen and the citing element index", () => {
    const byUrl = new Map(overview.references.map((r) => [r.url, r]));
    const dup = byUrl.get("https://www.example-reviews.com/best-form-builders")!;
    expect(dup.title).toBe("The 10 Best Form Builders in 2026 (Tested)");
    expect(dup.element_index).toBe(0);
    expect(dup.domain).toBe("example-reviews.com");
    expect(dup.source).toBe("Example Reviews");
    expect(dup.snippet).toContain("After testing 24 tools");

    expect(byUrl.get("https://formtools.io/guide")!.element_index).toBe(0);
    expect(byUrl.get("https://pricingwatch.com/form-builders")!.element_index).toBe(1);
    expect(byUrl.get("https://blog.formtools.io/how-to-choose-a-form-builder")!.element_index).toBe(2);
    expect(byUrl.get("https://www.surveycentral.net/pricing-comparison")!.element_index).toBe(2);
    expect(byUrl.get("https://www.formbuilderfaq.com/faq")!.element_index).toBe(-1);
  });

  it("collects inline links deduped by url", () => {
    expect(overview.inlineLinks).toHaveLength(2);
    expect(overview.inlineLinks[0]).toEqual({
      url: "https://www.typeform.com/",
      domain: "typeform.com",
      title: "Typeform",
    });
  });

  it("builds plain text in element order, with table rows as pipe-separated lines", () => {
    const text = overview.text!;
    const positions = [
      "Top picks",
      "The best form builders in 2026 are Typeform",
      "Tool | Best for | Starting price",
      "Typeform | Design | $25/mo",
      "Jotform | Templates | Free",
      "How to choose",
      "Design and branding",
      "Integrations",
    ].map((needle) => text.indexOf(needle));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).not.toContain("**");
  });

  it("builds markdown in element order, preferring element markdown and bolding titles", () => {
    const markdown = overview.markdown!;
    expect(markdown.indexOf("**Top picks**")).toBeGreaterThanOrEqual(0);
    expect(markdown.indexOf("**Top picks**")).toBeLessThan(markdown.indexOf("**Typeform** for design-led"));
    expect(markdown.indexOf("| Tool | Best for | Starting price |")).toBeGreaterThan(
      markdown.indexOf("**Typeform** for design-led"),
    );
    expect(markdown.indexOf("**How to choose**")).toBeGreaterThan(markdown.indexOf("| Jotform | Templates | Free |"));
    expect(markdown.indexOf("**Design and branding**")).toBeLessThan(markdown.indexOf("**Integrations**"));
    expect(markdown).toContain("**full visual control**");
  });

  it("hashes the collapsed text, so whitespace-only changes do not change the hash", () => {
    const item = aiOverviewItem();
    const spaced = JSON.parse(JSON.stringify(item)) as Dict;
    const elements = spaced.items as Dict[];
    elements[0].text = `   ${String(elements[0].text).replace(/ /g, "   ")}  `;
    expect(normalizeAiOverview(spaced).contentHash).toBe(overview.contentHash);

    elements[0].text = "Something completely different.";
    expect(normalizeAiOverview(spaced).contentHash).not.toBe(overview.contentHash);
  });
});

describe("normalizeAiOverview (edge cases)", () => {
  const empty = {
    hasOverview: false,
    text: null,
    markdown: null,
    references: [],
    inlineLinks: [],
    contentHash: null,
  };

  it("returns hasOverview false and nulls for an item without items", () => {
    expect(normalizeAiOverview({ type: "ai_overview", items: [] })).toEqual(empty);
    expect(normalizeAiOverview({ type: "ai_overview", items: null })).toEqual(empty);
    expect(normalizeAiOverview({ type: "ai_overview" })).toEqual(empty);
    expect(normalizeAiOverview({ type: "ai_overview", items: [{ type: "ai_overview_element", text: "" }] })).toEqual(
      empty,
    );
  });

  it("does not throw on null or garbage input", () => {
    for (const input of [null, undefined, 0, "garbage", [], { items: "nope" }, { items: [1, "x", null, {}] }]) {
      expect(() => normalizeAiOverview(input)).not.toThrow();
      expect(normalizeAiOverview(input)).toEqual(empty);
    }
  });

  it("skips broken references and links but keeps the good ones", () => {
    const overview = normalizeAiOverview({
      items: [
        {
          type: "ai_overview_element",
          text: "Some answer text.",
          links: [null, { url: 5 }, { url: " https://a.com/x " }],
          references: [null, "x", { title: "no url" }, { url: "https://b.com/y", domain: null }],
        },
      ],
      references: "not an array",
    });
    expect(overview.hasOverview).toBe(true);
    expect(overview.inlineLinks).toEqual([{ url: "https://a.com/x", domain: "a.com", title: null }]);
    expect(overview.references).toEqual([
      { url: "https://b.com/y", domain: "b.com", title: null, snippet: null, source: null, element_index: 0 },
    ]);
  });

  it("renders a table element without markdown as a markdown table", () => {
    const overview = normalizeAiOverview({
      items: [
        {
          type: "ai_overview_table_element",
          table: { table_header: ["A", "B"], table_content: [["1", "2"], ["3", null]] },
        },
      ],
    });
    expect(overview.text).toBe("A | B\n1 | 2\n3 | ");
    expect(overview.markdown).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |  |");
  });

  it("falls back to plain text from markdown when an element has no text", () => {
    const overview = normalizeAiOverview({
      items: [{ type: "ai_overview_element", title: "Why", markdown: "Use **bold** and [a link](https://x.com)." }],
    });
    expect(overview.text).toBe("Why\nUse bold and a link.");
    expect(overview.markdown).toBe("**Why**\n\nUse **bold** and [a link](https://x.com).");
  });

  it("includes video elements as text with their source", () => {
    const overview = normalizeAiOverview({
      items: [
        {
          type: "ai_overview_video_element",
          title: "How to build a form in 5 minutes",
          snippet: "A quick walkthrough.",
          url: "https://www.youtube.com/watch?v=abc",
          domain: "www.youtube.com",
          source: "YouTube",
        },
      ],
    });
    expect(overview.hasOverview).toBe(true);
    expect(overview.text).toBe("How to build a form in 5 minutes\nA quick walkthrough.\nVideo from YouTube");
    expect(overview.markdown).toContain("[How to build a form in 5 minutes](https://www.youtube.com/watch?v=abc)");
    expect(overview.references).toEqual([]);
  });

  it("does not repeat a title the markdown already starts with", () => {
    const overview = normalizeAiOverview({
      items: [{ type: "ai_overview_element", title: "Summary", text: "Body.", markdown: "## Summary\n\nBody." }],
    });
    expect(overview.markdown).toBe("## Summary\n\nBody.");
  });
});

describe("normalizeAiOverview (real fixture, when present)", () => {
  it.skipIf(!existsSync(realFixture))("parses the saved real response without throwing", () => {
    const real: unknown = JSON.parse(readFileSync(realFixture, "utf8"));
    const item = findAiOverviewItem(real);
    const overview = normalizeAiOverview(item);
    expect(typeof overview.hasOverview).toBe("boolean");
    if (overview.hasOverview) {
      expect(overview.text).toBeTruthy();
      expect(overview.contentHash).toMatch(/^[0-9a-f]{64}$/);
      for (const ref of overview.references) {
        expect(ref.url).toMatch(/^https?:\/\//);
        expect(ref.domain).not.toMatch(/^www\./);
      }
    }
  });
});
