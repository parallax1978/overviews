import { cn } from "@/lib/utils";

/** Round numbered badge used for steps and day numbers. */
export function NumberBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-faint text-xs font-bold text-brand-strong",
        className,
      )}
    >
      {children}
    </span>
  );
}
