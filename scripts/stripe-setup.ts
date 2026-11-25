/**
 * Creates (or brings up to date) everything the app needs in a Stripe account:
 * the product, one monthly price per plan in lib/plans.ts (found by lookup
 * key), the webhook endpoint and the customer-portal settings. Safe to run
 * again after a price change: a new price takes over the plan's lookup key.
 *
 *   STRIPE_SECRET_KEY=sk_... npx tsx scripts/stripe-setup.ts [https://legiitoverviews.com]
 *
 * Prints the webhook signing secret the first time the endpoint is created:
 * set it as STRIPE_WEBHOOK_SECRET in Vercel. Stripe never shows it again
 * (roll it in the Dashboard if it is lost).
 */
import Stripe from "stripe";
import { PAID_PLANS } from "../lib/plans";

const APP_TAG = "legiit-overviews";
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Set STRIPE_SECRET_KEY first.");
  const appUrl = (process.argv[2] ?? "https://legiitoverviews.com").replace(/\/+$/, "");
  const stripe = new Stripe(key, { maxNetworkRetries: 2 });

  // 1. The product.
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((p) => p.metadata?.app === APP_TAG);
  if (!product) {
    product = await stripe.products.create({
      name: "Legiit Overviews",
      description: "Track a search's Google AI Overview for 7 days and get a page built to beat every cited source.",
      metadata: { app: APP_TAG },
    });
    console.log(`Created product ${product.id}`);
  } else {
    console.log(`Product ${product.id} already exists`);
  }

  // 2. One monthly price per plan, by lookup key.
  const existing = await stripe.prices.list({ lookup_keys: PAID_PLANS.map((p) => p.stripeLookupKey), limit: 10 });
  const priceIds: string[] = [];
  for (const plan of PAID_PLANS) {
    const cents = plan.priceUsd * 100;
    const current = existing.data.find((p) => p.lookup_key === plan.stripeLookupKey);
    const upToDate =
      current &&
      current.active &&
      current.unit_amount === cents &&
      current.currency === "usd" &&
      current.recurring?.interval === "month" &&
      (typeof current.product === "string" ? current.product : current.product.id) === product.id;
    if (current && upToDate) {
      console.log(`Price for ${plan.name} ($${plan.priceUsd}/month) already exists: ${current.id}`);
      priceIds.push(current.id);
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
    console.log(`Created price for ${plan.name} ($${plan.priceUsd}/month): ${price.id}`);
    priceIds.push(price.id);
  }

  // 3. The webhook endpoint.
  const webhookUrl = `${appUrl}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((e) => e.url === webhookUrl);
  if (endpoint) {
    await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: WEBHOOK_EVENTS, disabled: false });
    console.log(`Webhook ${endpoint.id} already exists; events updated. Its signing secret is unchanged.`);
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
      description: "Legiit Overviews billing",
      metadata: { app: APP_TAG },
    });
    console.log(`Created webhook ${created.id} for ${webhookUrl}`);
    console.log(`STRIPE_WEBHOOK_SECRET=${created.secret}`);
  }

  // 4. The customer portal: switch plans (charged right away, prorated), update the card, cancel at period end.
  const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "always_invoice",
      products: [{ product: product.id, prices: priceIds }],
    },
  };
  const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
  const config = configs.data.find((c) => c.metadata?.app === APP_TAG);
  const business_profile = { headline: "Manage your Legiit Overviews plan" };
  if (config) {
    await stripe.billingPortal.configurations.update(config.id, { features: portalFeatures, business_profile });
    console.log(`Customer portal settings ${config.id} updated`);
  } else {
    const created = await stripe.billingPortal.configurations.create({
      features: portalFeatures,
      business_profile,
      default_return_url: `${appUrl}/app/billing`,
      metadata: { app: APP_TAG },
    });
    console.log(`Created customer portal settings ${created.id}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
