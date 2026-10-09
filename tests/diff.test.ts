import { describe, expect, it } from "vitest";
import { computeDayDiff, computeDiff, jaccardSimilarity, splitSentences } from "@/lib/diff";
import type { OverviewReference } from "@/lib/types";

function ref(url: string, element_index = 0): OverviewReference {
  return { url, domain: new URL(url).hostname, title: null, snippet: null, source: null, element_index };
}

const dayOneText =
  "The best form builders in 2026 are Typeform, Jotform and Google Forms. " +
  "Typeform is the strongest choice for design-led teams. " +
  "Google Forms is free and good enough for internal surveys.";

const dayTwoText =
  "The best form builders in 2026 are Typeform, Jotform and Google Forms. " +
  "Jotform now leads for teams that live off templates. " +
  "Google Forms is free and good enough for internal surveys.";

describe("computeDiff", () => {
  it("treats every current citation as added when there is no previous snapshot", () => {
    const diff = computeDiff(null, {
      text: dayOneText,
      references: [ref("https://a.com/one"), ref("https://b.com/two"), ref("https://a.com/one/")],
    });
    expect(diff).toEqual({
      added_refs: ["https://a.com/one", "https://b.com/two"],
      removed_refs: [],
      text_similarity: null,
      changed_sentences: [],
    });
  });

  it("reports added and removed citations by normalized url", () => {
    const diff = computeDiff(
      { text: dayOneText, references: [ref("https://a.com/one"), ref("https://b.com/two")] },
      {
        text: dayTwoText,
        references: [ref("https://A.com/one/?utm_source=google"), ref("https://c.com/three")],
      },
    );
    expect(diff.added_refs).toEqual(["https://c.com/three"]);
    expect(diff.removed_refs).toEqual(["https://b.com/two"]);
  });

  it("lists sentences that are new today, not the ones that stayed", () => {
    const diff = computeDiff(
      { text: dayOneText, references: [] },
      { text: dayTwoText, references: [] },
    );
    expect(diff.changed_sentences).toEqual(["Jotform now leads for teams that live off templates."]);
  });

  it("keeps similarity between 0 and 1", () => {
    const same = computeDiff({ text: dayOneText, references: [] }, { text: dayOneText, references: [] });
    expect(same.text_similarity).toBe(1);
    expect(same.changed_sentences).toEqual([]);

    const partial = computeDiff({ text: dayOneText, references: [] }, { text: dayTwoText, references: [] });
    expect(partial.text_similarity).toBeGreaterThan(0);
    expect(partial.text_similarity).toBeLessThan(1);

    const disjoint = computeDiff(
      { text: "alpha bravo charlie delta", references: [] },
      { text: "echo foxtrot golf hotel", references: [] },
    );
    expect(disjoint.text_similarity).toBe(0);
  });

  it("returns null similarity when either day has no overview text", () => {
    expect(computeDiff({ text: null, references: [] }, { text: dayTwoText, references: [] }).text_similarity).toBeNull();
    expect(computeDiff({ text: dayOneText, references: [] }, { text: null, references: [] }).text_similarity).toBeNull();
  });

  it("treats a day with no overview text as having no sentences", () => {
    const appeared = computeDiff({ text: null, references: [] }, { text: dayTwoText, references: [] });
    expect(appeared.changed_sentences).toHaveLength(3);

    const vanished = computeDiff({ text: dayOneText, references: [] }, { text: null, references: [] });
    expect(vanished.changed_sentences).toEqual([]);
  });

  it("ignores short fragments, normalizes whitespace and caps at 40 sentences", () => {
    const long = Array.from({ length: 60 }, (_, i) => `This is brand new sentence number ${i} of the day.`).join(" ");
    const diff = computeDiff({ text: "Short. Tiny! Also small?", references: [] }, { text: long, references: [] });
    expect(diff.changed_sentences).toHaveLength(40);
    expect(diff.changed_sentences[0]).toBe("This is brand new sentence number 0 of the day.");

    const spaced = computeDiff(
      { text: "  Typeform   is the strongest   choice for design-led teams.  ", references: [] },
      { text: "Typeform is the strongest choice for design-led teams.", references: [] },
    );
    expect(spaced.changed_sentences).toEqual([]);
  });

  it("is the one-sample case of computeDayDiff", () => {
    const prev = { text: dayOneText, references: [ref("https://a.com/one"), ref("https://b.com/two")] };
    const curr = { text: dayTwoText, references: [ref("https://b.com/two"), ref("https://c.com/three")] };
    expect(computeDiff(prev, curr)).toEqual(computeDayDiff([prev], [curr]));
    expect(computeDiff(null, curr)).toEqual(computeDayDiff(null, [curr]));
  });
});

