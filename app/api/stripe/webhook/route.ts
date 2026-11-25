import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/webhook: Stripe's events about checkouts, subscriptions and
 * invoices. The signature is checked against STRIPE_WEBHOOK_SECRET before
 * anything is read. A 500 makes Stripe retry later; every handler is safe to
 * run twice.
 */
export async function POST(request: Request) {
  const secret = serverEnv.stripeWebhookSecret;
  if (!secret || !serverEnv.stripeSecretKey) {
    return NextResponse.json({ error: "Payments are not set up." }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  // The signature covers the raw body, so read it as text before any parsing.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  try {
    const note = await handleStripeEvent(event);
    return NextResponse.json({ received: true, note });
  } catch (err) {
    console.error("stripe webhook failed", event.type, event.id, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}
