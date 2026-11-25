/**
 * Stripe client and the small helpers the billing pages and the webhook share.
 * Payments stay off until both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are
 * set; lib/stripe-setup.ts (POST /api/stripe/setup, or scripts/stripe-setup.ts)
 * creates the product, the three monthly prices (found here by their lookup
 * keys), the webhook endpoint and the customer portal settings. Server only.
 */
import Stripe from "stripe";
import { logApiCall } from "@/lib/api-log";
import { serverEnv } from "@/lib/env";
import { PAID_PLANS, planByLookupKey, type PaidPlan } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";

/** Marks the Stripe objects this app owns (product, portal configuration). */
export const STRIPE_APP_TAG = "legiit-overviews";

let client: Stripe | null = null;

/** True once both Stripe secrets are set: the pricing page then shows working buttons. */
export function paymentsEnabled(): boolean {
  return Boolean(serverEnv.stripeSecretKey && serverEnv.stripeWebhookSecret);
}

export function getStripe(): Stripe {
  const key = serverEnv.stripeSecretKey;
  if (!key) throw new Error("Payments are not set up yet");
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2 });
  return client;
}

function errorStatus(err: unknown): number | null {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}

/** Runs one Stripe API call and writes its api_log row (Stripe calls cost nothing per call). */
export async function stripeCall<T>(
  endpoint: string,
  userId: string | null,
  call: (stripe: Stripe) => Promise<T>,
): Promise<T> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  try {
    const result = await call(getStripe());
    await logApiCall(admin, {
      provider: "stripe",
      endpoint,
      status: 200,
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      user_id: userId,
    });
    return result;
  } catch (err) {
    await logApiCall(admin, {
      provider: "stripe",
      endpoint,
      status: errorStatus(err),
      cost_usd: 0,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      user_id: userId,
    });
    throw err;
  }
}

const PRICE_CACHE_MS = 10 * 60 * 1000;
let priceCache: { at: number; ids: Map<string, string> } | null = null;

/** The active Stripe price id for a plan, found by its lookup key. */
export async function priceIdFor(plan: PaidPlan): Promise<string> {
  if (!priceCache || Date.now() - priceCache.at > PRICE_CACHE_MS) {
    const prices = await stripeCall("prices.list", null, (stripe) =>
      stripe.prices.list({ lookup_keys: PAID_PLANS.map((p) => p.stripeLookupKey), active: true, limit: 10 }),
    );
    priceCache = {
      at: Date.now(),
      ids: new Map(prices.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key as string, p.id])),
    };
  }
  const id = priceCache.ids.get(plan.stripeLookupKey);
  if (!id) throw new Error(`No active Stripe price has the lookup key ${plan.stripeLookupKey}. Run scripts/stripe-setup.ts.`);
  return id;
}

let portalConfigCache: { at: number; id: string | null } | null = null;

/** The customer portal settings scripts/stripe-setup.ts made (plan switching, cancel at period end), if any. */
export async function portalConfigurationId(): Promise<string | null> {
  if (!portalConfigCache || Date.now() - portalConfigCache.at > PRICE_CACHE_MS) {
    const configs = await stripeCall("billing_portal.configurations.list", null, (stripe) =>
      stripe.billingPortal.configurations.list({ active: true, limit: 20 }),
    );
    const ours = configs.data.find((c) => c.metadata?.app === STRIPE_APP_TAG);
    portalConfigCache = { at: Date.now(), id: ours?.id ?? null };
  }
  return portalConfigCache.id;
}

/** The plan a subscription is on, from the lookup key of its price. */
export function planOfSubscription(subscription: Stripe.Subscription): PaidPlan | null {
  for (const item of subscription.items.data) {
    const plan = planByLookupKey(item.price.lookup_key);
    if (plan) return plan;
  }
  return null;
}

/** The current billing period (it lives on the subscription items since Stripe's 2025-03-31 API). */
export function subscriptionPeriod(subscription: Stripe.Subscription): { start: string | null; end: string | null } {
  const items = subscription.items.data;
  if (items.length === 0) return { start: null, end: null };
  const start = Math.min(...items.map((i) => i.current_period_start));
  const end = Math.min(...items.map((i) => i.current_period_end));
  return {
    start: Number.isFinite(start) ? new Date(start * 1000).toISOString() : null,
    end: Number.isFinite(end) ? new Date(end * 1000).toISOString() : null,
  };
}

/** A customer reference as an id. */
export function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}
