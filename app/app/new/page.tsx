import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, KeyRound, Sparkles } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { LocalTime } from "@/components/ui/local-time";
import { requireUser } from "@/lib/auth";
import { getAccount } from "@/lib/billing";
import { loadOwnKeysStatus } from "@/lib/own-keys";
import { CREDIT_COSTS, creditsLabel, isPlanActive } from "@/lib/plans";
import type { Account } from "@/lib/types";
import { NewKeywordForm, type PaymentChoice } from "./new-keyword-form";

export const metadata: Metadata = { title: "New keyword" };

// The day-1 capture runs inside the form action: SAMPLES_PER_DAY DataForSEO requests, with retries.
export const maxDuration = 120;

/** Shown instead of the form when neither plan credits nor the user's own keys can pay for a keyword. */
function HowToPay({ account }: { account: Account }) {
  const active = isPlanActive(account);
  return (
    <Card>
      <h2 className="text-xl font-bold tracking-tight text-ink">
        {active ? "You're out of credits for now" : "Pick how to run your keywords"}
      </h2>
      <p className="mt-2 text-ink-muted">
        {active ? (
          <>
            A keyword uses {creditsLabel(CREDIT_COSTS.newKeyword)} and you have {account.credits_balance}.
            {account.current_period_end ? (
              <>
                {" "}
                Your credits refill on <LocalTime iso={account.current_period_end} mode="date" />.
              </>
            ) : null}{" "}
            You can also run it free on your own API keys.
          </>
        ) : (
          "Run it free on your own DataForSEO and Anthropic keys, or pick a plan and we run everything for you."
        )}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <LinkButton href="/app/settings" variant={active ? "secondary" : "primary"}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          Add your own keys
        </LinkButton>
        <LinkButton href={active ? "/app/billing" : "/pricing"} variant={active ? "primary" : "secondary"}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {active ? "Get more credits" : "See plans"}
        </LinkButton>
      </div>
    </Card>
  );
}

/** "Add keyword" screen. `?keyword=` (from the landing page input) prefills the search box. */
export default async function NewKeywordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/app/new");
  const [{ keyword }, account, keys] = await Promise.all([
    searchParams,
    getAccount(user.id),
    loadOwnKeysStatus(user.id),
  ]);
  const raw = Array.isArray(keyword) ? keyword[0] : keyword;
  const initialKeyword = (raw ?? "").trim().slice(0, 200);

  const staff = account.plan === "staff";
  const payment: PaymentChoice = {
    credits: staff || (isPlanActive(account) && account.credits_balance >= CREDIT_COSTS.newKeyword),
    staff,
    balance: account.credits_balance,
    ownKeys: keys.complete,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Your keywords
      </Link>

      <div className="mt-6">
        <Eyebrow>New keyword</Eyebrow>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
          What search do you want to win?
        </h1>
        <p className="mt-2 text-ink-muted">
          Pick a search that already shows an AI Overview. Buying-intent searches work best.
        </p>
      </div>

      <div className="mt-8">
        {payment.credits || payment.ownKeys ? (
          <NewKeywordForm initialKeyword={initialKeyword} payment={payment} />
        ) : (
          <HowToPay account={account} />
        )}
      </div>
    </div>
  );
}
