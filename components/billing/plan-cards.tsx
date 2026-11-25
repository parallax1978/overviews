import { Check, KeyRound } from "lucide-react";
import { startCheckout } from "@/app/app/billing/actions";
import { Button, LinkButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  keywordsForCredits,
  OWN_KEYS_COST_PER_KEYWORD_USD,
  OWN_KEYS_LIMITS,
  PAID_PLANS,
  type PaidPlan,
  type PlanId,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

export interface PlanCardsProps {
  /** The signed-in user's plan, or null when signed out. */
  currentPlan: PlanId | null;
  /** Stripe is set up: paid plans can be bought. */
  paymentsOn: boolean;
  /** Where the free plan's button goes (Settings when signed in, sign-in otherwise). */
  freeHref: string;
}

function usd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function PaidPlanCard({ plan, currentPlan, paymentsOn }: { plan: PaidPlan; currentPlan: PlanId | null; paymentsOn: boolean }) {
  const current = currentPlan === plan.id;
  const subscribed = currentPlan === "starter" || currentPlan === "pro" || currentPlan === "agency";
  const label = current ? "Your plan" : subscribed ? `Switch to ${plan.name}` : `Get ${plan.name}`;
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-white p-6 shadow-pop",
        plan.highlight ? "border-brand ring-2 ring-brand-soft" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-ink">{plan.name}</h3>
        {current ? <Chip tone="good">Your plan</Chip> : plan.highlight ? <Chip tone="brand">Most popular</Chip> : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>
      <p className="mt-5">
        <span className="text-4xl font-bold tracking-tight text-ink">${plan.priceUsd}</span>
        <span className="text-sm text-ink-muted"> / month</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink">
        <Feature>
          <span className="font-semibold">{plan.monthlyCredits} credits</span> a month, about{" "}
          {keywordsForCredits(plan.monthlyCredits)} keywords
        </Feature>
        <Feature>Every keyword: 7 days of tracking, the report and a ready-to-publish page</Feature>
        <Feature>
          Keep {plan.keepTrackingSlots} published {plan.keepTrackingSlots === 1 ? "page" : "pages"} tracked every day
        </Feature>
        <Feature>Unused credits carry over for a month</Feature>
        <Feature>No API keys needed</Feature>
      </ul>
      <div className="mt-6">
        {current ? (
          <LinkButton href="/app/billing" variant="secondary" className="w-full">
            Manage your plan
          </LinkButton>
        ) : paymentsOn ? (
          <form action={startCheckout}>
            <input type="hidden" name="plan" value={plan.id} />
            <Button type="submit" variant={plan.highlight ? "primary" : "secondary"} className="w-full">
              {label}
            </Button>
          </form>
        ) : (
          <Button disabled variant="secondary" className="w-full">
            Coming soon
          </Button>
        )}
      </div>
    </div>
  );
}

/** The free own-keys plan and the three paid plans, side by side. */
export function PlanCards({ currentPlan, paymentsOn, freeHref }: PlanCardsProps) {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col rounded-2xl border border-line bg-white p-6 shadow-pop">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-ink">Free</h3>
          {currentPlan === "free" ? <Chip tone="good">Your plan</Chip> : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted">Bring your own API keys. We never charge you.</p>
        <p className="mt-5">
          <span className="text-4xl font-bold tracking-tight text-ink">$0</span>
          <span className="text-sm text-ink-muted"> / month</span>
        </p>
        <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink">
          <Feature>Everything in the paid plans, on your own DataForSEO and Anthropic keys</Feature>
          <Feature>
            You pay them directly: about {usd(OWN_KEYS_COST_PER_KEYWORD_USD)} per keyword at today&apos;s prices
          </Feature>
          <Feature>Up to {OWN_KEYS_LIMITS.activeStudies} keywords tracking at once</Feature>
          <Feature>Keep {OWN_KEYS_LIMITS.keepTracking} published pages tracked every day</Feature>
        </ul>
        <div className="mt-6">
          <LinkButton href={freeHref} variant="secondary" className="w-full">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Add your keys
          </LinkButton>
        </div>
      </div>
      {PAID_PLANS.map((plan) => (
        <PaidPlanCard key={plan.id} plan={plan} currentPlan={currentPlan} paymentsOn={paymentsOn} />
      ))}
    </div>
  );
}
