import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CaptureResult, DataForSeoError } from "@/lib/dataforseo";
import { findAiOverviewItem } from "@/lib/overview";
import { isCaptureDue, nextCaptureAt } from "@/lib/schedule";
import { SAMPLES_PER_DAY, type OverviewReference, type SnapshotDiff, type Tracker } from "@/lib/types";

// ---------------------------------------------------------------------------
// Schedule rules
// ---------------------------------------------------------------------------

describe("nextCaptureAt", () => {
  it("moves to the start of the next UTC day", () => {
    expect(nextCaptureAt(new Date("2026-10-09T06:12:00Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(nextCaptureAt(new Date("2026-10-09T23:59:59Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
    expect(nextCaptureAt(new Date("2026-10-09T00:00:00Z")).toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("is always due by the next 06:00 UTC cron run", () => {
    const captured = new Date("2026-10-09T06:40:00Z"); // captured by the cron, after 06:00
    const nextCron = new Date("2026-10-10T06:00:00Z");
    expect(nextCaptureAt(captured).getTime()).toBeLessThanOrEqual(nextCron.getTime());
  });
});

describe("isCaptureDue", () => {
  const now = new Date("2026-10-10T06:05:00Z");
  const base = { keep_tracking: false, day_count: 3, days_target: 7, next_capture_at: "2026-10-10T00:00:00Z" };

  it("captures tracking keywords whose time has come", () => {
    expect(isCaptureDue({ ...base, status: "tracking" }, now)).toBe(true);
    expect(isCaptureDue({ ...base, status: "tracking", next_capture_at: "2026-10-11T00:00:00Z" }, now)).toBe(false);
    expect(isCaptureDue({ ...base, status: "tracking", next_capture_at: null }, now)).toBe(false);
  });

  it("keeps capturing an analyzed keyword until all days are in", () => {
    expect(isCaptureDue({ ...base, status: "analyzed" }, now)).toBe(true);
    expect(isCaptureDue({ ...base, status: "analyzed", day_count: 7 }, now)).toBe(false);
    expect(isCaptureDue({ ...base, status: "analyzed", day_count: 7, keep_tracking: true }, now)).toBe(true);
    expect(isCaptureDue({ ...base, status: "ready", day_count: 7 }, now)).toBe(false);
  });

  it("never captures paused, failed or in-progress keywords", () => {
    expect(isCaptureDue({ ...base, status: "paused" }, now)).toBe(false);
    expect(isCaptureDue({ ...base, status: "error" }, now)).toBe(false);
    expect(isCaptureDue({ ...base, status: "analyzing" }, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// captureSnapshot: one day = SAMPLES_PER_DAY requests, one snapshot row each.
// The database is an in-memory fake of the few query shapes lib/capture.ts
// uses; DataForSEO is a mock that returns hand-built or fixture overviews.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string };
type QueryResult = { data: Row[] | null; error: QueryError | null };
type SingleResult = { data: Row | null; error: QueryError | null };

interface Tables {
  trackers: Row[];
  snapshots: Row[];
  api_log: Row[];
}

interface Builder {
  select(columns?: string): Builder;
  insert(values: Row): Builder;
  update(values: Row): Builder;
  eq(column: string, value: unknown): Builder;
  in(column: string, list: unknown[]): Builder;
  order(column: string, opts?: { ascending?: boolean }): Builder;
  single(): Promise<SingleResult>;
  maybeSingle(): Promise<SingleResult>;
  then<T>(
    onFulfilled: (value: QueryResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>,
  ): Promise<T>;
}

/** Just enough of the supabase query builder for lib/capture.ts, backed by in-memory rows. */
function fakeAdmin(tables: Tables) {
  let nextId = 1;
  return {
    from(table: keyof Tables) {
      const rows = tables[table];
      let op: "select" | "insert" | "update" = "select";
      let values: Row = {};
      const filters: ((row: Row) => boolean)[] = [];
      let orderBy: { column: string; ascending: boolean } | null = null;

      const run = (): QueryResult => {
        if (op === "insert") {
          const clash =
            table === "snapshots" &&
            rows.some(
              (r) =>
                r.tracker_id === values.tracker_id &&
                r.day_number === values.day_number &&
                r.sample === values.sample,
            );
          if (clash) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          const row = { id: `${table}-${nextId++}`, ...values };
          rows.push(row);
          return { data: [row], error: null };
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") for (const r of matched) Object.assign(r, values);
        if (orderBy) {
          const { column, ascending } = orderBy;
          matched.sort((x, y) => (Number(x[column]) - Number(y[column])) * (ascending ? 1 : -1));
        }
        return { data: matched, error: null };
      };
      const one = async (): Promise<SingleResult> => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      };

      const builder: Builder = {
        select: () => builder,
        insert: (v) => {
          op = "insert";
          values = v;
          return builder;
        },
        update: (v) => {
          op = "update";
          values = v;
          return builder;
        },
        eq: (column, value) => {
          filters.push((r) => r[column] === value);
          return builder;
        },
        in: (column, list) => {
          filters.push((r) => list.includes(r[column]));
          return builder;
        },
        order: (column, opts) => {
          orderBy = { column, ascending: opts?.ascending ?? true };
          return builder;
        },
        single: one,
        maybeSingle: one,
        then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  fetchSerp: vi.fn<(req: unknown) => Promise<CaptureResult>>(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/lib/analyze", () => ({ runAnalysis: vi.fn(), regenerateDraft: vi.fn() }));
vi.mock("@/lib/dataforseo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataforseo")>();
  return { ...actual, fetchSerpWithAiOverview: mocks.fetchSerp };
});

const { captureSnapshot } = await import("@/lib/capture");

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const realFixture = path.join(fixturesDir, "dataforseo-ai-overview.real.json");

const TRACKER_ID = "tracker-1";
const A = "https://a.com/one";
const B = "https://b.com/two";
const C = "https://c.com/three";
const D = "https://d.com/four";
const E = "https://e.com/five";
const TYPEFORM = "https://www.typeform.com/pricing";

const dayOneText =
  "The best form builders in 2026 are Typeform, Jotform and Google Forms. " +
  "Typeform is the strongest choice for design-led teams.";
const dayTwoText =
  "The best form builders in 2026 are Typeform, Jotform and Google Forms. " +
  "Jotform now leads for teams that live off templates.";

function tracker(overrides: Partial<Tracker> = {}): Row {
  return {
    id: TRACKER_ID,
    user_id: "user-1",
    keyword: "best form builder",
    location_code: 2840,
    location_name: "United States",
    language_code: "en",
    device: "desktop",
    target_domain: "typeform.com",
    user_edge: null,
    status: "tracking",
    days_target: 7,
    day_count: 0,
    next_capture_at: "2026-10-10T00:00:00.000Z",
    keep_tracking: false,
    cited_on_day: null,
    last_error: null,
    created_at: "2026-10-09T06:00:00.000Z",
    ...overrides,
  };
}

function ref(url: string): OverviewReference {
  const domain = new URL(url).hostname.replace(/^www\./, "");
  return { url, domain, title: null, snippet: null, source: null, element_index: -1 };
}

/** A snapshot row as an earlier run would have stored it. */
function storedSample(
  day: number,
  sample: number,
  refs: string[],
  text: string | null,
  diff: SnapshotDiff | null = null,
): Row {
  return {
    id: `seed-${day}-${sample}`,
    tracker_id: TRACKER_ID,
    day_number: day,
    sample,
    captured_at: "2026-10-09T06:00:00.000Z",
    has_overview: text !== null,
    overview_text: text,
    overview_markdown: text,
    references: refs.map(ref),
    inline_links: [],
    raw: null,
    content_hash: null,
    diff,
    cost_usd: 0.004,
  };
}

/** A minimal DataForSEO `ai_overview` item: one paragraph plus top-level references. */
function overviewItem(refs: string[], text: string): unknown {
  return {
    type: "ai_overview",
    items: [{ type: "ai_overview_element", text }],
    references: refs.map((url) => ({ url, domain: new URL(url).hostname, title: null, text: null })),
  };
}

function serp(item: unknown, cost = 0.004): CaptureResult {
  return {
    hasOverview: item !== null,
    aiOverviewItem: item,
    cost,
    statusCode: 20000,
    statusMessage: "Ok.",
    raw: { items: item ? [item] : [] },
  };
}

const someDiff: SnapshotDiff = { added_refs: [E], removed_refs: [], text_similarity: null, changed_sentences: [] };

describe("captureSnapshot", () => {
  let tables: Tables;

  beforeEach(() => {
    tables = { trackers: [tracker()], snapshots: [], api_log: [] };
    mocks.admin = fakeAdmin(tables);
    mocks.fetchSerp.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes every sample of the day, logs each request and stores one row per sample", async () => {
    mocks.fetchSerp
      .mockResolvedValueOnce(serp(overviewItem([A, B], dayOneText)))
      .mockResolvedValueOnce(serp(overviewItem([B, C], dayOneText), 0.002))
      .mockResolvedValueOnce(serp(overviewItem([TYPEFORM], dayOneText)));

    const before = Date.now();
    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(mocks.fetchSerp).toHaveBeenCalledTimes(SAMPLES_PER_DAY);
    expect(mocks.fetchSerp).toHaveBeenCalledWith({
      keyword: "best form builder",
      location_code: 2840,
      language_code: "en",
      device: "desktop",
    });

    expect(snapshots.map((s) => s.sample)).toEqual([1, 2, 3]);
    expect(snapshots.every((s) => s.day_number === 1 && s.has_overview && s.tracker_id === TRACKER_ID)).toBe(true);
    expect(snapshots.map((s) => s.references.map((r) => r.url))).toEqual([[A, B], [B, C], [TYPEFORM]]);
    expect(snapshots.map((s) => s.cost_usd)).toEqual([0.004, 0.002, 0.004]);
    expect(tables.snapshots).toHaveLength(3);

    // The day diff lives on the first sample only.
    expect(snapshots[0].diff).toEqual({
      added_refs: [A, B, C, TYPEFORM],
      removed_refs: [],
      text_similarity: null,
      changed_sentences: [],
    });
    expect(snapshots[1].diff).toBeNull();
    expect(snapshots[2].diff).toBeNull();
    expect(tables.snapshots.find((r) => r.sample === 1)?.diff).toEqual(snapshots[0].diff);

    // One api_log row per request, with its cost.
    expect(tables.api_log).toHaveLength(3);
    expect(tables.api_log.map((r) => r.cost_usd)).toEqual([0.004, 0.002, 0.004]);
    for (const row of tables.api_log) {
      expect(row).toMatchObject({
        tracker_id: TRACKER_ID,
        provider: "dataforseo",
        endpoint: "serp/google/organic/live/advanced",
        status: 200,
        error: null,
      });
      expect(typeof row.duration_ms).toBe("number");
    }

    // The tracker advances once; any sample citing the site counts.
    expect(after).toMatchObject({ day_count: 1, status: "tracking", last_error: null, cited_on_day: 1 });
    expect(new Date(after.next_capture_at!).getTime()).toBeGreaterThan(before);
    expect(after.next_capture_at).toMatch(/T00:00:00\.000Z$/);
    expect(tables.trackers[0]).toMatchObject({ day_count: 1, cited_on_day: 1 });
  });

  it("keeps the samples the day already has and fetches only the missing ones", async () => {
    tables.snapshots.push(storedSample(1, 1, [A], dayOneText), storedSample(1, 3, [C], dayOneText));
    mocks.fetchSerp.mockResolvedValueOnce(serp(overviewItem([B], dayOneText)));

    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(mocks.fetchSerp).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.sample)).toEqual([1, 2, 3]);
    expect(snapshots[0].id).toBe("seed-1-1");
    expect(snapshots[1].id).toMatch(/^snapshots-/);
    expect(snapshots[2].id).toBe("seed-1-3");
    expect(snapshots[0].diff?.added_refs).toEqual([A, B, C]);
    expect(tables.api_log).toHaveLength(1);
    expect(after.day_count).toBe(1);
  });

  it("makes no request when the day is complete and still advances the tracker", async () => {
    tables.trackers = [tracker({ status: "error", last_error: "old failure" })];
    mocks.admin = fakeAdmin(tables);
    for (let sample = 1; sample <= SAMPLES_PER_DAY; sample++) {
      tables.snapshots.push(storedSample(1, sample, [A], dayOneText));
    }

    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(mocks.fetchSerp).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(SAMPLES_PER_DAY);
    expect(after).toMatchObject({ day_count: 1, status: "tracking", last_error: null });
  });

  it("keeps the row another run stored first when the insert hits the unique constraint", async () => {
    mocks.fetchSerp
      .mockResolvedValueOnce(serp(overviewItem([A], dayOneText)))
      .mockImplementationOnce(async () => {
        // An overlapping run stores sample 2 while this request is in flight.
        tables.snapshots.push(storedSample(1, 2, [B], dayOneText));
        return serp(overviewItem([C], dayOneText));
      })
      .mockResolvedValueOnce(serp(overviewItem([D], dayOneText)));

    const { snapshots } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(tables.snapshots).toHaveLength(3);
    expect(snapshots.map((s) => s.sample)).toEqual([1, 2, 3]);
    expect(snapshots[1].id).toBe("seed-1-2");
    expect(snapshots[1].references.map((r) => r.url)).toEqual([B]);
    expect(tables.api_log).toHaveLength(3);
  });

  it("stores the day when at least one sample worked", async () => {
    const down = new DataForSeoError(0, "fetch failed");
    mocks.fetchSerp
      .mockRejectedValueOnce(down)
      .mockResolvedValueOnce(serp(overviewItem([B], dayOneText)))
      .mockRejectedValueOnce(new DataForSeoError(50000, "Internal error"));

    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(snapshots.map((s) => s.sample)).toEqual([2]);
    expect(snapshots[0].diff?.added_refs).toEqual([B]);
    expect(after).toMatchObject({ day_count: 1, status: "tracking", last_error: null, cited_on_day: null });
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(tables.api_log.map((r) => [r.status, r.cost_usd])).toEqual([
      [null, 0],
      [200, 0.004],
      [50000, 0],
    ]);
    expect(tables.api_log[0].error).toBe("Could not reach the search data service. Try again in a minute.");
    expect(tables.api_log[2].error).toBe("Search data service error: Internal error (code 50000)");
  });

  it("fails day 1 with status error when no sample worked", async () => {
    const down = new DataForSeoError(0, "fetch failed");
    mocks.fetchSerp.mockRejectedValue(down);

    await expect(captureSnapshot(TRACKER_ID, { dayNumber: 1 })).rejects.toBe(down);

    expect(tables.snapshots).toHaveLength(0);
    expect(tables.trackers[0]).toMatchObject({
      status: "error",
      day_count: 0,
      last_error: "Could not reach the search data service. Try again in a minute.",
    });
    expect(tables.api_log).toHaveLength(3);
    expect(tables.api_log.every((r) => r.status === null && r.cost_usd === 0)).toBe(true);
  });

  it("records a later day's failure without changing the status", async () => {
    tables.trackers = [tracker({ day_count: 1 })];
    mocks.admin = fakeAdmin(tables);
    tables.snapshots.push(storedSample(1, 1, [A], dayOneText));
    const bad = new DataForSeoError(40501, "Invalid keyword");
    mocks.fetchSerp.mockRejectedValue(bad);

    await expect(captureSnapshot(TRACKER_ID)).rejects.toBe(bad);

    expect(tables.trackers[0]).toMatchObject({
      status: "tracking",
      day_count: 1,
      last_error: "Search data service error: Invalid keyword (code 40501)",
    });
    expect(tables.api_log.every((r) => r.status === 40501)).toBe(true);
  });

  it("compares today's union with yesterday's and stores the diff on the first sample", async () => {
    tables.trackers = [tracker({ day_count: 1 })];
    mocks.admin = fakeAdmin(tables);
    tables.snapshots.push(
      storedSample(1, 1, [A, B], dayOneText),
      storedSample(1, 2, [B, C], null),
      storedSample(1, 3, [C], "A third sample that said something else."),
      // Sample 3 of day 2 came from an earlier partial run and carried the diff then.
      storedSample(2, 3, [E], dayTwoText, someDiff),
    );
    mocks.fetchSerp
      .mockResolvedValueOnce(serp(overviewItem([C, D], dayTwoText)))
      .mockResolvedValueOnce(serp(overviewItem([A], "Only a short line.")));

    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID);

    expect(mocks.fetchSerp).toHaveBeenCalledTimes(2);
    expect(snapshots.map((s) => [s.day_number, s.sample])).toEqual([
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(snapshots[0].diff).toEqual({
      added_refs: [D, E],
      removed_refs: [B],
      text_similarity: expect.any(Number),
      changed_sentences: ["Jotform now leads for teams that live off templates."],
    });
    expect(snapshots[0].diff?.text_similarity).toBeGreaterThan(0);
    expect(snapshots[0].diff?.text_similarity).toBeLessThan(1);
    expect(snapshots[1].diff).toBeNull();
    expect(snapshots[2].diff).toBeNull();
    expect(tables.snapshots.find((r) => r.id === "seed-2-3")?.diff).toBeNull();
    expect(after).toMatchObject({ day_count: 2, status: "tracking" });
  });

  it("moves a tracking keyword to ready on its last day", async () => {
    tables.trackers = [tracker({ day_count: 6, target_domain: null })];
    mocks.admin = fakeAdmin(tables);
    mocks.fetchSerp.mockResolvedValue(serp(overviewItem([A], dayOneText)));

    const { snapshots, tracker: after } = await captureSnapshot(TRACKER_ID);

    expect(snapshots.every((s) => s.day_number === 7)).toBe(true);
    expect(after).toMatchObject({ day_count: 7, status: "ready", cited_on_day: null });
  });

  it.skipIf(!existsSync(realFixture))("stores a real DataForSEO response as a sample", async () => {
    const real: unknown = JSON.parse(readFileSync(realFixture, "utf8"));
    const item = findAiOverviewItem(real);
    expect(item).not.toBeNull();
    mocks.fetchSerp.mockResolvedValue(serp(item));

    const { snapshots } = await captureSnapshot(TRACKER_ID, { dayNumber: 1 });

    expect(snapshots).toHaveLength(SAMPLES_PER_DAY);
    for (const snapshot of snapshots) {
      expect(snapshot.has_overview).toBe(true);
      expect(snapshot.references.length).toBeGreaterThan(0);
      expect(snapshot.overview_text).toBeTruthy();
      expect(snapshot.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.raw).toEqual({ items: [item] });
    }
    expect(snapshots[0].diff?.added_refs).toEqual(snapshots[0].references.map((r) => r.url));
  });
});
