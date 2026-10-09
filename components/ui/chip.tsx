import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "good" | "warn" | "bad" | "brand" | "neutral";

const tones: Record<ChipTone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  brand: "bg-brand-faint text-brand-strong",
  neutral: "bg-surface-sunken text-ink-muted",
};

export interface ChipProps extends ComponentProps<"span"> {
  tone?: ChipTone;
}

export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}
