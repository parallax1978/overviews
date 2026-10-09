import { describe, expect, it } from "vitest";
import { isCaptureDue, nextCaptureAt } from "@/lib/schedule";

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
