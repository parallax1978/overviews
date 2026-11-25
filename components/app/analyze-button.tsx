"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { ApiErrorText, readApiError, type ApiError } from "@/components/app/api-error";
import { Button } from "@/components/ui/button";
import { creditsLabel } from "@/lib/plans";

/** How long after the request starts we refresh the page so the "writing your report" state shows. */
const EARLY_REFRESH_MS = 1500;

export interface AnalyzeButtonProps {
  trackerId: string;
  disabled?: boolean;
  /** Shown under the button when it is disabled. */
  reason?: string | null;
  label?: string;
  /** Credits this report uses; shown on the button when above zero. */
  cost?: number;
}

/** Starts the report for a keyword (POST /api/trackers/[id]/analyze) and keeps the page in sync while it runs. */
export function AnalyzeButton({
  trackerId,
  disabled = false,
  reason = null,
  label = "Analyze now",
  cost = 0,
}: AnalyzeButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);

    // The request can take minutes. Refresh once soon after it starts so the
    // page picks up the "analyzing" status and begins polling on its own.
    const earlyRefresh = setTimeout(() => router.refresh(), EARLY_REFRESH_MS);

    try {
      const response = await fetch(`/api/trackers/${trackerId}/analyze`, { method: "POST" });
      if (!response.ok) {
        clearTimeout(earlyRefresh);
        setError(await readApiError(response, "Something went wrong starting your report. Please try again."));
        return;
      }
      router.refresh();
    } catch {
      clearTimeout(earlyRefresh);
      setError({
        message: "We lost the connection. Refresh the page to see whether the report is still being built.",
        upgrade: false,
        settings: false,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button onClick={start} disabled={disabled || pending} aria-busy={pending}>
        {pending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        )}
        {pending ? "Starting…" : cost > 0 ? `${label} · ${creditsLabel(cost)}` : label}
      </Button>
      {disabled && reason ? <p className="mt-2 text-sm text-ink-muted">{reason}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          <ApiErrorText error={error} />
        </p>
      ) : null}
    </div>
  );
}
