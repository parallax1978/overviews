import { Chip, type ChipTone } from "@/components/ui/chip";
import type { Tracker } from "@/lib/types";

/** Plain-English status for a tracker, in the Legiit chip style. */
export function statusLabel(t: Pick<Tracker, "status" | "day_count" | "days_target" | "keep_tracking">): {
  label: string;
  tone: ChipTone;
} {
  switch (t.status) {
    case "tracking":
      return { label: `Tracking · day ${Math.min(t.day_count, t.days_target)} of ${t.days_target}`, tone: "brand" };
    case "ready":
      return { label: "Ready to analyze", tone: "warn" };
    case "analyzing":
      return { label: "Writing your report", tone: "brand" };
    case "analyzed":
      return { label: t.keep_tracking ? "Report ready · still tracking" : "Report ready", tone: "good" };
    case "paused":
      return { label: "Paused", tone: "neutral" };
    case "error":
      return { label: "Capture failed", tone: "bad" };
    default:
      return { label: t.status, tone: "neutral" };
  }
}

export function StatusChip({ tracker }: { tracker: Pick<Tracker, "status" | "day_count" | "days_target" | "keep_tracking"> }) {
  const { label, tone } = statusLabel(tracker);
  return <Chip tone={tone}>{label}</Chip>;
}
