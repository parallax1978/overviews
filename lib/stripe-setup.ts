/**
 * Creates (or brings up to date) everything the app needs in a Stripe account:
 * one product per plan in lib/plans.ts, each with one monthly price (found by
 * lookup key), the customer-portal settings and the webhook endpoint. Safe to
 * run again: after a price change in lib/plans.ts a new price takes over the
 * plan's lookup key and the old one is archived.
 *
 * The customer portal only lets customers switch between products whose
 * prices have different billing intervals, so every plan is its own product.
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
  products: { plan: string; id: string; created: boolean }[];
  prices: { plan: string; id: string; created: boolean }[];
  portalConfigurationId: string;
  webhook: { id: string; url: string; created: boolean; secret: string | null };
  log: string[];
}

export interface StripeSetupOptions {
  /**
   * Delete the app's webhook endpoint and create it again. Stripe shows an
   * endpoint's signing secret only when it is created, so this is how to get
   * a secret for an endpoint whose secret was never saved. The old secret
   * stops working: set the new one as STRIPE_WEBHOOK_SECRET right away.
   */
  recreateWebhook?: boolean;
}

function idOf(ref: string | { id: string }): string {
  return typeof ref === "string" ? ref : ref.id;
}

export async function setupStripe(
  stripe: Stripe,
  appUrl: string,
  options: StripeSetupOptions = {},
): Promise<StripeSetupResult> {
  const log: string[] = [];
  const baseUrl = appUrl.replace(/\/+$/, "");
  const ours = (await stripe.products.list({ active: true, limit: 100 })).data.filter(
    (p) => p.metadata?.app === APP_TAG,
  );

  // 1. One product per plan.
  const products: StripeSetupResult["products"] = [];
  const productIds = new Map<string, string>();
  for (const plan of PAID_PLANS) {
    let product = ours.find((p) => p.metadata?.plan === plan.id);
    const created = !product;
    if (!product) {
      product = await stripe.products.create({
        name: `Legiit Overviews ${plan.name}`,
        description: `${plan.monthlyCredits} credits a month. Track a search's AI Overview for 7 days and get a page built to beat every cited source.`,
        metadata: { app: APP_TAG, plan: plan.id },
      });
      log.push(`Created product for ${plan.name}: ${product.id}`);
    } else {
      log.push(`Product for ${plan.name} already exists: ${product.id}`);
    }
    products.push({ plan: plan.id, id: product.id, created });
    productIds.set(plan.id, product.id);
  }

  // 2. One monthly price per plan, on its product, by lookup key.
  const existing = await stripe.prices.list({ lookup_keys: PAID_PLANS.map((p) => p.stripeLookupKey), limit: 10 });
  const prices: StripeSetupResult["prices"] = [];
  for (const plan of PAID_PLANS) {
    const cents = plan.priceUsd * 100;
    const productId = productIds.get(plan.id) as string;
    const current = existing.data.find((p) => p.lookup_key === plan.stripeLookupKey);
    const upToDate =
      current &&
      current.active &&
      current.unit_amount === cents &&
      current.currency === "usd" &&
      current.recurring?.interval === "month" &&
      idOf(current.product) === productId;
    if (current && upToDate) {
      prices.push({ plan: plan.id, id: current.id, created: false });
      log.push(`Price for ${plan.name} ($${plan.priceUsd}/month) already exists: ${current.id}`);
      continue;
    }
    const price = await stripe.prices.create({
      product: productId,
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

  // Archive the app's products that no longer stand for a plan (and their prices).
  for (const product of ours) {
    const plan = product.metadata?.plan;
    if (plan && productIds.get(plan) === product.id) continue;
    const stale = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    for (const price of stale.data) await stripe.prices.update(price.id, { active: false });
    await stripe.products.update(product.id, { active: false });
    log.push(`Archived old product ${product.id}`);
  }

  // 3. The customer portal: switch plans (charged right away, prorated), update the card, cancel at period end.
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "always_invoice",
      products: prices.map((p) => ({ product: productIds.get(p.plan) as string, prices: [p.id] })),
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

  // 4. The webhook endpoint, last: its signing secret is only shown when it is created.
  const webhookUrl = `${baseUrl}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  let endpoint = endpoints.data.find((e) => e.url === webhookUrl) ?? null;
  if (endpoint && options.recreateWebhook) {
    await stripe.webhookEndpoints.del(endpoint.id);
    log.push(`Deleted webhook ${endpoint.id} to create it again`);
    endpoint = null;
  }
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

  const livemode = prices.length > 0 ? (await stripe.prices.retrieve(prices[0].id)).livemode : false;
  return { livemode, products, prices, portalConfigurationId, webhook, log };
}