describe("computeDayDiff", () => {
  const a = "https://a.com/one";
  const b = "https://b.com/two";
  const c = "https://c.com/three";
  const d = "https://d.com/four";
  const e = "https://e.com/five";

  it("treats every citation of every sample as added when there is no previous day", () => {
    const diff = computeDayDiff(null, [
      { text: dayOneText, references: [ref(a), ref(b)] },
      { text: null, references: [] },
      { text: dayTwoText, references: [ref("https://A.com/one/"), ref(c)] },
    ]);
    expect(diff).toEqual({
      added_refs: [a, b, c],
      removed_refs: [],
      text_similarity: null,
      changed_sentences: [],
    });
  });

  it("compares the union of today's citations with the union of yesterday's", () => {
    const diff = computeDayDiff(
      [
        { text: null, references: [ref(a), ref(b)] },
        { text: null, references: [ref(b), ref(c)] },
      ],
      [
        { text: null, references: [ref(c), ref(d)] },
        { text: null, references: [] },
        { text: null, references: [ref("https://a.com/one/?utm_medium=ai"), ref(e)] },
      ],
    );
    expect(diff.added_refs).toEqual([d, e]);
    expect(diff.removed_refs).toEqual([b]);
  });

  it("does not count a source as new or gone when only the sample that cites it changed", () => {
    const diff = computeDayDiff(
      [
        { text: null, references: [ref(a)] },
        { text: null, references: [ref(b)] },
      ],
      [
        { text: null, references: [ref(b)] },
        { text: null, references: [ref(a)] },
      ],
    );
    expect(diff.added_refs).toEqual([]);
    expect(diff.removed_refs).toEqual([]);
  });

  it("measures similarity between the first sample of each day that has an overview", () => {
    const single = computeDiff({ text: dayOneText, references: [] }, { text: dayTwoText, references: [] });
    const diff = computeDayDiff(
      [
        { text: null, references: [] },
        { text: dayOneText, references: [] },
        { text: "Something else entirely, kept out of the comparison.", references: [] },
      ],
      [
        { text: dayTwoText, references: [] },
        { text: "echo foxtrot golf hotel", references: [] },
      ],
    );
    expect(diff.text_similarity).toBe(single.text_similarity);
    expect(diff.text_similarity).toBeGreaterThan(0);
    expect(diff.text_similarity).toBeLessThan(1);
  });

  it("returns null similarity when no sample of either day has an overview", () => {
    const none = [
      { text: null, references: [] },
      { text: null, references: [] },
    ];
    expect(computeDayDiff(none, [{ text: dayTwoText, references: [] }]).text_similarity).toBeNull();
    expect(computeDayDiff([{ text: dayOneText, references: [] }], none).text_similarity).toBeNull();
    expect(computeDayDiff([{ text: dayOneText, references: [] }], none).changed_sentences).toEqual([]);
  });

  it("only calls a sentence new when no sample of the previous day had it", () => {
    const seenInAnotherSample = computeDayDiff(
      [
        { text: dayOneText, references: [] },
        { text: "Jotform now leads for teams that live off templates.", references: [] },
      ],
      [{ text: dayTwoText, references: [] }],
    );
    expect(seenInAnotherSample.changed_sentences).toEqual([]);

    const trulyNew = computeDayDiff(
      [
        { text: dayOneText, references: [] },
        { text: dayOneText, references: [] },
      ],
      [{ text: dayTwoText, references: [] }],
    );
    expect(trulyNew.changed_sentences).toEqual(["Jotform now leads for teams that live off templates."]);
  });

  it("takes today's sentences from the first sample with an overview only", () => {
    const diff = computeDayDiff(
      [{ text: dayOneText, references: [] }],
      [
        { text: null, references: [] },
        { text: dayOneText, references: [] },
        { text: "A brand new sentence from the third sample of the day.", references: [] },
      ],
    );
    expect(diff.changed_sentences).toEqual([]);
    expect(diff.text_similarity).toBe(1);
  });

  it("treats an empty previous day as a day with nothing in it", () => {
    const diff = computeDayDiff([], [{ text: dayTwoText, references: [ref(a)] }]);
    expect(diff.added_refs).toEqual([a]);
    expect(diff.removed_refs).toEqual([]);
    expect(diff.text_similarity).toBeNull();
    expect(diff.changed_sentences).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("splits on sentence punctuation and line breaks and drops short pieces", () => {
    expect(splitSentences("Top picks\nTypeform is great for design. Short. Jotform wins on templates!\nDone?")).toEqual([
      "Typeform is great for design.",
      "Jotform wins on templates!",
    ]);
  });

  it("computes Jaccard over lower-cased tokens longer than two characters", () => {
    // tokens: {the, cat, sat, mat} vs {the, cat, sat} -> 3 shared / 4 in the union
    expect(jaccardSimilarity("The cat sat on the mat", "the CAT sat")).toBe(0.75);
    expect(jaccardSimilarity("", "")).toBe(1);
    expect(jaccardSimilarity("a b c", "d e")).toBe(1);
    expect(jaccardSimilarity(null, "x")).toBeNull();
  });
});
