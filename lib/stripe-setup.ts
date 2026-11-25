/**
 * Creates (or brings up to date) everything the app needs in a Stripe account:
 * the product, one monthly price per plan in lib/plans.ts (found by lookup
 * key), the webhook endpoint and the customer-portal settings. Safe to run
 * again: after a price change in lib/plans.ts a new price takes over the
 * plan's lookup key and the old one is archived.
 *
 * Used by scripts/stripe-setup.ts (from a terminal) and by
 * POST /api/stripe/setup (on the server, where STRIPE_SECRET_KEY lives).
 */
import type Stripe from "stripe";
import { PAID_PLANS } from "@/lib/plans";

/** Marks the Stripe objects this app owns. Keep in sync with STRIPE_APP_TAG in lib/stripe.ts. */
const APP_TAG = "legiit-overviews";

const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
];

export interface StripeSetupResult {
  livemode: boolean;
  productId: string;
  prices: { plan: string; id: string; created: boolean }[];
  webhook: { id: string; url: string; created: boolean; secret: string | null };
  portalConfigurationId: string;
  log: string[];
}

export async function setupStripe(stripe: Stripe, appUrl: string): Promise<StripeSetupResult> {
  const log: string[] = [];
  const baseUrl = appUrl.replace(/\/+$/, "");

  // 1. The product.
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((p) => p.metadata?.app === APP_TAG);
  if (!product) {
    product = await stripe.products.create({
      name: "Legiit Overviews",
      description: "Track a search's Google AI Overview for 7 days and get a page built to beat every cited source.",
      metadata: { app: APP_TAG },
    });
    log.push(`Created product ${product.id}`);
  } else {
    log.push(`Product ${product.id} already exists`);
  }

  // 2. One monthly price per plan, by lookup key.
  const existing = await stripe.prices.list({ lookup_keys: PAID_PLANS.map((p) => p.stripeLookupKey), limit: 10 });
  const prices: StripeSetupResult["prices"] = [];
  for (const plan of PAID_PLANS) {
    const cents = plan.priceUsd * 100;
    const current = existing.data.find((p) => p.lookup_key === plan.stripeLookupKey);
    const productId = current ? (typeof current.product === "string" ? current.product : current.product.id) : null;
    const upToDate =
      current &&
      current.active &&
      current.unit_amount === cents &&
      current.currency === "usd" &&
      current.recurring?.interval === "month" &&
      productId === product.id;
    if (current && upToDate) {
      prices.push({ plan: plan.id, id: current.id, created: false });
      log.push(`Price for ${plan.name} ($${plan.priceUsd}/month) already exists: ${current.id}`);
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: cents,
      recurring: { interval: "month" },
      lookup_key: plan.stripeLookupKey,
      transfer_lookup_key: true,
      nickname: `${plan.name} monthly`,
      metadata: { app: APP_TAG, plan: plan.id, monthly_credits: String(plan.monthlyCredits) },
    });
    if (current) await stripe.prices.update(current.id, { active: false });
    prices.push({ plan: plan.id, id: price.id, created: true });
    log.push(`Created price for ${plan.name} ($${plan.priceUsd}/month): ${price.id}`);
  }

  // 3. The webhook endpoint. Stripe shows its signing secret only when it is created.
  const webhookUrl = `${baseUrl}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((e) => e.url === webhookUrl);
  let webhook: StripeSetupResult["webhook"];
  if (endpoint) {
    await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: WEBHOOK_EVENTS, disabled: false });
    webhook = { id: endpoint.id, url: webhookUrl, created: false, secret: null };
    log.push(`Webhook ${endpoint.id} already exists; events updated. Its signing secret is unchanged.`);
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
      description: "Legiit Overviews billing",
      metadata: { app: APP_TAG },
    });
    webhook = { id: created.id, url: webhookUrl, created: true, secret: created.secret ?? null };
    log.push(`Created webhook ${created.id} for ${webhookUrl}`);
  }

  // 4. The customer portal: switch plans (charged right away, prorated), update the card, cancel at period end.
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "always_invoice",
      products: [{ product: product.id, prices: prices.map((p) => p.id) }],
    },
  };
  const businessProfile = { headline: "Manage your Legiit Overviews plan" };
  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
  const config = configs.data.find((c) => c.metadata?.app === APP_TAG);
  let portalConfigurationId: string;
  if (config) {
    await stripe.billingPortal.configurations.update(config.id, { features, business_profile: businessProfile });
    portalConfigurationId = config.id;
    log.push(`Customer portal settings ${config.id} updated`);
  } else {
    const created = await stripe.billingPortal.configurations.create({
      features,
      business_profile: businessProfile,
      default_return_url: `${baseUrl}/app/billing`,
      metadata: { app: APP_TAG },
    });
    portalConfigurationId = created.id;
    log.push(`Created customer portal settings ${created.id}`);
  }

  return { livemode: product.livemode, productId: product.id, prices, webhook, portalConfigurationId, log };
}
