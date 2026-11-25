import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "whsec_test_secret";

const mocks = vi.hoisted(() => ({ handle: vi.fn(async () => "synced") }));
vi.mock("@/lib/stripe-sync", () => ({ handleStripeEvent: mocks.handle }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

process.env.STRIPE_SECRET_KEY = "sk_test_not_used_for_signatures";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
const { POST } = await import("@/app/api/stripe/webhook/route");

const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  data: { object: { id: "sub_1", object: "subscription" } },
});

function post(body: string, signature: string | null) {
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: signature ? { "stripe-signature": signature } : {},
    }),
  );
}

beforeEach(() => mocks.handle.mockClear());

describe("POST /api/stripe/webhook", () => {
  it("handles an event Stripe signed", async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const response = await post(payload, signature);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, note: "synced" });
    expect(mocks.handle).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_1", type: "customer.subscription.updated" }));
  });

  it("rejects a forged or altered event without touching anything", async () => {
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    expect((await post(payload, forged)).status).toBe(400);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect((await post(payload.replace("sub_1", "sub_2"), signature)).status).toBe(400);
    expect((await post(payload, null)).status).toBe(400);
    expect(mocks.handle).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when applying the event fails", async () => {
    mocks.handle.mockRejectedValueOnce(new Error("database down"));
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect((await post(payload, signature)).status).toBe(500);
  });
});
