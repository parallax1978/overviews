import { describe, expect, it, vi } from "vitest";
import { restingStatus, statusAfterAnalysis } from "@/lib/analyze";
import { isCaptureDue } from "@/lib/schedule";
import type { TrackerStatus } from "@/lib/types";

// lib/analyze.ts only builds the admin client inside the functions that do IO;
// the pure status helpers under test never touch it.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

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
