import { NextResponse } from "next/server";
import { z } from "zod";
import { DraftInProgressError, recoverStaleAnalysis, regenerateDraft } from "@/lib/analyze";
import { getUser } from "@/lib/auth";
import { BillingError, chargeForDraft, type Charge } from "@/lib/billing";
import { OwnKeysMissingError } from "@/lib/own-keys";
import { createClient } from "@/lib/supabase/server";
import type { Tracker } from "@/lib/types";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const NOTES_MAX = 2000;

const BodySchema = z.object({
  notes: z.string().max(NOTES_MAX).optional(),
  /** "researched" (default): figures found on the web and cited. "placeholders": the author fills them in. */
  mode: z.enum(["researched", "placeholders"]).optional(),
});

async function readBody(request: Request): Promise<z.infer<typeof BodySchema> | null> {
  const raw = await request.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const result = BodySchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * POST /api/trackers/[id]/draft: write a new draft of one mode (body `mode`,
 * default "researched"), optionally revised with the caller's `notes`.
 * Responds { draftId, mode }, or 409 while a draft is already being written.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const supabase = await createClient();
  const { data: row, error } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "We couldn't find that keyword." }, { status: 404 });
  let tracker = row as Tracker;

  // A report that finished but whose page was never written (the function was
  // stopped) is still marked "analyzing": recover it so the draft can be written.
  if (tracker.status === "analyzing") {
    try {
      const { recovered } = await recoverStaleAnalysis(id);
      if (recovered) {
        const { data: fresh } = await supabase.from("trackers").select("*").eq("id", id).maybeSingle();
        if (fresh) tracker = fresh as Tracker;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't check on the last report.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (tracker.status === "analyzing") {
    return NextResponse.json({ error: "Your report is still being built. Give it a minute." }, { status: 409 });
  }

  // Any other status may write a page from its finished report: a paused keyword keeps its report.
  // The newest one: that is the report regenerateDraft writes from.
  const { data: report, error: reportError } = await supabase
    .from("analyses")
    .select("id")
    .eq("tracker_id", id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 });
  if (!report) {
    return NextResponse.json({ error: "Build the report first, then you can write a new draft." }, { status: 422 });
  }

  const body = await readBody(request);
  if (!body) {
    return NextResponse.json(
      {
        error: `We couldn't read that request. Notes must be plain text, up to ${NOTES_MAX.toLocaleString("en-US")} characters.`,
      },
      { status: 422 },
    );
  }

  const mode = body.mode ?? "researched";

  // Each report's first ready-to-publish page is included; rewrites and the
  // with-my-own-data version cost credits on the app's keys. Own keys are never charged.
  let charge: Charge;
  try {
    charge = await chargeForDraft(tracker, mode, (report as { id: string }).id);
  } catch (err) {
    if (err instanceof BillingError) {
      return NextResponse.json({ error: err.message, upgrade: err.upgrade }, { status: err.status });
    }
    return NextResponse.json({ error: "We couldn't check your credits. Please try again." }, { status: 500 });
  }

  try {
    const draft = await regenerateDraft(id, body.notes ?? null, mode);
    return NextResponse.json({ draftId: draft.id, mode: draft.mode });
  } catch (err) {
    await charge.refund("The page didn't finish").catch((refundErr) => {
      console.error("draft refund failed", id, refundErr instanceof Error ? refundErr.message : refundErr);
    });
    // Another request (the daily job, or another tab) is writing this page; the keyword page shows its progress.
    if (err instanceof DraftInProgressError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof OwnKeysMissingError) {
      return NextResponse.json({ error: err.message, settings: true }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Something went wrong writing your draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
