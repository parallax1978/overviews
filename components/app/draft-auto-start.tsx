"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { markFailed, markStarted, readMarker, type MarkerStorage } from "@/components/app/draft-marker";

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
 * Shown in the ready-to-publish pane of the Draft tab when the report is done
 * but that page was never written (the function that writes both was stopped
 * in between, or the report predates the researched version). Starts that
 * version once on mount, then refreshes the page so the draft shows up.
 * A sessionStorage marker, keyed by the report, keeps a reload, or the other
 * tabs of the keyword page, from starting a second draft while the first one
 * is still running, and from paying for another attempt after one failed:
 * a failed marker only shows the error, and Try again starts over. The marker
 * stays after a success (it expires on its own).
 */
export function DraftAutoStart({ trackerId, analysisId, silent = false }: DraftAutoStartProps) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `draft-auto-${trackerId}-${analysisId}`;

  const start = useCallback(async () => {
    markStarted(tabStorage(), storageKey, Date.now());
    try {
      const response = await fetch(`/api/trackers/${trackerId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "researched" }),
      });
      if (response.status === 409) {
        // Another request (the cron, another tab) is already writing this draft: keep the
        // marker and let the refreshed page show the server's "writing" state.
        router.refresh();
        return;
      }
      if (!response.ok) {
        // Remember the failure: every later mount in this tab shows it instead of paying again.
        const message = await readError(response);
        markFailed(tabStorage(), storageKey, message);
        setError(message);
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

  /** Picks up where this tab left off: shows an earlier failure, waits for a running request, or starts one. */
  const resume = useCallback(async () => {
    const marker = readMarker(tabStorage(), storageKey, Date.now());
    if (marker.state === "failed") {
      setError(marker.error);
      return;
    }
    if (marker.state === "none") {
      await start();
    }
  }, [start, storageKey]);

  useEffect(() => {
    const marker = readMarker(tabStorage(), storageKey, Date.now());
    if (marker.state !== "running") {
      if (!started.current) {
        started.current = true;
        void resume();
      }
      return;
    }
    // A request started earlier in this tab (before a reload, or from another tab of
    // this page) is running or has just finished: wait for its draft. Stop when that
    // request failed (it marked the failure); start over only when it never landed
    // (the marker expired).
    const timer = setInterval(() => {
      const current = readMarker(tabStorage(), storageKey, Date.now());
      if (current.state === "running") {
        router.refresh();
        return;
      }
      clearInterval(timer);
      void resume();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [resume, router, storageKey]);

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
              // Starting over replaces the failed marker with a fresh one.
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

  return <DraftPendingCard />;
}

/** The "writing your page" card, also shown when the server reports a draft in progress elsewhere. */
export function DraftPendingCard() {
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
            Researching real numbers and sources. Three to six minutes. The page updates by itself, so you can
            leave it open.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** This browser tab's storage, or null where it is blocked (private mode, a sandboxed frame). */
function tabStorage(): MarkerStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
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
