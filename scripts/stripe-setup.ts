/**
 * Sets up the Stripe account from a terminal (see lib/stripe-setup.ts):
 *
 *   STRIPE_SECRET_KEY=sk_... npx tsx scripts/stripe-setup.ts [https://legiitoverviews.com] [--recreate-webhook]
 *
 * --recreate-webhook deletes the app's webhook endpoint and creates it again,
 * to get a signing secret that was never saved (the old one stops working).
 * Prints the webhook signing secret the first time the endpoint is created:
 * set it as STRIPE_WEBHOOK_SECRET in Vercel. Stripe never shows it again
 * (roll it in the Dashboard if it is lost). On the deployed app,
 * POST /api/stripe/setup does the same with the key already in Vercel.
 */
import Stripe from "stripe";
import { setupStripe } from "../lib/stripe-setup";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Set STRIPE_SECRET_KEY first.");
  const args = process.argv.slice(2);
  const appUrl = args.find((a) => !a.startsWith("--")) ?? "https://legiitoverviews.com";
  const result = await setupStripe(new Stripe(key, { maxNetworkRetries: 2 }), appUrl, {
    recreateWebhook: args.includes("--recreate-webhook"),
  });
  for (const line of result.log) console.log(line);
  if (result.webhook.secret) console.log(`STRIPE_WEBHOOK_SECRET=${result.webhook.secret}`);
  console.log(result.livemode ? "Done (live mode)." : "Done (test mode).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
