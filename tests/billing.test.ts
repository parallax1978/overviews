import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto";
import {
  CREDIT_COSTS,
  PAID_PLANS,
  draftCreditCost,
  isPlanActive,
  keepTrackingLimit,
  planEconomics,
  reportCreditCost,
} from "@/lib/plans";
import type { Account } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pure pricing rules

describe("plans", () => {
  it("keeps a margin on every plan even when every credit and tracking slot is used", () => {
    for (const plan of PAID_PLANS) {
      const economics = planEconomics(plan);
      expect(economics.worstCaseMargin, plan.id).toBeGreaterThan(0);
    }
  });

  it("gives more credits per dollar on bigger plans", () => {
    const perDollar = PAID_PLANS.map((p) => p.monthlyCredits / p.priceUsd);
    expect(perDollar).toEqual([...perDollar].sort((a, b) => a - b));
  });

  it("treats only working subscriptions and the staff plan as active", () => {
    expect(isPlanActive({ plan: "staff", subscription_status: null })).toBe(true);
    expect(isPlanActive({ plan: "pro", subscription_status: "active" })).toBe(true);
    expect(isPlanActive({ plan: "pro", subscription_status: "past_due" })).toBe(true);
    expect(isPlanActive({ plan: "pro", subscription_status: "incomplete" })).toBe(false);
    expect(isPlanActive({ plan: "pro", subscription_status: "canceled" })).toBe(false);
    expect(isPlanActive({ plan: "free", subscription_status: "active" })).toBe(false);
    expect(isPlanActive(null)).toBe(false);
  });

  it("includes the first report and its ready-to-publish page, and charges for more", () => {
    expect(reportCreditCost({ billingSource: "platform", hasReport: false })).toBe(0);
    expect(reportCreditCost({ billingSource: "platform", hasReport: true })).toBe(CREDIT_COSTS.reportUpdate);
    expect(draftCreditCost({ billingSource: "platform", mode: "researched", hasResearchedDraft: false })).toBe(0);
    expect(draftCreditCost({ billingSource: "platform", mode: "researched", hasResearchedDraft: true })).toBe(
      CREDIT_COSTS.researchedRewrite,
    );
    expect(draftCreditCost({ billingSource: "platform", mode: "placeholders", hasResearchedDraft: true })).toBe(
      CREDIT_COSTS.ownDataPage,
    );
  });

  it("never charges credits on your own keys", () => {
    expect(reportCreditCost({ billingSource: "own_keys", hasReport: true })).toBe(0);
    expect(draftCreditCost({ billingSource: "own_keys", mode: "placeholders", hasResearchedDraft: true })).toBe(0);
  });

  it("caps kept-tracked pages by plan, and not at all on staff", () => {
    expect(keepTrackingLimit("starter", "platform")).toBe(3);
    expect(keepTrackingLimit("free", "platform")).toBe(0);
    expect(keepTrackingLimit("staff", "platform")).toBe(Number.POSITIVE_INFINITY);
    expect(keepTrackingLimit("free", "own_keys")).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Encryption of users' own keys

describe("own key encryption", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips a secret for its owner", () => {
    const sealed = encryptSecret("sk-ant-api03-secret", "user-1", key);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("secret");
    expect(decryptSecret(sealed, "user-1", key)).toBe("sk-ant-api03-secret");
  });

  it("refuses another owner, another key and a tampered value", () => {
    const sealed = encryptSecret("password", "user-1", key);
    expect(() => decryptSecret(sealed, "user-2", key)).toThrow();
    expect(() => decryptSecret(sealed, "user-1", randomBytes(32).toString("base64"))).toThrow();
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), "user-1", key)).toThrow();
  });

  it("rejects an encryption key of the wrong size", () => {
    expect(() => encryptSecret("x", "user-1", Buffer.from("short").toString("base64"))).toThrow(/32 random bytes/);
  });

  it("shows only the last four characters", () => {
    expect(secretHint("sk-ant-api03-abcdefgh1234")).toBe("••••1234");
    expect(secretHint("short")).toBe("••••");
  });
});

