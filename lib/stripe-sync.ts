/**
 * Applies verified Stripe webhook events to accounts and credits.
 *
 * - The plan and its status always come from a fresh copy of the subscription,
 *   so events that arrive late or out of order can't roll an account back.
 * - Credits follow money: they are granted on invoice.paid only. A renewal
 *   grants the plan's monthly credits (unused credits roll over, up to one
 *   month's worth); an upgrade mid-period tops up the difference.
 * - Every handler is safe to run twice: Stripe may deliver an event again.
 */
import type Stripe from "stripe";
import { addCredits, expireAllCredits, getAccount } from "@/lib/billing";
import { isPlanActive, paidPlan } from "@/lib/plans";
import { customerIdOf, planOfSubscription, stripeCall, subscriptionPeriod } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Subscription statuses after which the subscription can never bill again. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

/** The app user a Stripe customer belongs to: the linked account, else the id the checkout stored in metadata. */
async function userForCustomer(admin: Admin, customerId: string | null, metadataUserId: string | null): Promise<string | null> {
  if (customerId) {
    const { data, error } = await admin.from("accounts").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
    if (error) throw new Error(`Could not look up the customer: ${error.message}`);
    if (data) return (data as Pick<Account, "user_id">).user_id;
  }
  return metadataUserId || null;
}

async function retrieveSubscription(id: string, userId: string | null): Promise<Stripe.Subscription> {
  return stripeCall("subscriptions.retrieve", userId, (stripe) => stripe.subscriptions.retrieve(id));
}

/**
 * Copies a subscription's plan, status and period onto the account. The staff
 * plan is never changed. An old subscription can't overwrite the account once
 * it has moved to a newer one.
 */
export async function syncSubscription(subscription: Stripe.Subscription, admin: Admin = createAdminClient()): Promise<string | null> {
  const customerId = customerIdOf(subscription.customer);
  const userId = await userForCustomer(admin, customerId, subscription.metadata?.user_id ?? null);
  if (!userId) return null;

  const account = await getAccount(userId, admin);
  const otherSubscription = account.stripe_subscription_id && account.stripe_subscription_id !== subscription.id;
  if (otherSubscription && ENDED.has(subscription.status)) return userId;

  const plan = planOfSubscription(subscription);
  const { end } = subscriptionPeriod(subscription);
  const ended = ENDED.has(subscription.status);
  const values = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    plan: account.plan === "staff" ? "staff" : ended || !plan ? "free" : plan.id,
    current_period_end: end,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("accounts").upsert(values, { onConflict: "user_id" });
  if (error) throw new Error(`Could not save the plan: ${error.message}`);
  return userId;
}

