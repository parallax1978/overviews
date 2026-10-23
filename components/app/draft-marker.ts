/**
 * The sessionStorage marker `DraftAutoStart` keeps per report. It says whether
 * this browser tab already asked for the ready-to-publish page, so a reload or
 * another tab of the keyword page neither starts a second (paid) request while
 * one is running nor pays again after one failed. Pure over a Storage-like
 * object so the states are unit-tested; the component passes `sessionStorage`.
 */

/**
 * A draft request started this long ago in this browser tab counts as lost,
 * so a later visit starts a new one. Longer than the route's maxDuration
 * (800 s), so a request that is still running is never started over.
 */
export const STARTED_TTL_MS = 15 * 60 * 1000;

/** A failed request is stored as this prefix plus the error shown to the user. It never expires. */
const FAILED_PREFIX = "failed:";

/** The subset of Storage the marker needs, so tests can pass a plain in-memory one. */
export type MarkerStorage = Pick<Storage, "getItem" | "setItem">;

export type DraftMarker =
  /** No request from this tab, or one that started so long ago it counts as lost. */
  | { state: "none" }
  /** A request started recently: running, or just finished and the page is about to refresh. */
  | { state: "running"; startedAt: number }
  /** A request failed; the tab does not try again by itself. */
  | { state: "failed"; error: string };

/** What the stored marker means at `now`. Storage that is blocked (private mode, quota) reads as "none". */
export function readMarker(storage: MarkerStorage | null, key: string, now: number): DraftMarker {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    // Storage blocked: the component's ref guard still stops a second request in the same mount.
  }
  return parseMarker(raw, now);
}

/** Records that a request started at `at`, replacing any earlier marker (also a failed one, on Try again). */
export function markStarted(storage: MarkerStorage | null, key: string, at: number): void {
  write(storage, key, String(at));
}

/** Records that the request failed with `error`, so no later mount in this tab starts another one. */
export function markFailed(storage: MarkerStorage | null, key: string, error: string): void {
  write(storage, key, FAILED_PREFIX + error);
}

/** The meaning of a raw marker value at `now`. */
export function parseMarker(raw: string | null, now: number): DraftMarker {
  if (!raw) return { state: "none" };
  if (raw.startsWith(FAILED_PREFIX)) return { state: "failed", error: raw.slice(FAILED_PREFIX.length) };
  const startedAt = Number(raw);
  if (!Number.isFinite(startedAt) || now - startedAt >= STARTED_TTL_MS) return { state: "none" };
  return { state: "running", startedAt };
}

function write(storage: MarkerStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage blocked: the component's ref guard still stops a second request in the same mount.
  }
}