// ---------------------------------------------------------------------------
// Credits, Stripe events and the daily job's plan rules, against fakes

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>(),
  accounts: [] as Row[],
  subscription: null as unknown,
  /** Objects stripeCall returns by endpoint; anything else returns `subscription`. */
  stripeObjects: {} as Record<string, unknown>,
  addCredits: vi.fn(),
  expireAllCredits: vi.fn(),
}));

/** Just enough of the Supabase client for lib/billing and lib/stripe-sync: accounts rows and rpc. */
function fakeAdmin() {
  return {
    rpc: mocks.rpc,
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "update" | "upsert" = "select";
      let values: Row = {};
      const rows = () => (table === "accounts" ? mocks.accounts : []);
      const run = () => {
        if (op === "upsert") {
          const existing = mocks.accounts.find((r) => r.user_id === values.user_id);
          if (existing) Object.assign(existing, values);
          else mocks.accounts.push({ ...values });
          return { data: null, error: null };
        }
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") for (const r of matched) Object.assign(r, values);
        return { data: matched, error: null };
      };
      const builder = {
        select: () => builder,
        update: (v: Row) => {
          op = "update";
          values = v;
          return builder;
        },
        upsert: (v: Row) => {
          op = "upsert";
          values = v;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          filters.push((r) => r[column] === value);
          return builder;
        },
        in: (column: string, list: unknown[]) => {
          filters.push((r) => list.includes(r[column]));
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          const { data } = run();
          return { data: (data as Row[] | null)?.[0] ?? null, error: null };
        },
        then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(onFulfilled, onRejected),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe")>();
  return {
    ...actual,
    stripeCall: async (endpoint: string) => mocks.stripeObjects[endpoint] ?? mocks.subscription,
  };
});

const { chargeCredits, freeAccount, BillingError } = await import("@/lib/billing");
const { grantForInvoice, endSubscription, fulfillCheckout } = await import("@/lib/stripe-sync");
const { mayCapture } = await import("@/lib/capture");

function account(overrides: Partial<Account> = {}): Account {
  return { ...freeAccount("user-1"), ...overrides };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.accounts = [];
  mocks.subscription = null;
  mocks.stripeObjects = {};
});

