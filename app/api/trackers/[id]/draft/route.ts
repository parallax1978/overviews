import { NextResponse } from "next/server";
import { z } from "zod";
import { recoverStaleAnalysis, regenerateDraft } from "@/lib/analyze";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Tracker } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NOTES_MAX = 2000;

const BodySchema = z.object({
  notes: z.string().max(NOTES_MAX).optional(),
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

/** POST /api/trackers/[id]/draft: write a new draft, optionally revised with the caller's notes. */
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

  if (tracker.status !== "analyzed") {
    return NextResponse.json({ error: "Build the report first, then you can write a new draft." }, { status: 422 });
  }

  const body = await readBody(request);
  if (!body) {
    return NextResponse.json(
      { error: `Notes must be plain text, up to ${NOTES_MAX.toLocaleString("en-US")} characters.` },
      { status: 422 },
    );
  }

  try {
    const draft = await regenerateDraft(id, body.notes ?? null);
    return NextResponse.json({ draftId: draft.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong writing your draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
