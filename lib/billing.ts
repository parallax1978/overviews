/**
 * Plans and credits on the server: read accounts, spend and refund credits
 * through the atomic SQL functions (service role only, see
 * supabase/migrations/0006_billing.sql), and the daily safety ceiling on the
 * app's own API spend. Callers must already know who the user is.
 */
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  creditsLabel,
  draftCreditCost,
  isPlanActive,
  paidPlan,
  reportCreditCost,
  type PlanId,
} from "@/lib/plans";
import type { Account, DraftMode, Tracker } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Ledger reasons. The billing page turns them into words. */
export type CreditReason =
  | "plan_grant"
  | "upgrade_grant"
  | "new_keyword"
  | "report_update"
  | "page_rewrite"
  | "own_data_page"
  | "refund"
  | "expired";

/** A billing rule stopped the action. `status` is the HTTP status a route should answer with. */
export class BillingError extends Error {
  status: number;
  /** The fix is on the billing page (pick a plan, get credits). */
  upgrade: boolean;

  constructor(message: string, status: number, upgrade: boolean) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.upgrade = upgrade;
  }
}

export function planRequiredError(): BillingError {
  return new BillingError(
    "Pick a plan to run this on our keys, or add your own API keys in Settings and run it free.",
    402,
    true,
  );
}

export function insufficientCreditsError(needed: number, balance: number): BillingError {
  return new BillingError(
    `This uses ${creditsLabel(needed)} and you have ${creditsLabel(balance)} left. Your credits refill when your plan renews, or you can move to a bigger plan.`,
    402,
    true,
  );
}

export function dailyLimitError(): BillingError {
  return new BillingError(
    "We've hit today's safety limit for new reports and pages. It resets at midnight UTC. Nothing was charged.",
    503,
    false,
  );
}

