import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, KeyRound, TriangleAlert } from "lucide-react";
import { PlanCards } from "@/components/billing/plan-cards";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import { requireUser } from "@/lib/auth";
import { freeAccount } from "@/lib/billing";
import { loadOwnKeysStatus } from "@/lib/own-keys";
import { CREDIT_COSTS, creditsLabel, isPlanActive, keywordsForCredits, paidPlan, planName } from "@/lib/plans";
import { paymentsEnabled } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import type { Account, CreditLedgerEntry } from "@/lib/types";
import { openBillingPortal } from "./actions";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

const HISTORY_ROWS = 30;

const REASON_LABELS: Record<string, string> = {
  plan_grant: "Monthly credits",
  upgrade_grant: "Plan upgrade",
  new_keyword: "Added a keyword",
  report_update: "Updated a report",
  page_rewrite: "Rewrote a page",
  own_data_page: "With-my-own-data page",
  refund: "Credits back",
  expired: "Expired",
};

function PlanStatus({ account }: { account: Account }) {
  if (account.plan === "staff") {
    return <p className="mt-2 text-ink-muted">Staff plan. Everything runs on the app&apos;s keys, at no charge.</p>;
  }
  const plan = paidPlan(account.plan);
  if (!plan) {
    return (
      <p className="mt-2 text-ink-muted">
        Run keywords free on your own API keys, or pick a plan below and we run everything for you.
      </p>
    );
  }
  if (!isPlanActive(account)) {
    return (
      <p className="mt-2 flex items-start gap-2 text-bad">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Your {plan.name} plan isn&apos;t active yet. Open billing to finish the payment.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-1 text-ink-muted">
      <p>
        ${plan.priceUsd} a month · {plan.monthlyCredits} credits each month · keeps {plan.keepTrackingSlots} pages
        tracked
      </p>
      {account.current_period_end ? (
        <p>
          {account.cancel_at_period_end ? "Ends on " : "Renews on "}
          <LocalTime iso={account.current_period_end} mode="date" />
          {account.cancel_at_period_end ? ". You keep it until then." : "."}
        </p>
      ) : null}
      {account.subscription_status === "past_due" ? (
        <p className="flex items-start gap-2 text-bad">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Your last payment didn&apos;t go through. Update your card to keep your plan.
        </p>
      ) : null}
    </div>
  );
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; payments?: string }>;
}) {
  const user = await requireUser("/app/billing");
  const [{ checkout, payments }, supabase] = await Promise.all([searchParams, createClient()]);
  // Read through RLS: the user's own account and credit history only.
  const [accountRes, ledgerRes, keys] = await Promise.all([
    supabase.from("accounts").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("credit_ledger")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_ROWS),
    loadOwnKeysStatus(user.id),
  ]);
  if (accountRes.error) console.error("account query failed", accountRes.error.message);
  if (ledgerRes.error) console.error("ledger query failed", ledgerRes.error.message);
  const account = (accountRes.data as Account | null) ?? freeAccount(user.id);
  const ledger = (ledgerRes.data ?? []) as CreditLedgerEntry[];
  const paymentsOn = paymentsEnabled();
  const active = isPlanActive(account);
  const canManage = paymentsOn && Boolean(account.stripe_customer_id);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Billing</Eyebrow>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Your plan and credits</h1>
      </div>

      {checkout === "success" ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-line bg-good-soft p-4 text-sm text-good">
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Thanks! Your plan is on. Credits can take a few seconds to arrive. Refresh this page if you don&apos;t see
            them yet.
          </p>
        </div>
      ) : null}
      {payments === "off" ? (
        <p role="status" className="rounded-2xl border border-line bg-white p-4 text-sm text-ink-muted">
          Paid plans open soon. Until then you can run keywords free on your own API keys.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-ink">{planName(account.plan)}</h2>
            {account.plan === "staff" ? (
              <Chip tone="brand">Unlimited</Chip>
            ) : active ? (
              <Chip tone="good">Active</Chip>
            ) : paidPlan(account.plan) ? (
              <Chip tone="warn">Not active</Chip>
            ) : null}
          </div>
          <PlanStatus account={account} />
          {canManage ? (
            <form action={openBillingPortal} className="mt-5">
              <Button type="submit" variant="secondary" size="sm">
                Change plan, card or invoices
              </Button>
            </form>
          ) : null}
        </Card>

        <Card>
          <p className="text-sm font-semibold text-ink-muted">Credits left</p>
          {account.plan === "staff" ? (
            <p className="mt-1 text-4xl font-bold tracking-tight text-ink">∞</p>
          ) : (
            <>
              <p className="mt-1 text-4xl font-bold tracking-tight text-ink">{account.credits_balance}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {active
                  ? `About ${keywordsForCredits(account.credits_balance)} keywords. Unused credits carry over for a month.`
                  : "Credits come with a paid plan."}
              </p>
            </>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-faint text-brand-strong">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-ink">Your own API keys</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {keys.complete
                ? "Saved. Any keyword can run on them, free."
                : "Add your DataForSEO and Anthropic keys to run keywords free, on any plan."}
            </p>
          </div>
        </div>
        <Link href="/app/settings" className="shrink-0 text-sm font-semibold text-brand hover:text-brand-strong">
          {keys.complete ? "Manage keys" : "Add your keys"}
        </Link>
      </Card>

      {account.plan === "staff" ? null : (
        <section>
          <h2 className="text-xl font-bold tracking-tight text-ink">{active ? "Change plan" : "Plans"}</h2>
          <div className="mt-4">
            <PlanCards currentPlan={account.plan} paymentsOn={paymentsOn} freeHref="/app/settings" />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold tracking-tight text-ink">Credit history</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <Card className="mt-4 overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">What</th>
                  <th className="px-5 py-3 text-right font-semibold">Credits</th>
                  <th className="px-5 py-3 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ledger.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      <LocalTime iso={row.created_at} mode="date" />
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-ink">{REASON_LABELS[row.reason] ?? row.reason}</p>
                      {row.note ? <p className="mt-0.5 max-w-md truncate text-xs text-ink-soft">{row.note}</p> : null}
                    </td>
                    <td className={`whitespace-nowrap px-5 py-3 text-right font-semibold ${row.delta > 0 ? "text-good" : "text-ink"}`}>
                      {row.delta > 0 ? `+${row.delta}` : row.delta}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-ink-muted">{row.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-3 text-xs text-ink-soft">
          Keywords on your own keys never use credits. {creditsLabel(CREDIT_COSTS.newKeyword)} cover a whole keyword
          on our keys.
        </p>
      </section>
    </div>
  );
}
