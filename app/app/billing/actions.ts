"use server";

import { redirect } from "next/navigation";
import { getUser, requireUser } from "@/lib/auth";
import { getAccount } from "@/lib/billing";
import { publicEnv } from "@/lib/env";
import { isPlanActive, paidPlan } from "@/lib/plans";
import { paymentsEnabled, portalConfigurationId, priceIdFor, stripeCall } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Starts Stripe Checkout for the plan in the form's `plan` field. Signed-out
 * visitors go to sign-in first and come back to the pricing page. Someone who
 * already has a plan changes it in Stripe's customer portal instead.
 */
export async function startCheckout(formData: FormData): Promise<void> {
  const planId = String(formData.get("plan") ?? "");
  const plan = paidPlan(planId);
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/pricing?plan=${planId}`)}`);
  if (!plan) redirect("/pricing");
  if (!paymentsEnabled()) redirect("/app/billing?payments=off");

  const admin = createAdminClient();
  const account = await getAccount(user.id, admin);
  if (account.plan === "staff") redirect("/app/billing");
  if (account.stripe_customer_id && isPlanActive(account)) redirect(await portalUrl(account.stripe_customer_id, user.id));

  let customerId = account.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeCall("customers.create", user.id, (stripe) =>
      stripe.customers.create({ ...(user.email ? { email: user.email } : {}), metadata: { user_id: user.id } }),
    );
    customerId = customer.id;
    const { error } = await admin
      .from("accounts")
      .upsert({ user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(`Could not link your billing account: ${error.message}`);
  }

  const price = await priceIdFor(plan);
  const session = await stripeCall("checkout.sessions.create", user.id, (stripe) =>
    stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      metadata: { user_id: user.id, plan: plan.id },
      subscription_data: { metadata: { user_id: user.id, plan: plan.id } },
      allow_promotion_codes: true,
      success_url: `${publicEnv.appUrl}/app/billing?checkout=success`,
      cancel_url: `${publicEnv.appUrl}/pricing?checkout=canceled`,
    }),
  );
  if (!session.url) throw new Error("Stripe did not return a checkout page");
  redirect(session.url);
}

/** Opens Stripe's customer portal: change plan, update the card, see invoices, cancel. */
export async function openBillingPortal(): Promise<void> {
  const user = await requireUser("/app/billing");
  if (!paymentsEnabled()) redirect("/app/billing?payments=off");
  const account = await getAccount(user.id);
  if (!account.stripe_customer_id) redirect("/pricing");
  redirect(await portalUrl(account.stripe_customer_id, user.id));
}

async function portalUrl(customerId: string, userId: string): Promise<string> {
  const configuration = await portalConfigurationId();
  const session = await stripeCall("billing_portal.sessions.create", userId, (stripe) =>
    stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${publicEnv.appUrl}/app/billing`,
      ...(configuration ? { configuration } : {}),
    }),
  );
  return session.url;
}
