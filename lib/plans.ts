/**
 * Plans, credit prices and fair-use limits. The single place to change pricing.
 *
 * Cost basis, measured from the app's own api_log (November 2026, Claude Opus
 * 5.5 at "high" thinking, DataForSEO live SERP):
 *   one keyword (21 samples + report + ready-to-publish page)  up to $3.60
 *   rebuilding a report (new report + new page)                up to $3.50
 *   rewriting the ready-to-publish page                        up to $1.12
 *   the with-my-own-data page, or a rewrite of it              up to $0.33
 *   keeping a published page tracked, per month                about $0.24
 * One credit covers about $0.20 of API cost in the worst case, so every plan
 * keeps a modest margin however its credits are spent (see PLAN_ECONOMICS).
 * Pure module: safe to import from client components.
 */

export type PaidPlanId = "starter" | "pro" | "agency";
/** "free" uses the user's own API keys; "staff" is the owner's unlimited account. */
export type PlanId = "free" | PaidPlanId | "staff";

/** Which keys a keyword's API calls run on. */
export type BillingSource = "platform" | "own_keys";

export interface PaidPlan {
  id: PaidPlanId;
  name: string;
  priceUsd: number;
  /** Credits granted at every renewal. Unused credits roll over for one month (capped at this amount). */
  monthlyCredits: number;
  /** Published pages that can stay tracked after their 7-day study. */
  keepTrackingSlots: number;
  /** Stripe price lookup key; scripts/stripe-setup.mjs creates the prices with these keys. */
  stripeLookupKey: string;
  tagline: string;
  highlight?: boolean;
}

export const PAID_PLANS: PaidPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 19,
    monthlyCredits: 60,
    keepTrackingSlots: 3,
    stripeLookupKey: "overviews_starter_monthly",
    tagline: "For one site and a few searches a month.",
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 49,
    monthlyCredits: 170,
    keepTrackingSlots: 10,
    stripeLookupKey: "overviews_pro_monthly",
    tagline: "For growing sites that publish every week.",
    highlight: true,
  },
  {
    id: "agency",
    name: "Agency",
    priceUsd: 99,
    monthlyCredits: 360,
    keepTrackingSlots: 25,
    stripeLookupKey: "overviews_agency_monthly",
    tagline: "For agencies running searches for clients.",
  },
];

