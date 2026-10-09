"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches the current server page on an interval. Renders nothing. Used while a report is being written. */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
