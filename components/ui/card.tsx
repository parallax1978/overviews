import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** White card with the Legiit "pop" shadow. */
export function Card({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-white p-5 shadow-pop sm:p-6", className)}
      {...rest}
    />
  );
}

/** Flat card without shadow, for lists and secondary content. */
export function Panel({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-line bg-white", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-bold tracking-tight text-ink", className)} {...rest} />;
}
