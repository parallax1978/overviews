"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * A draft request started this long ago in this browser tab counts as lost,
 * so a later visit starts a new one. Longer than the route's maxDuration
 * (800 s), so a request that is still running is never started over.
 */
const STARTED_TTL_MS = 15 * 60 * 1000;
/** How often to look for the draft while a request started earlier in this tab is still running. */
const POLL_MS = 5000;

export interface DraftAutoStartProps {
  trackerId: string;
  /** The finished report the page is written for. */
  analysisId: string;
  /** Start the draft without showing anything (the Draft tab shows the progress). */
  silent?: boolean;
}

/**
 * Shown in place of the draft when the report is done but its page was never
 * written (the function that writes both was stopped in between). Starts the
 * draft once on mount, then refreshes the page so the draft shows up.
 * A sessionStorage marker, keyed by the report, keeps a reload, or the other
 * tabs of the keyword page, from starting a second draft while the first one
 * is still running. The marker stays after a success (it expires on its own),
 * so a missing marker only ever means a request in this tab failed.
 */
export function DraftAutoStart({ trackerId, analysisId, silent = false }: DraftAutoStartProps) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `draft-auto-${trackerId}-${analysisId}`;

  const start = useCallback(async () => {
    writeStartedAt(storageKey, Date.now());
    try {
      const response = await fetch(`/api/trackers/${trackerId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        clearStartedAt(storageKey);
        setError(await readError(response));
        return;
      }
      // The draft is written. Keep the marker: a poller in another mount of this page
      // (the user switched tabs meanwhile) must not read "marker gone" as "nothing is
      // running" and pay for a second draft. The refreshed page unmounts both.
      router.refresh();
    } catch {
      // The server may still be writing: keep the marker so a reload waits instead of paying for a second draft.
      setError("We lost the connection. Refresh the page in a minute to see whether your page arrived.");
    }
  }, [router, storageKey, trackerId]);

  useEffect(() => {
    const startedAt = readStartedAt(storageKey);
    if (startedAt == null || Date.now() - startedAt >= STARTED_TTL_MS) {
      if (!started.current) {
        started.current = true;
        void start();
      }
      return;
    }
    // A request started earlier in this tab (before a reload, or from another tab of
    // this page) is running or has just finished: wait for its draft. Start over only
    // when that request failed (it cleared the marker) or never landed (marker expired).
    const timer = setInterval(() => {
      const at = readStartedAt(storageKey);
      if (at == null || Date.now() - at >= STARTED_TTL_MS) {
        clearInterval(timer);
        void start();
      } else {
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router, start, storageKey]);

  if (silent) return null;

  if (error) {
    return (
      <Card>
        <Eyebrow>Draft</Eyebrow>
        <div role="alert" className="mt-2 flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden="true" />
          <div>
            <h2 className="text-base font-bold text-ink">We couldn&apos;t write your page</h2>
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
      <Eyebrow>Draft</Eyebrow>
      <div className="mt-2 flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-faint text-brand-strong">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink">Writing your page…</h2>
          <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
            About a minute. The page updates by itself, so you can leave it open.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function readStartedAt(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(key);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStartedAt(key: string, at: number): void {
  try {
    sessionStorage.setItem(key, String(at));
  } catch {
    // Storage blocked (private mode, quota): the ref guard still stops a second request in this mount.
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
    // Not JSON (e.g. a gateway timeout page).
  }
  return "Something went wrong writing your page. Please try again.";
}
