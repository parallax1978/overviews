"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

/** A report request started this long ago in this tab counts as lost (the route's maxDuration is 300s). */
const STARTED_TTL_MS = 6 * 60 * 1000;
/** How soon after starting we refresh so the server's "building your report" state takes over. */
const EARLY_REFRESH_MS = 2500;

/**
 * Shown on the Report tab when all days are in but no report was ever built
 * (the cron ran out of time). Starts the report once on mount and refreshes
 * the page; the page then shows live progress from the server.
 */
export function ReportAutoStart({ trackerId, daysTarget }: { trackerId: string; daysTarget: number }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `report-auto-${trackerId}`;

  const start = useCallback(async () => {
    writeStartedAt(storageKey);
    const early = setTimeout(() => router.refresh(), EARLY_REFRESH_MS);
    try {
      const response = await fetch(`/api/trackers/${trackerId}/analyze`, { method: "POST" });
      clearTimeout(early);
      if (!response.ok && response.status !== 409) {
        clearStartedAt(storageKey);
        setError(await readError(response));
        return;
      }
      clearStartedAt(storageKey);
      router.refresh();
    } catch {
      clearTimeout(early);
      setError("We lost the connection. Refresh the page in a few minutes to see whether your report arrived.");
    }
  }, [router, storageKey, trackerId]);

  useEffect(() => {
    const at = readStartedAt(storageKey);
    if (at != null && Date.now() - at < STARTED_TTL_MS) {
      // A request from a moment ago (reload, other tab) is probably still running.
      const timer = setInterval(() => router.refresh(), 5000);
      return () => clearInterval(timer);
    }
    // Kick off on the next tick; the ref keeps a re-run of this effect from starting twice.
    const kick = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void start();
    }, 0);
    return () => clearTimeout(kick);
  }, [router, start, storageKey]);

  if (error) {
    return (
      <Card>
        <Eyebrow>Report</Eyebrow>
        <div role="alert" className="mt-2 flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-ink">We couldn&apos;t build your report</h2>
            <p className="mt-1 text-sm text-bad">{error}</p>
          </div>
        </div>
        <div className="mt-4">
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              void start();
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Eyebrow>Report</Eyebrow>
      <div className="mt-2 flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-faint text-brand-strong">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">
            All {daysTarget} days are in. Building your report…
          </h2>
          <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
            Two to five minutes. The page updates by itself, so you can leave it open.
          </p>
        </div>
      </div>
    </Card>
  );
}

function readStartedAt(key: string): number | null {
  try {
    const value = Number(sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStartedAt(key: string): void {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: the ref guard still stops a second request in this mount.
  }
}

function clearStartedAt(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON.
  }
  return "Something went wrong building your report. Please try again.";
}
