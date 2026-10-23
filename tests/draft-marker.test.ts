import { describe, expect, it } from "vitest";
import {
  STARTED_TTL_MS,
  markFailed,
  markStarted,
  parseMarker,
  readMarker,
  type MarkerStorage,
} from "@/components/app/draft-marker";

const KEY = "draft-auto-tracker-report";
const NOW = 1_760_000_000_000;

/** A plain in-memory stand-in for one browser tab's sessionStorage. */
function memoryStorage(): MarkerStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("parseMarker", () => {
  it("means nothing is running when the marker is absent, malformed or expired", () => {
    expect(parseMarker(null, NOW)).toEqual({ state: "none" });
    expect(parseMarker("", NOW)).toEqual({ state: "none" });
    expect(parseMarker("soon", NOW)).toEqual({ state: "none" });
    expect(parseMarker(String(NOW - STARTED_TTL_MS), NOW)).toEqual({ state: "none" });
  });

  it("keeps a recent request running until it expires", () => {
    expect(parseMarker(String(NOW - STARTED_TTL_MS + 1), NOW)).toEqual({
      state: "running",
      startedAt: NOW - STARTED_TTL_MS + 1,
    });
  });
});

describe("draft auto-start marker", () => {
  it("records a started request and lets it expire", () => {
    const storage = memoryStorage();
    markStarted(storage, KEY, NOW);
    expect(readMarker(storage, KEY, NOW + 1000)).toEqual({ state: "running", startedAt: NOW });
    expect(readMarker(storage, KEY, NOW + STARTED_TTL_MS)).toEqual({ state: "none" });
  });

  it("keeps a failure, however old, so the tab never pays for another attempt by itself", () => {
    const storage = memoryStorage();
    markStarted(storage, KEY, NOW);
    markFailed(storage, KEY, "Claude stopped before the page was finished.");
    const failed = { state: "failed", error: "Claude stopped before the page was finished." };
    expect(readMarker(storage, KEY, NOW + 1000)).toEqual(failed);
    expect(readMarker(storage, KEY, NOW + 10 * STARTED_TTL_MS)).toEqual(failed);
  });

  it("replaces a failure with a running request when the user tries again", () => {
    const storage = memoryStorage();
    markFailed(storage, KEY, "Something went wrong writing your page. Please try again.");
    markStarted(storage, KEY, NOW + 5000);
    expect(readMarker(storage, KEY, NOW + 6000)).toEqual({ state: "running", startedAt: NOW + 5000 });
  });

  it("keeps markers of different reports apart", () => {
    const storage = memoryStorage();
    markFailed(storage, KEY, "Web search is turned off.");
    expect(readMarker(storage, "draft-auto-tracker-other-report", NOW)).toEqual({ state: "none" });
  });

  it("reads blocked storage as nothing running and swallows blocked writes", () => {
    const blocked: MarkerStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "QuotaExceededError");
      },
    };
    expect(() => markStarted(blocked, KEY, NOW)).not.toThrow();
    expect(() => markFailed(blocked, KEY, "x")).not.toThrow();
    expect(readMarker(blocked, KEY, NOW)).toEqual({ state: "none" });
    expect(readMarker(null, KEY, NOW)).toEqual({ state: "none" });
  });
});
