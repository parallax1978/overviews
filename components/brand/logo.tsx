import Link from "next/link";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** Logo mark + wordmark, same construction as LegiitKeywords. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Legiit Overviews" className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="brand-gradient inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-glow"
      >
        <Sparkles className="h-3.5 w-3.5 stroke-[2.5]" />
      </span>
      <span className="text-[15px] font-bold tracking-tight text-ink">
        Legiit<span className="text-brand">Overviews</span>
      </span>
    </Link>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[15px] font-bold tracking-tight text-ink", className)}>
      Legiit<span className="text-brand">Overviews</span>
    </span>
  );
}