/** A paid invoice: monthly credits for a new period, or the difference after an upgrade. */
export async function grantForInvoice(invoice: Stripe.Invoice, admin: Admin = createAdminClient()): Promise<string> {
  const ref = invoice.parent?.subscription_details?.subscription ?? null;
  const subscriptionId = typeof ref === "string" ? ref : (ref?.id ?? null);
  if (!subscriptionId) return "ignored: not a subscription invoice";

  const subscription = await retrieveSubscription(subscriptionId, null);
  const userId = await syncSubscription(subscription, admin);
  if (!userId) return "ignored: unknown customer";
  const plan = planOfSubscription(subscription);
  if (!plan) return "ignored: price is not one of our plans";

  const account = await getAccount(userId, admin);
  if (account.plan === "staff") return "ignored: staff account";

  const { start } = subscriptionPeriod(subscription);
  const samePeriod =
    Boolean(account.granted_period_start && start) &&
    Date.parse(account.granted_period_start as string) === Date.parse(start as string);
  const alreadyGranted = samePeriod ? (paidPlan(account.granted_plan)?.monthlyCredits ?? 0) : 0;
  const amount = plan.monthlyCredits - alreadyGranted;
  if (amount <= 0) return "no credits due";

  await addCredits({
    userId,
    amount,
    reason: alreadyGranted > 0 ? "upgrade_grant" : "plan_grant",
    externalId: `invoice:${invoice.id}`,
    note: alreadyGranted > 0 ? `Upgrade to ${plan.name}` : `${plan.name} plan, monthly credits`,
    // A new period trims what rolled over to one month's worth first; an upgrade only adds.
    cap: alreadyGranted > 0 ? null : plan.monthlyCredits,
    admin,
  });
  const { error } = await admin
    .from("accounts")
    .update({ granted_plan: plan.id, granted_period_start: start, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not record the grant: ${error.message}`);
  return `granted ${amount}`;
}

/** The subscription ended: back to the free plan, and the remaining credits expire. */
export async function endSubscription(subscription: Stripe.Subscription, admin: Admin = createAdminClient()): Promise<string> {
  const customerId = customerIdOf(subscription.customer);
  const userId = await userForCustomer(admin, customerId, subscription.metadata?.user_id ?? null);
  if (!userId) return "ignored: unknown customer";
  const account = await getAccount(userId, admin);
  if (account.stripe_subscription_id && account.stripe_subscription_id !== subscription.id) {
    return "ignored: not the current subscription";
  }
  if (account.plan === "staff") return "ignored: staff account";

  const { error } = await admin
    .from("accounts")
    .update({
      plan: "free",
      subscription_status: subscription.status,
      cancel_at_period_end: false,
      current_period_end: subscriptionPeriod(subscription).end,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not end the plan: ${error.message}`);
  await expireAllCredits(userId, "Plan ended", admin);
  return "ended";
}

/**
 * Fulfils a checkout the moment the buyer comes back from Stripe, so their
 * credits are there before the webhook arrives (it lands a few seconds
 * later and changes nothing: grants are keyed by invoice). Only the signed-in
 * user who started the session can fulfil it. Returns true when the plan is
 * active, so the buyer can go straight to adding a keyword.
 */
export async function fulfillCheckout(sessionId: string, userId: string, admin: Admin = createAdminClient()): Promise<boolean> {
  const session = await stripeCall("checkout.sessions.retrieve", userId, (stripe) =>
    stripe.checkout.sessions.retrieve(sessionId),
  );
  if (session.client_reference_id !== userId) return false;
  if (session.mode !== "subscription" || session.status !== "complete") return false;

  const customerId = customerIdOf(session.customer);
  if (customerId) {
    const { error } = await admin
      .from("accounts")
      .upsert({ user_id: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(`Could not link the customer: ${error.message}`);
  }

  const ref = session.subscription;
  const subscriptionId = typeof ref === "string" ? ref : (ref?.id ?? null);
  if (!subscriptionId) return false;
  const subscription = await retrieveSubscription(subscriptionId, userId);
  await syncSubscription(subscription, admin);

  const invoiceRef = subscription.latest_invoice;
  const invoiceId = typeof invoiceRef === "string" ? invoiceRef : (invoiceRef?.id ?? null);
  if (invoiceId) {
    const invoice = await stripeCall("invoices.retrieve", userId, (stripe) => stripe.invoices.retrieve(invoiceId));
    if (invoice.status === "paid") await grantForInvoice(invoice, admin);
  }
  return isPlanActive(await getAccount(userId, admin));
}

/** Applies one verified event. Returns a short note for the logs. */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  const admin = createAdminClient();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return "ignored: not a subscription checkout";
      const userId = session.client_reference_id ?? session.metadata?.user_id ?? null;
      const customerId = customerIdOf(session.customer);
      if (!userId || !customerId) return "ignored: no user on the session";
      const { error } = await admin
        .from("accounts")
        .upsert({ user_id: userId, stripe_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw new Error(`Could not link the customer: ${error.message}`);
      const ref = session.subscription;
      const subscriptionId = typeof ref === "string" ? ref : (ref?.id ?? null);
      if (subscriptionId) await syncSubscription(await retrieveSubscription(subscriptionId, userId), admin);
      return "linked";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      // A fresh copy: the event's own copy may be older than one already applied.
      const fresh = await retrieveSubscription(event.data.object.id, null);
      if (ENDED.has(fresh.status)) return endSubscription(fresh, admin);
      await syncSubscription(fresh, admin);
      return "synced";
    }
    case "customer.subscription.deleted":
      return endSubscription(event.data.object, admin);
    case "invoice.paid":
      return grantForInvoice(event.data.object, admin);
    default:
      return `ignored: ${event.type}`;
  }
}
