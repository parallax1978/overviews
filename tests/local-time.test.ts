import { describe, expect, it } from "vitest";
import { formatLocalTime } from "@/components/ui/local-time";
import { formatDate, formatDateTime } from "@/lib/utils";

const ISO = "2026-10-09T06:00:00.000Z";

describe("formatLocalTime", () => {
  it("prints the lib/utils shapes in the zone it is given", () => {
    expect(formatLocalTime(ISO, "date", { timeZone: "UTC" })).toEqual({ text: "Oct 9, 2026" });
    expect(formatLocalTime(ISO, "datetime", { timeZone: "UTC" })).toEqual({ text: "Oct 9, 6:00 AM" });
    expect(formatLocalTime(ISO, "datetime", { timeZone: "America/New_York" })).toEqual({ text: "Oct 9, 2:00 AM" });
    expect(formatLocalTime(ISO, "datetime", { timeZone: "Asia/Tokyo" })).toEqual({ text: "Oct 9, 3:00 PM" });
  });

  it("matches formatDate / formatDateTime in the process zone", () => {
    expect(formatLocalTime(ISO, "date").text).toBe(formatDate(ISO));
    expect(formatLocalTime(ISO, "datetime").text).toBe(formatDateTime(ISO));
  });

  it("says relative times in plain words and keeps the absolute time as the title", () => {
    const now = Date.parse("2026-10-09T03:00:00.000Z");
    expect(formatLocalTime(ISO, "relative", { now, timeZone: "UTC" })).toEqual({
      text: "in 3 hours",
      title: "Oct 9, 6:00 AM",
    });
    expect(formatLocalTime("2026-10-07T03:00:00.000Z", "relative", { now }).text).toBe("2 days ago");
    expect(formatLocalTime("2026-10-10T03:00:00.000Z", "relative", { now }).text).toBe("tomorrow");
    expect(formatLocalTime("2026-10-09T03:45:00.000Z", "relative", { now }).text).toBe("in 45 minutes");
    expect(formatLocalTime("2026-10-09T03:00:30.000Z", "relative", { now }).text).toBe("in a moment");
    expect(formatLocalTime("2026-10-09T02:59:40.000Z", "relative", { now }).text).toBe("just now");
  });

  it("renders nothing for a timestamp that does not parse", () => {
    expect(formatLocalTime("not a date", "datetime")).toEqual({ text: "" });
  });
});