/** What each action costs in credits on the app's keys. Free on your own keys. */
export const CREDIT_COSTS = {
  /** 7 days of tracking (3 samples a day), the report and the ready-to-publish page. */
  newKeyword: 18,
  /** A fresh report plus its ready-to-publish page, for a keyword that already has a report. */
  reportUpdate: 18,
  /** Rewriting the ready-to-publish page (regenerate, or revise with notes). */
  researchedRewrite: 6,
  /** The with-my-own-data page, or a rewrite of it. */
  ownDataPage: 2,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

/** Credits refunded when a keyword never shows an AI Overview in 7 days (no report can be built). */
export const NO_OVERVIEW_REFUND = CREDIT_COSTS.newKeyword - 2;

/** Fair use on your own keys: protects the shared database and scheduler, not your API bill. */
export const OWN_KEYS_LIMITS = {
  /** Keywords in their 7-day study at the same time. */
  activeStudies: 10,
  /** Published pages kept tracked after their study. */
  keepTracking: 25,
};

/** Rough API cost of one keyword on your own keys, for the pricing page. */
export const OWN_KEYS_COST_PER_KEYWORD_USD = 3.6;

/** Worst-case API cost covered by one credit. */
export const COST_PER_CREDIT_USD = 0.2;
/** Monthly API cost of one kept-tracked page (90 samples at $0.0027). */
export const KEEP_TRACKING_COST_PER_MONTH_USD = 0.24;

export function paidPlan(id: string | null | undefined): PaidPlan | null {
  return PAID_PLANS.find((p) => p.id === id) ?? null;
}

export function planByLookupKey(lookupKey: string | null | undefined): PaidPlan | null {
  return PAID_PLANS.find((p) => p.stripeLookupKey === lookupKey) ?? null;
}

/** Display name for any plan id. */
export function planName(id: PlanId): string {
  if (id === "free") return "Free (your own keys)";
  if (id === "staff") return "Staff";
  return paidPlan(id)?.name ?? id;
}

/** Roughly how many full keywords a number of credits buys. */
export function keywordsForCredits(credits: number): number {
  return Math.floor(credits / CREDIT_COSTS.newKeyword);
}

/** Stripe's standard US card fee: 2.9% + 30 cents. */
export function stripeFeeUsd(priceUsd: number): number {
  return Math.round((priceUsd * 0.029 + 0.3) * 100) / 100;
}

/**
 * Margin of a plan when a subscriber spends every credit on the most
 * expensive actions and fills every keep-tracking slot. Typical use costs less.
 */
export function planEconomics(plan: PaidPlan): {
  revenueAfterFees: number;
  worstCaseApiCost: number;
  worstCaseMargin: number;
  worstCaseMarginPct: number;
} {
  const revenueAfterFees = plan.priceUsd - stripeFeeUsd(plan.priceUsd);
  const worstCaseApiCost =
    plan.monthlyCredits * COST_PER_CREDIT_USD + plan.keepTrackingSlots * KEEP_TRACKING_COST_PER_MONTH_USD;
  const worstCaseMargin = Math.round((revenueAfterFees - worstCaseApiCost) * 100) / 100;
  return {
    revenueAfterFees: Math.round(revenueAfterFees * 100) / 100,
    worstCaseApiCost: Math.round(worstCaseApiCost * 100) / 100,
    worstCaseMargin,
    worstCaseMarginPct: Math.round((worstCaseMargin / plan.priceUsd) * 100),
  };
}

/** Stripe subscription statuses that keep a plan working (past_due: Stripe is still retrying the card). */
export const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/** True when the account may use the app's keys: the staff plan, or a paid plan Stripe still bills. */
export function isPlanActive(account: { plan: PlanId; subscription_status: string | null } | null): boolean {
  if (!account) return false;
  if (account.plan === "staff") return true;
  if (!paidPlan(account.plan)) return false;
  return (ACTIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(account.subscription_status ?? "");
}

/** Published pages a plan may keep tracked after their study. Staff has no cap. */
export function keepTrackingLimit(plan: PlanId, billingSource: BillingSource): number {
  if (billingSource === "own_keys") return OWN_KEYS_LIMITS.keepTracking;
  if (plan === "staff") return Number.POSITIVE_INFINITY;
  return paidPlan(plan)?.keepTrackingSlots ?? 0;
}

/**
 * Credits a report costs. A keyword's first finished report (early or on day
 * 7) is part of what adding it paid for; another one is an update. Own keys
 * never cost credits.
 */
export function reportCreditCost(opts: { billingSource: BillingSource; hasReport: boolean }): number {
  if (opts.billingSource === "own_keys") return 0;
  return opts.hasReport ? CREDIT_COSTS.reportUpdate : 0;
}

/**
 * Credits a page costs. Every report includes its first ready-to-publish page
 * (written by itself); rewriting it, and the with-my-own-data version, cost
 * credits. Own keys never cost credits.
 */
export function draftCreditCost(opts: {
  billingSource: BillingSource;
  mode: "researched" | "placeholders";
  hasResearchedDraft: boolean;
}): number {
  if (opts.billingSource === "own_keys") return 0;
  if (opts.mode === "placeholders") return CREDIT_COSTS.ownDataPage;
  return opts.hasResearchedDraft ? CREDIT_COSTS.researchedRewrite : 0;
}

/** "18 credits", "1 credit". */
export function creditsLabel(credits: number): string {
  return `${credits.toLocaleString("en-US")} ${credits === 1 ? "credit" : "credits"}`;
}
