import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Small uppercase label above a heading, in brand purple by default. */
export function Eyebrow({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("eyebrow text-brand", className)} {...rest} />;
}
