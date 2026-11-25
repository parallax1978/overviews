import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { logApiCall } from "@/lib/api-log";
import { publicEnv, serverEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { setupStripe } from "@/lib/stripe-setup";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/stripe/setup (operators only: Authorization: Bearer CRON_SECRET).
 * Runs lib/stripe-setup.ts with the STRIPE_SECRET_KEY set in Vercel, so
 * switching payments on needs only that key: the answer carries the new
 * webhook's signing secret, to be set as STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!serverEnv.stripeSecretKey) {
    return NextResponse.json({ error: "Set STRIPE_SECRET_KEY in Vercel first." }, { status: 409 });
  }
  const startedAt = Date.now();
  try {
    // ?recreateWebhook=1 replaces an endpoint whose signing secret was never saved.
    const recreateWebhook = new URL(request.url).searchParams.get("recreateWebhook") === "1";
    const result = await setupStripe(getStripe(), publicEnv.appUrl, { recreateWebhook });
    await logApiCall(createAdminClient(), {
      provider: "stripe",
      endpoint: "setup",
      status: 200,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("stripe setup failed", message);
    await logApiCall(createAdminClient(), {
      provider: "stripe",
      endpoint: "setup",
      status: null,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: message.slice(0, 200),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
