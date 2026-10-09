import { NextResponse } from "next/server";
import { AnalysisInProgressError, recoverStaleAnalysis, runAnalysis } from "@/lib/analyze";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tracker } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/trackers/[id]/analyze: build the report for a keyword the caller owns.
 * The page is written by a separate request (POST .../draft), which the keyword
 * page starts by itself once the report exists.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "We couldn't load that keyword." }, { status: 500 });
  if (!row) return NextResponse.json({ error: "We couldn't find that keyword." }, { status: 404 });
  let tracker = row as Tracker;

  // A report the platform stopped mid-way would block "Try again" forever: clear it first.
  if (tracker.status === "analyzing") {
    try {
      const { recovered } = await recoverStaleAnalysis(id);
      if (recovered) {
        const { data: fresh } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
        if (fresh) tracker = fresh as Tracker;
      }
    } catch {
      return NextResponse.json({ error: "We couldn't check on the last report." }, { status: 500 });
    }
  }

  if (tracker.status === "analyzing") {
    return NextResponse.json({ error: "Your report is already being built. Give it a minute." }, { status: 409 });
  }

  const { data: snapshots } = await supabase
    .from("snapshots")
    .select("has_overview")
    .eq("tracker_id", id)
    .eq("has_overview", true)
    .limit(1);
  if (!snapshots?.length) {
    return NextResponse.json(
      { error: "No AI Overview has appeared for this search yet. Check back after the next capture." },
      { status: 422 },
    );
  }

  // One day with an AI Overview is enough for a first report; the report says how many
  // days it is based on, and day 7 triggers a fresh one automatically.
  try {
    const analysis = await runAnalysis(id);
    return NextResponse.json({ analysisId: analysis.id });
  } catch (err) {
    if (err instanceof AnalysisInProgressError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong building your report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
