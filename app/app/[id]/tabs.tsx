import Link from "next/link";
import type { TrackerStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type TabKey = "timeline" | "citations" | "report" | "draft";

const TAB_LABELS: Record<TabKey, string> = {
  timeline: "Timeline",
  citations: "Citations",
  report: "Report",
  draft: "Draft",
};

const TAB_ORDER: TabKey[] = ["timeline", "citations", "report", "draft"];

/** Picks the tab to show: the ?tab= value when valid, else Report once the report exists, else Timeline. */
export function resolveTab(param: string | string[] | undefined, status: TrackerStatus): TabKey {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw && (TAB_ORDER as string[]).includes(raw)) return raw as TabKey;
  return status === "analyzed" ? "report" : "timeline";
}

export interface TabsProps {
  trackerId: string;
  active: TabKey;
  /** Distinct sources seen so far; shown as a badge on the Citations tab. */
  citationsCount: number;
  /** Shows a pulsing dot on the Report tab while the report is being written. */
  analyzing: boolean;
}

/** The four-tab row on the keyword page. Plain links, so the active tab lives in the URL. */
export function Tabs({ trackerId, active, citationsCount, analyzing }: TabsProps) {
  return (
    <nav aria-label="Keyword sections" className="-mb-px flex gap-6 overflow-x-auto border-b border-line">
      {TAB_ORDER.map((key) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={`/app/${trackerId}?tab=${key}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-semibold transition-colors",
              isActive
                ? "border-brand text-ink"
                : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            {TAB_LABELS[key]}
            {key === "citations" && citationsCount > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none",
                  isActive ? "bg-brand-faint text-brand-strong" : "bg-surface-sunken text-ink-muted",
                )}
              >
                {citationsCount}
              </span>
            ) : null}
            {key === "report" && analyzing ? (
              <span className="relative flex h-2 w-2" aria-label="Report in progress">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
