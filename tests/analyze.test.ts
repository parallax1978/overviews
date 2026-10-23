import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftInput, DraftOutput } from "@/lib/claude";
import { isCaptureDue } from "@/lib/schedule";
import type { TrackerStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// The database is an in-memory fake of the few query shapes lib/analyze.ts
// uses for a draft; Claude is a mock. The pure status helpers never touch either.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string };
type QueryResult = { data: Row[] | null; error: QueryError | null };
type SingleResult = { data: Row | null; error: QueryError | null };

interface Tables {
  trackers: Row[];
  analyses: Row[];
  drafts: Row[];
  api_log: Row[];
}

interface Builder {
  select(columns?: string): Builder;
  insert(values: Row): Builder;
  update(values: Row): Builder;
  eq(column: string, value: unknown): Builder;
  or(filters: string): Builder;
  order(column: string, opts?: { ascending?: boolean }): Builder;
  limit(count: number): Builder;
  single(): Promise<SingleResult>;
  maybeSingle(): Promise<SingleResult>;
  then<T>(
    onFulfilled: (value: QueryResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>,
  ): Promise<T>;
}

function compare(x: unknown, y: unknown): number {
  if (x === y) return 0;
  return (x as number | string) < (y as number | string) ? -1 : 1;
}

/** Just enough of the supabase query builder for regenerateDraft and the draft route, backed by in-memory rows. */
function fakeAdmin(tables: Tables) {
  let nextId = 1;
  return {
    from(table: keyof Tables) {
      const rows = tables[table];
      let op: "select" | "insert" | "update" = "select";
      let values: Row = {};
      const filters: ((row: Row) => boolean)[] = [];
      let orderBy: { column: string; ascending: boolean } | null = null;
      let limitTo: number | null = null;

      const run = (): QueryResult => {
        if (op === "insert") {
          const row = { id: `${table}-${nextId++}`, ...values };
          rows.push(row);
          return { data: [row], error: null };
        }
        const matched = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") for (const r of matched) Object.assign(r, values);
        if (orderBy) {
          const { column, ascending } = orderBy;
          matched.sort((x, y) => compare(x[column], y[column]) * (ascending ? 1 : -1));
        }
        return { data: limitTo === null ? matched : matched.slice(0, limitTo), error: null };
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
        // PostgREST "col.is.null,col.lt.value": any one of the comma-separated filters.
        or: (spec) => {
          const tests = spec.split(",").map((part) => {
            const [column, operator, ...rest] = part.split(".");
            const value = rest.join(".");
            if (operator === "is" && value === "null") return (r: Row) => r[column] == null;
            if (operator === "lt") return (r: Row) => r[column] != null && compare(r[column], value) < 0;
            throw new Error(`fakeAdmin: unsupported filter ${part}`);
          });
          filters.push((r) => tests.some((t) => t(r)));
          return builder;
        },
        order: (column, opts) => {
          orderBy = { column, ascending: opts?.ascending ?? true };
          return builder;
        },
        limit: (count) => {
          limitTo = count;
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
  writeDraft: vi.fn<(input: DraftInput) => Promise<DraftOutput>>(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, writeDraft: mocks.writeDraft };
});
// The draft route: a signed-in user whose RLS client reads the same fake rows.
vi.mock("@/lib/auth", () => ({ getUser: async () => ({ id: "user-1", email: null }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.admin }));

const { DraftInProgressError, STALE_DRAFT_MS, isDraftWriting, regenerateDraft, restingStatus, statusAfterAnalysis } =
  await import("@/lib/analyze");
const { POST: postDraft } = await import("@/app/api/trackers/[id]/draft/route");

const TRACKER_ID = "tracker-1";
const ANALYSIS_ID = "analysis-1";

/** One analyzed keyword with a finished report and no draft yet. */
function seed(analysis: Row = {}): Tables {
  return {
    trackers: [
      {
        id: TRACKER_ID,
        user_id: "user-1",
        keyword: "best form builder",
        status: "analyzed",
        target_domain: null,
        user_edge: null,
        competitor_policy: "avoid",
        day_count: 7,
        days_target: 7,
      },
    ],
    analyses: [
      {
        id: ANALYSIS_ID,
        tracker_id: TRACKER_ID,
        status: "done",
        created_at: "2026-10-23T06:04:00.000Z",
        patterns: { stable_core: "Google always lists Typeform, Jotform and Google Forms." },
        citation_research: [],
        blueprint: { page_goal: "Help a small business pick a form builder." },
        draft_started_at: null,
        ...analysis,
      },
    ],
    drafts: [],
    api_log: [],
  };
}

function draftOutput(): DraftOutput {
  return {
    title: "Best Form Builder in 2026",
    meta_description: "Typeform is the best form builder for most teams.",
    h1: "The Best Form Builder in 2026",
    outline: [{ heading: "Quick answer", summary: "Typeform wins." }],
    content_md: "# The Best Form Builder in 2026\n\nTypeform wins.",
    why_better_md: "- [x] Answers in the first sentence",
    sources: [],
    usage: { input_tokens: 1000, output_tokens: 500 } as unknown as DraftOutput["usage"],
    model: "claude-opus-5-5",
  };
}

/** A writeDraft that signals when Claude was called and finishes only when told to. */
function slowWrite(): { called: Promise<void>; finish: () => void } {
  let finish!: () => void;
  const called = new Promise<void>((resolveCalled) => {
    mocks.writeDraft.mockImplementationOnce(
      () =>
        new Promise<DraftOutput>((resolve) => {
          finish = () => resolve(draftOutput());
          resolveCalled();
        }),
    );
  });
  return { called, finish: () => finish() };
}

beforeEach(() => {
  mocks.writeDraft.mockReset();
});

// ---------------------------------------------------------------------------
// Pure status helpers
// ---------------------------------------------------------------------------

describe("statusAfterAnalysis", () => {
  it("marks a keyword analyzed once its report is done", () => {
    const previous: TrackerStatus[] = ["tracking", "ready", "analyzed", "error"];
    for (const status of previous) expect(statusAfterAnalysis(status)).toBe("analyzed");
  });

  it("keeps a paused keyword paused, so the report does not restart the daily capture", () => {
    const status = statusAfterAnalysis("paused");
    expect(status).toBe("paused");

    // The scenario from the defect: paused on day 3 with a capture time already due.
    // An "analyzed" keyword with days left would be captured; a paused one never is.
    const tracker = {
      keep_tracking: false,
      day_count: 3,
      days_target: 7,
      next_capture_at: "2026-10-10T00:00:00Z",
    };
    const cron = new Date("2026-10-10T06:05:00Z");
    expect(isCaptureDue({ ...tracker, status: "analyzed" }, cron)).toBe(true);
    expect(isCaptureDue({ ...tracker, status }, cron)).toBe(false);
  });
});

describe("restingStatus", () => {
  it("is analyzed whenever a finished report exists, even with days left", () => {
    expect(restingStatus({ day_count: 3, days_target: 7 }, true)).toBe("analyzed");
    expect(restingStatus({ day_count: 7, days_target: 7 }, true)).toBe("analyzed");
  });

  it("is ready once all days are in, else tracking", () => {
    expect(restingStatus({ day_count: 7, days_target: 7 }, false)).toBe("ready");
    expect(restingStatus({ day_count: 8, days_target: 7 }, false)).toBe("ready");
    expect(restingStatus({ day_count: 3, days_target: 7 }, false)).toBe("tracking");
  });
});

describe("isDraftWriting", () => {
  const now = Date.parse("2026-10-23T06:10:00.000Z");

  it("is true only while the report carries a claim younger than STALE_DRAFT_MS", () => {
    expect(isDraftWriting(null, now)).toBe(false);
    expect(isDraftWriting({}, now)).toBe(false);
    expect(isDraftWriting({ draft_started_at: null }, now)).toBe(false);
    expect(isDraftWriting({ draft_started_at: new Date(now - 60_000).toISOString() }, now)).toBe(true);
    expect(isDraftWriting({ draft_started_at: new Date(now - STALE_DRAFT_MS + 1000).toISOString() }, now)).toBe(true);
    expect(isDraftWriting({ draft_started_at: new Date(now - STALE_DRAFT_MS).toISOString() }, now)).toBe(false);
    expect(isDraftWriting({ draft_started_at: "not a date" }, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// regenerateDraft: one claim per report, so the cron and the keyword page (or
// two browser tabs) never pay for the same draft twice.
// ---------------------------------------------------------------------------

describe("regenerateDraft claim", () => {
  it("lets the first caller write the draft and tells a second one it is in progress", async () => {
    const tables = seed();
    mocks.admin = fakeAdmin(tables);
    const write = slowWrite();

    // The cron starts the researched draft...
    const first = regenerateDraft(TRACKER_ID, null, "researched");
    await write.called;
    expect(tables.analyses[0].draft_started_at).toEqual(expect.any(String));

    // ...and the keyword page, refreshed while the report flipped to done, asks for it too.
    await expect(regenerateDraft(TRACKER_ID, null, "researched")).rejects.toBeInstanceOf(DraftInProgressError);
    expect(mocks.writeDraft).toHaveBeenCalledTimes(1);
    // The loser never reached Claude, so it logged no API call; the claim is still the winner's.
    expect(tables.api_log).toHaveLength(0);
    expect(tables.analyses[0].draft_started_at).toEqual(expect.any(String));

    write.finish();
    const draft = await first;
    expect(draft).toMatchObject({ tracker_id: TRACKER_ID, analysis_id: ANALYSIS_ID, mode: "researched" });
    expect(tables.drafts).toHaveLength(1);
    expect(tables.api_log).toHaveLength(1);
    // Released on success, so a notes revision can follow at once.
    expect(tables.analyses[0].draft_started_at).toBeNull();
  });

  it("serializes both modes and notes revisions under the same claim", async () => {
    const tables = seed();
    mocks.admin = fakeAdmin(tables);
    const write = slowWrite();

    const first = regenerateDraft(TRACKER_ID, null, "researched");
    await write.called;
    await expect(regenerateDraft(TRACKER_ID, null, "placeholders")).rejects.toBeInstanceOf(DraftInProgressError);
    await expect(regenerateDraft(TRACKER_ID, "Shorten the intro", "researched")).rejects.toBeInstanceOf(
      DraftInProgressError,
    );
    write.finish();
    await first;

    mocks.writeDraft.mockResolvedValueOnce(draftOutput());
    const second = await regenerateDraft(TRACKER_ID, null, "placeholders");
    expect(second.mode).toBe("placeholders");
    expect(tables.drafts).toHaveLength(2);
  });

  it("takes over a claim older than STALE_DRAFT_MS (the platform killed that function)", async () => {
    const tables = seed({ draft_started_at: new Date(Date.now() - STALE_DRAFT_MS - 1000).toISOString() });
    mocks.admin = fakeAdmin(tables);
    mocks.writeDraft.mockResolvedValueOnce(draftOutput());

    const draft = await regenerateDraft(TRACKER_ID, null, "researched");
    expect(draft.mode).toBe("researched");
    expect(mocks.writeDraft).toHaveBeenCalledTimes(1);
    expect(tables.analyses[0].draft_started_at).toBeNull();
  });

  it("refuses while a recent claim stands, without calling Claude", async () => {
    const tables = seed({ draft_started_at: new Date(Date.now() - 60_000).toISOString() });
    mocks.admin = fakeAdmin(tables);

    await expect(regenerateDraft(TRACKER_ID, null, "researched")).rejects.toThrow(
      "Your page is already being written. Give it a minute.",
    );
    expect(mocks.writeDraft).not.toHaveBeenCalled();
    expect(tables.drafts).toHaveLength(0);
  });

  it("releases the claim when the write fails, and logs the failed call", async () => {
    const tables = seed();
    mocks.admin = fakeAdmin(tables);
    mocks.writeDraft.mockRejectedValueOnce(new Error("Claude ran out of room before finishing. Please try again."));

    await expect(regenerateDraft(TRACKER_ID, null, "researched")).rejects.toThrow("ran out of room");
    expect(tables.analyses[0].draft_started_at).toBeNull();
    expect(tables.drafts).toHaveLength(0);
    expect(tables.api_log).toHaveLength(1);
    expect(tables.api_log[0]).toMatchObject({ endpoint: "messages:draft", cost_usd: 0 });
    expect(tables.api_log[0].error).toContain("ran out of room");

    // The next attempt goes through.
    mocks.writeDraft.mockResolvedValueOnce(draftOutput());
    await expect(regenerateDraft(TRACKER_ID, null, "researched")).resolves.toMatchObject({ mode: "researched" });
  });
});

// ---------------------------------------------------------------------------
// POST /api/trackers/[id]/draft
// ---------------------------------------------------------------------------

describe("POST /api/trackers/[id]/draft", () => {
  function post(body: unknown) {
    const request = new Request(`http://localhost/api/trackers/${TRACKER_ID}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return postDraft(request, { params: Promise.resolve({ id: TRACKER_ID }) });
  }

  it("answers 409 while a draft is already being written, so the page shows that instead of a failure", async () => {
    const tables = seed({ draft_started_at: new Date().toISOString() });
    mocks.admin = fakeAdmin(tables);

    const response = await post({ mode: "researched" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Your page is already being written. Give it a minute." });
    expect(mocks.writeDraft).not.toHaveBeenCalled();
    expect(tables.drafts).toHaveLength(0);
  });

  it("writes the draft and answers its id otherwise", async () => {
    const tables = seed();
    mocks.admin = fakeAdmin(tables);
    mocks.writeDraft.mockResolvedValueOnce(draftOutput());

    const response = await post({ mode: "researched" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ draftId: tables.drafts[0].id, mode: "researched" });
    expect(tables.analyses[0].draft_started_at).toBeNull();
  });
});
