/**
 * Daily capture, called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Also runnable by hand with
 * `node scripts/capture-now.mjs`.
 */
import { timingSafeEqual } from "node:crypto";
import { runDueCaptures } from "@/lib/capture";
import { serverEnv } from "@/lib/env";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(request: Request): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Captures every due tracker and returns a JSON summary of what happened. */
export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startedAt = Date.now();
    const summary = await runDueCaptures();
    const skipped = summary.failed.filter((f) => f.error.startsWith("skipped:")).length;

    return Response.json({
      ok: true,
      ranAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      counts: {
        captured: summary.captured.length,
        failed: summary.failed.length - skipped,
        skipped,
        analyzed: summary.analyzed.length,
        analysisFailed: summary.analysisFailed.length,
      },
      ...summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Capture run failed";
    console.error("cron capture failed", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
