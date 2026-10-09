"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LoaderCircle, Pause, Play, RefreshCw, Trash } from "lucide-react";
import {
  deleteTracker,
  pauseTracker,
  resumeTracker,
  retryFirstCapture,
  setKeepTracking,
  type TrackerActionResult,
} from "@/app/app/[id]/actions";
import { Button } from "@/components/ui/button";
import type { Tracker } from "@/lib/types";
import { cn } from "@/lib/utils";

type Action = "pause" | "resume" | "keep" | "retry" | "delete";

const DELETE_PROMPT =
  "Delete this keyword and everything we captured for it? This can't be undone.";

/** Pause / resume, keep-tracking, retry and delete controls for one keyword. */
export function TrackerControls({ tracker }: { tracker: Pick<Tracker, "id" | "status" | "keep_tracking"> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: Action, work: () => Promise<TrackerActionResult>) {
    if (pending) return;
    setBusy(action);
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) setError(result.error);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setBusy(null);
      }
    });
  }

  const canPause = tracker.status === "tracking" || tracker.status === "ready" || tracker.status === "analyzed";
  const showKeep = tracker.status === "analyzed" || tracker.status === "ready";

  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {tracker.status === "error" ? (
          <Button size="xs" disabled={pending} onClick={() => run("retry", () => retryFirstCapture(tracker.id))}>
            <Spinner active={busy === "retry"} fallback={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} />
            Retry today&apos;s capture
          </Button>
        ) : null}

        {canPause ? (
          <Button
            size="xs"
            variant="secondary"
            disabled={pending}
            onClick={() => run("pause", () => pauseTracker(tracker.id))}
          >
            <Spinner active={busy === "pause"} fallback={<Pause className="h-3.5 w-3.5" aria-hidden="true" />} />
            Pause
          </Button>
        ) : null}

        {tracker.status === "paused" ? (
          <Button size="xs" disabled={pending} onClick={() => run("resume", () => resumeTracker(tracker.id))}>
            <Spinner active={busy === "resume"} fallback={<Play className="h-3.5 w-3.5" aria-hidden="true" />} />
            Resume
          </Button>
        ) : null}

        {showKeep ? (
          <button
            type="button"
            role="switch"
            aria-checked={tracker.keep_tracking}
            disabled={pending}
            onClick={() => run("keep", () => setKeepTracking(tracker.id, !tracker.keep_tracking))}
            className={cn(
              "inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-xs font-semibold ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              tracker.keep_tracking
                ? "bg-brand-faint text-brand-strong ring-brand-soft"
                : "bg-white text-ink ring-line hover:bg-surface-alt",
            )}
          >
            Keep tracking after publish
            <span
              className={cn(
                "inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-[11px]",
                tracker.keep_tracking ? "bg-brand text-white" : "bg-surface-sunken text-ink-muted",
              )}
            >
              {busy === "keep" ? (
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : tracker.keep_tracking ? (
                "On"
              ) : (
                "Off"
              )}
            </span>
          </button>
        ) : null}

        <Button
          size="xs"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(DELETE_PROMPT)) return;
            run("delete", async () => {
              const result = await deleteTracker(tracker.id);
              if (result.ok) router.push("/app");
              return result;
            });
          }}
        >
          <Spinner active={busy === "delete"} fallback={<Trash className="h-3.5 w-3.5" aria-hidden="true" />} />
          Delete
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Spinner({ active, fallback }: { active: boolean; fallback: React.ReactNode }) {
  return active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <>{fallback}</>;
}