describe("chargeCredits", () => {
  it("charges nothing on the staff plan or for free actions", async () => {
    const charge = await chargeCredits({ account: account({ plan: "staff" }), amount: 18, reason: "new_keyword" });
    expect(charge.credits).toBe(0);
    await chargeCredits({ account: account(), amount: 0, reason: "report_update" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("needs an active plan", async () => {
    const err = await chargeCredits({ account: account({ plan: "free" }), amount: 18, reason: "new_keyword" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BillingError);
    expect((err as InstanceType<typeof BillingError>).status).toBe(402);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses when the atomic spend finds too few credits", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    mocks.accounts.push({ ...account({ plan: "pro", subscription_status: "active", credits_balance: 4 }) });
    const err = await chargeCredits({
      account: account({ plan: "pro", subscription_status: "active", credits_balance: 40 }),
      amount: 18,
      reason: "new_keyword",
    }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/uses 18 credits and you have 4 credits left/);
  });

  it("spends once and refunds once", async () => {
    mocks.rpc.mockResolvedValue({ data: 22, error: null });
    const charge = await chargeCredits({
      account: account({ plan: "pro", subscription_status: "active", credits_balance: 40 }),
      amount: 18,
      reason: "report_update",
      trackerId: "tracker-1",
    });
    expect(charge.credits).toBe(18);
    expect(mocks.rpc).toHaveBeenCalledWith("spend_credits", expect.objectContaining({ p_amount: 18, p_tracker: "tracker-1" }));
    await charge.refund("failed");
    await charge.refund("failed again");
    const refunds = mocks.rpc.mock.calls.filter(([name]) => name === "add_credits");
    expect(refunds).toHaveLength(1);
    expect(refunds[0][1]).toMatchObject({ p_amount: 18, p_reason: "refund" });
  });
});

describe("Stripe invoice credits", () => {
  function subscription(plan: "starter" | "pro" | "agency", periodStart: number, status = "active") {
    const lookup = PAID_PLANS.find((p) => p.id === plan)!.stripeLookupKey;
    return {
      id: "sub_1",
      status,
      customer: "cus_1",
      metadata: { user_id: "user-1" },
      cancel_at_period_end: false,
      cancel_at: null,
      items: {
        data: [
          {
            price: { lookup_key: lookup },
            current_period_start: periodStart,
            current_period_end: periodStart + 30 * 86400,
          },
        ],
      },
    };
  }

  function invoice(id: string) {
    return { id, parent: { subscription_details: { subscription: "sub_1" } } } as never;
  }

  beforeEach(() => {
    mocks.accounts.push({ ...account({ stripe_customer_id: "cus_1" }) });
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
  });

  const addCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === "add_credits").map(([, args]) => args);

  it("grants a month of credits for a new period, trimming what rolled over to one month", async () => {
    mocks.subscription = subscription("starter", 1_000_000);
    await expect(grantForInvoice(invoice("in_1"))).resolves.toBe("granted 60");
    expect(addCalls()).toEqual([
      expect.objectContaining({ p_amount: 60, p_reason: "plan_grant", p_external_id: "invoice:in_1", p_cap: 60 }),
    ]);
    expect(mocks.accounts[0]).toMatchObject({ plan: "starter", subscription_status: "active", granted_plan: "starter" });
  });

  it("tops up only the difference after an upgrade in the same period, without trimming", async () => {
    mocks.subscription = subscription("starter", 1_000_000);
    await grantForInvoice(invoice("in_1"));
    mocks.subscription = subscription("pro", 1_000_000);
    await expect(grantForInvoice(invoice("in_2"))).resolves.toBe("granted 110");
    expect(addCalls()[1]).toMatchObject({ p_amount: 110, p_reason: "upgrade_grant", p_cap: null });
  });

  it("grants nothing extra after a downgrade until the next period", async () => {
    mocks.subscription = subscription("pro", 1_000_000);
    await grantForInvoice(invoice("in_1"));
    mocks.subscription = subscription("starter", 1_000_000);
    await expect(grantForInvoice(invoice("in_2"))).resolves.toBe("no credits due");
    mocks.subscription = subscription("starter", 1_000_000 + 30 * 86400);
    await expect(grantForInvoice(invoice("in_3"))).resolves.toBe("granted 60");
  });

  it("leaves the staff plan alone", async () => {
    mocks.accounts[0].plan = "staff";
    mocks.subscription = subscription("agency", 1_000_000);
    await expect(grantForInvoice(invoice("in_1"))).resolves.toBe("ignored: staff account");
    expect(addCalls()).toHaveLength(0);
    expect(mocks.accounts[0].plan).toBe("staff");
  });

  it("ends the plan and expires the credits when the current subscription is deleted", async () => {
    mocks.accounts[0].stripe_subscription_id = "sub_1";
    mocks.accounts[0].plan = "pro";
    await expect(endSubscription(subscription("pro", 1_000_000, "canceled") as never)).resolves.toBe("ended");
    expect(mocks.accounts[0].plan).toBe("free");
    expect(mocks.rpc).toHaveBeenCalledWith("expire_credits", expect.objectContaining({ p_user: "user-1" }));
  });

  it("ignores the end of an older subscription", async () => {
    mocks.accounts[0].stripe_subscription_id = "sub_2";
    mocks.accounts[0].plan = "pro";
    await expect(endSubscription(subscription("pro", 1_000_000, "canceled") as never)).resolves.toBe(
      "ignored: not the current subscription",
    );
    expect(mocks.accounts[0].plan).toBe("pro");
  });
});

describe("returning from Stripe Checkout", () => {
  function starterSubscription() {
    const lookup = PAID_PLANS.find((p) => p.id === "starter")!.stripeLookupKey;
    return {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      metadata: { user_id: "user-1" },
      cancel_at_period_end: false,
      cancel_at: null,
      latest_invoice: "in_1",
      items: {
        data: [{ price: { lookup_key: lookup }, current_period_start: 1_000_000, current_period_end: 1_000_000 + 30 * 86400 }],
      },
    };
  }

  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: 60, error: null });
    mocks.subscription = starterSubscription();
    mocks.stripeObjects = {
      "checkout.sessions.retrieve": {
        id: "cs_1",
        mode: "subscription",
        status: "complete",
        client_reference_id: "user-1",
        customer: "cus_1",
        subscription: "sub_1",
      },
      "invoices.retrieve": { id: "in_1", status: "paid", parent: { subscription_details: { subscription: "sub_1" } } },
    };
  });

  const grants = () => mocks.rpc.mock.calls.filter(([name]) => name === "add_credits").map(([, args]) => args);

  it("activates the plan and gives the credits before the webhook arrives", async () => {
    await expect(fulfillCheckout("cs_1", "user-1")).resolves.toBe(true);
    expect(mocks.accounts[0]).toMatchObject({ stripe_customer_id: "cus_1", plan: "starter", subscription_status: "active" });
    expect(grants()).toEqual([expect.objectContaining({ p_amount: 60, p_external_id: "invoice:in_1" })]);
  });

  it("keys the grant by invoice, so the webhook's later delivery adds nothing", async () => {
    await fulfillCheckout("cs_1", "user-1");
    await grantForInvoice(mocks.stripeObjects["invoices.retrieve"] as never);
    // Same period, same plan: the webhook finds the month already granted.
    expect(grants()).toHaveLength(1);
  });

  it("refuses a checkout another user started", async () => {
    await expect(fulfillCheckout("cs_1", "user-2")).resolves.toBe(false);
    expect(mocks.accounts).toHaveLength(0);
    expect(grants()).toHaveLength(0);
  });

  it("waits for the webhook when the payment isn't through yet", async () => {
    (mocks.stripeObjects["invoices.retrieve"] as { status: string }).status = "open";
    (mocks.subscription as { status: string }).status = "incomplete";
    await expect(fulfillCheckout("cs_1", "user-1")).resolves.toBe(false);
    expect(grants()).toHaveLength(0);
  });
});

describe("daily job plan rules", () => {
  it("always captures a study in progress and own-key keywords; kept-tracked pages need a plan with room", () => {
    const study = { id: "t1", user_id: "u1", billing_source: "platform" as const, day_count: 3, days_target: 7 };
    const kept = (id: string, userId = "u1") => ({
      id,
      user_id: userId,
      billing_source: "platform" as const,
      day_count: 9,
      days_target: 7,
    });
    const accounts = new Map([
      ["u1", { plan: "starter" as const, subscription_status: "active" }],
      ["u2", { plan: "free" as const, subscription_status: null }],
    ]);
    const order = new Map([["u1", ["k1", "k2", "k3", "k4"]]]);

    expect(mayCapture(study, accounts, order)).toBe(true);
    expect(mayCapture({ ...kept("k9"), billing_source: "own_keys" }, accounts, order)).toBe(true);
    expect(mayCapture(kept("k1"), accounts, order)).toBe(true);
    expect(mayCapture(kept("k3"), accounts, order)).toBe(true);
    expect(mayCapture(kept("k4"), accounts, order)).toBe(false); // Starter keeps 3
    expect(mayCapture(kept("k5", "u2"), accounts, order)).toBe(false); // plan ended
  });
});
