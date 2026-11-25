import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { paymentsEnabled } from "@/lib/stripe";
import { fulfillCheckout } from "@/lib/stripe-sync";

export const dynamic = "force-dynamic";

/**
 * GET /app/billing/confirm?session_id=... : where Stripe sends a buyer after
 * paying. Confirms the payment with Stripe, gives the plan's credits right
 * away, and goes straight to adding a keyword. If that can't be confirmed yet,
 * the billing page waits for Stripe's webhook and then moves on by itself.
 */
export async function GET(request: NextRequest) {
  const waitOnBilling = new URL("/app/billing?checkout=success", request.url);
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/app/billing", request.url));

  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !paymentsEnabled()) return NextResponse.redirect(waitOnBilling);

  try {
    if (await fulfillCheckout(sessionId, user.id)) {
      return NextResponse.redirect(new URL("/app/new?welcome=1", request.url));
    }
  } catch (err) {
    console.error("checkout confirm failed", err instanceof Error ? err.message : err);
  }
  return NextResponse.redirect(waitOnBilling);
}