/** The account a user without a row has: the free plan, no credits. */
export function freeAccount(userId: string): Account {
  const now = new Date(0).toISOString();
  return {
    user_id: userId,
    plan: "free",
    subscription_status: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    credits_balance: 0,
    granted_plan: null,
    granted_period_start: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getAccount(userId: string, admin: Admin = createAdminClient()): Promise<Account> {
  const { data, error } = await admin.from("accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not load your plan: ${error.message}`);
  return (data as Account | null) ?? freeAccount(userId);
}

/** Accounts for several users at once (the daily capture). Users without a row get the free account. */
export async function getAccounts(userIds: string[], admin: Admin = createAdminClient()): Promise<Map<string, Account>> {
  const ids = [...new Set(userIds)];
  const accounts = new Map<string, Account>(ids.map((id) => [id, freeAccount(id)]));
  if (ids.length === 0) return accounts;
  const { data, error } = await admin.from("accounts").select("*").in("user_id", ids);
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  for (const row of (data ?? []) as Account[]) accounts.set(row.user_id, row);
  return accounts;
}

/** A credit charge that can be given back if the work fails. */
export interface Charge {
  credits: number;
  refund(note: string): Promise<void>;
}

const NO_CHARGE: Charge = { credits: 0, refund: async () => {} };

/**
 * Takes `amount` credits from an active plan for `reason`. The staff plan and
 * free actions (amount 0) cost nothing. Throws a BillingError when the plan is
 * not active or the balance is too low; nothing changes then.
 */
export async function chargeCredits(opts: {
  account: Account;
  amount: number;
  reason: CreditReason;
  trackerId?: string | null;
  note?: string | null;
  admin?: Admin;
}): Promise<Charge> {
  const { account, amount } = opts;
  if (amount <= 0 || account.plan === "staff") return NO_CHARGE;
  if (!isPlanActive(account)) throw planRequiredError();

  const admin = opts.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("spend_credits", {
    p_user: account.user_id,
    p_amount: amount,
    p_reason: opts.reason,
    p_tracker: opts.trackerId ?? null,
    p_note: opts.note ?? null,
  });
  if (error) throw new Error(`Could not use your credits: ${error.message}`);
  if (data === null || data === undefined) {
    const fresh = await getAccount(account.user_id, admin);
    throw insufficientCreditsError(amount, fresh.credits_balance);
  }

  let refunded = false;
  return {
    credits: amount,
    refund: async (note: string) => {
      if (refunded) return;
      refunded = true;
      await addCredits({ userId: account.user_id, amount, reason: "refund", trackerId: opts.trackerId, note, admin });
    },
  };
}

/** Adds credits (grants and refunds). With `externalId` a repeat call changes nothing. Returns the new balance. */
export async function addCredits(opts: {
  userId: string;
  amount: number;
  reason: CreditReason;
  externalId?: string | null;
  trackerId?: string | null;
  note?: string | null;
  /** Trim the balance to this first (the rollover limit), recording the rest as expired. */
  cap?: number | null;
  admin?: Admin;
}): Promise<number> {
  const admin = opts.admin ?? createAdminClient();
  const { data, error } = await admin.rpc("add_credits", {
    p_user: opts.userId,
    p_amount: opts.amount,
    p_reason: opts.reason,
    p_external_id: opts.externalId ?? null,
    p_tracker: opts.trackerId ?? null,
    p_note: opts.note ?? null,
    p_cap: opts.cap ?? null,
  });
  if (error) throw new Error(`Could not add credits: ${error.message}`);
  return Number(data ?? 0);
}

/** A plan's monthly credits for one paid invoice. Unused credits roll over, up to one month's worth. */
export async function grantPlanCredits(opts: {
  userId: string;
  plan: PlanId;
  externalId: string;
  admin?: Admin;
}): Promise<number | null> {
  const plan = paidPlan(opts.plan);
  if (!plan) return null;
  return addCredits({
    userId: opts.userId,
    amount: plan.monthlyCredits,
    reason: "plan_grant",
    externalId: opts.externalId,
    note: `${plan.name} plan, monthly credits`,
    cap: plan.monthlyCredits,
    admin: opts.admin,
  });
}

/** Removes every remaining credit (the subscription ended). */
export async function expireAllCredits(userId: string, note: string, admin: Admin = createAdminClient()): Promise<void> {
  const { error } = await admin.rpc("expire_credits", { p_user: userId, p_note: note });
  if (error) throw new Error(`Could not expire credits: ${error.message}`);
}

/**
 * Gives back what adding a keyword cost, once: when it is deleted before any
 * capture worked, or when no AI Overview appeared in its whole study. Only a
 * keyword that was charged (not staff, not own keys) gets anything back.
 * Returns true when credits were added.
 */
export async function refundKeywordCharge(opts: {
  userId: string;
  trackerId: string;
  amount: number;
  why: "deleted" | "no_overview";
  admin?: Admin;
}): Promise<boolean> {
  const admin = opts.admin ?? createAdminClient();
  const { data, error } = await admin
    .from("credit_ledger")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("tracker_id", opts.trackerId)
    .eq("reason", "new_keyword")
    .limit(1);
  if (error) throw new Error(`Could not check the keyword's charge: ${error.message}`);
  if (!data?.length) return false;
  await addCredits({
    userId: opts.userId,
    amount: opts.amount,
    reason: "refund",
    // One refund per keyword, whichever path gets there first.
    externalId: `keyword-refund:${opts.trackerId}`,
    trackerId: opts.trackerId,
    note:
      opts.why === "deleted"
        ? "Keyword deleted before its first capture"
        : "No AI Overview appeared during the 7-day study",
    admin,
  });
  return true;
}

/** Start of the current UTC day. */
function startOfUtcDay(now = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** What the app's own keys have cost today (UTC), in USD. */
export async function platformSpendTodayUsd(admin: Admin = createAdminClient()): Promise<number> {
  const { data, error } = await admin.rpc("platform_spend_since", { p_since: startOfUtcDay().toISOString() });
  if (error) throw new Error(`Could not read today's spend: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * Refuses new Claude work on the app's keys once today's spend passes
 * PLATFORM_DAILY_LIMIT_USD: a runaway loop or abuse can't run up the bill.
 * The staff plan is exempt.
 */
export async function assertPlatformBudget(account: Account, admin: Admin = createAdminClient()): Promise<void> {
  if (account.plan === "staff") return;
  const spent = await platformSpendTodayUsd(admin);
  if (spent >= serverEnv.platformDailyLimitUsd) throw dailyLimitError();
}

type KeywordForCharge = Pick<Tracker, "id" | "user_id" | "billing_source" | "keyword">;

/**
 * Charges for a report on a keyword: nothing on the owner's own keys or for
 * the keyword's first finished report, CREDIT_COSTS.reportUpdate for another.
 * Checks the daily ceiling for work on the app's keys. Throws a BillingError
 * when the action can't run; call `refund` on the result if the report fails.
 */
export async function chargeForReport(tracker: KeywordForCharge, admin: Admin = createAdminClient()): Promise<Charge> {
  if (tracker.billing_source === "own_keys") return NO_CHARGE;
  const account = await getAccount(tracker.user_id, admin);
  await assertPlatformBudget(account, admin);
  const { data, error } = await admin
    .from("analyses")
    .select("id")
    .eq("tracker_id", tracker.id)
    .eq("status", "done")
    .limit(1);
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  const amount = reportCreditCost({ billingSource: "platform", hasReport: (data ?? []).length > 0 });
  return chargeCredits({
    account,
    amount,
    reason: "report_update",
    trackerId: tracker.id,
    note: `Updated report: ${tracker.keyword}`,
    admin,
  });
}

/**
 * Charges for a page written from the report `analysisId`: nothing on the
 * owner's own keys or for the report's first ready-to-publish page, else
 * CREDIT_COSTS.researchedRewrite or CREDIT_COSTS.ownDataPage. Same contract
 * as chargeForReport.
 */
export async function chargeForDraft(
  tracker: KeywordForCharge,
  mode: DraftMode,
  analysisId: string,
  admin: Admin = createAdminClient(),
): Promise<Charge> {
  if (tracker.billing_source === "own_keys") return NO_CHARGE;
  const account = await getAccount(tracker.user_id, admin);
  await assertPlatformBudget(account, admin);
  const { data, error } = await admin
    .from("drafts")
    .select("id")
    .eq("tracker_id", tracker.id)
    .eq("analysis_id", analysisId)
    .eq("mode", "researched")
    .limit(1);
  if (error) throw new Error(`Could not load pages: ${error.message}`);
  const amount = draftCreditCost({ billingSource: "platform", mode, hasResearchedDraft: (data ?? []).length > 0 });
  return chargeCredits({
    account,
    amount,
    reason: mode === "placeholders" ? "own_data_page" : "page_rewrite",
    trackerId: tracker.id,
    note: `${mode === "placeholders" ? "With-my-own-data page" : "Rewritten page"}: ${tracker.keyword}`,
    admin,
  });
}
