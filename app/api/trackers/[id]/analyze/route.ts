import { NextResponse } from "next/server";
import { runAnalysisAndDraft } from "@/lib/analyze";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tracker } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** POST /api/trackers/[id]/analyze: build the report and the first draft for a keyword the caller owns. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "We couldn't find that keyword." }, { status: 404 });
  const tracker = row as Tracker;

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
  if (tracker.day_count < 2 && tracker.status !== "ready") {
    return NextResponse.json({ error: "Capture at least two days first" }, { status: 422 });
  }

  try {
    const { analysis, draft } = await runAnalysisAndDraft(id);
    return NextResponse.json({ analysisId: analysis.id, draftId: draft.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong building your report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
