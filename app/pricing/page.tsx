import type { Metadata } from "next";
import { PlanCards } from "@/components/billing/plan-cards";
import { Footer } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getUser } from "@/lib/auth";
import { getAccount } from "@/lib/billing";
import { CREDIT_COSTS, NO_OVERVIEW_REFUND, OWN_KEYS_COST_PER_KEYWORD_USD, type PlanId } from "@/lib/plans";
import { paymentsEnabled } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free on your own API keys, or from $19 a month on ours. Every plan writes with Claude Opus 5.5.",
};

export const dynamic = "force-dynamic";

const ownKeysCost = OWN_KEYS_COST_PER_KEYWORD_USD.toLocaleString("en-US", { style: "currency", currency: "USD" });

const creditRows = [
  {
    what: "Add a keyword",
    detail: "7 days of tracking with 3 samples a day, the report, and the ready-to-publish page",
    credits: CREDIT_COSTS.newKeyword,
  },
  {
    what: "Update a report",
    detail: "A fresh report from every sample so far, with a new ready-to-publish page",
    credits: CREDIT_COSTS.reportUpdate,
  },
  {
    what: "Rewrite the ready-to-publish page",
    detail: "A fresh take, or changes from your notes",
    credits: CREDIT_COSTS.researchedRewrite,
  },
  {
    what: "The with-my-own-data version",
    detail: "The same page with notes where your own numbers and experience go",
    credits: CREDIT_COSTS.ownDataPage,
  },
];

const faqs = [
  {
    q: "What is a credit?",
    a: `Credits pay for the work on our keys. Adding a keyword uses ${CREDIT_COSTS.newKeyword} credits and covers the whole week: the tracking, the report and the page. Rewrites and extra versions use a few more.`,
  },
  {
    q: "Why is the free plan free?",
    a: "On the free plan the searches and the writing run on your own DataForSEO and Anthropic accounts, so they bill you directly and we don't. You get the same app, the same reports and the same pages.",
  },
  {
    q: "What do my own keys cost me?",
    a: `About ${ownKeysCost} per keyword at today's prices. The searches cost about 6 cents for the week. Almost all of it is Claude reading the cited pages and writing your report and page.`,
  },
  {
    q: "Do unused credits carry over?",
    a: "Yes, for one month. When your plan renews you keep up to one month's worth of unused credits on top of the new ones.",
  },
  {
    q: "What if a search never shows an AI Overview?",
    a: `There is nothing to report, so ${NO_OVERVIEW_REFUND} of the ${CREDIT_COSTS.newKeyword} credits come back after the 7 days. Delete a keyword before its first capture works and you get all of them back.`,
  },
  {
    q: "Can I change or cancel my plan?",
    a: "Any time, from the Billing page. A bigger plan starts right away, with the extra credits added. If you cancel, your plan runs to the end of the month you paid for.",
  },
  {
    q: "Which AI writes my page?",
    a: "Claude Opus 5.5 from Anthropic, on every plan. It reads the pages Google cites and checks its facts on the web before it writes.",
  },
];

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const [{ checkout }, user] = await Promise.all([searchParams, getUser()]);
  const currentPlan: PlanId | null = user ? (await getAccount(user.id)).plan : null;

  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main className="flex-1">
        <section className="hero-dark">
          <div className="mx-auto max-w-5xl px-4 py-14 text-center sm:py-20">
            <p className="eyebrow text-brand-soft">Pricing</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Free on your own keys.
              <span className="text-gradient block">Or let us run it for you.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-white/75">
              Every plan tracks the AI Overview for a week, finds what Google keeps citing, and writes you a better
              page with Claude Opus 5.5.
            </p>
          </div>
        </section>

        <section className="bg-surface-alt">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
            {checkout === "canceled" ? (
              <p role="status" className="mb-6 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-muted">
                Checkout was canceled. You weren&apos;t charged.
              </p>
            ) : null}
            <PlanCards
              currentPlan={currentPlan}
              paymentsOn={paymentsEnabled()}
              freeHref={user ? "/app/settings" : "/login?next=/app/settings"}
            />
            <p className="mt-6 text-center text-sm text-ink-muted">Prices in US dollars. Cancel any time.</p>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
            <Eyebrow>Credits</Eyebrow>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">What a credit buys</h2>
            <p className="mt-2 text-ink-muted">On the free plan none of this uses credits: it runs on your own keys.</p>
            <Card className="mt-8 p-0 sm:p-0">
              <ul className="divide-y divide-line">
                {creditRows.map((row) => (
                  <li key={row.what} className="flex items-start justify-between gap-6 px-5 py-4 sm:px-6">
                    <div>
                      <p className="font-semibold text-ink">{row.what}</p>
                      <p className="mt-0.5 text-sm text-ink-muted">{row.detail}</p>
                    </div>
                    <p className="shrink-0 text-right font-semibold text-ink">
                      {row.credits} <span className="text-sm font-normal text-ink-muted">credits</span>
                    </p>
                  </li>
                ))}
                <li className="flex items-start justify-between gap-6 px-5 py-4 sm:px-6">
                  <div>
                    <p className="font-semibold text-ink">A search that never shows an AI Overview</p>
                    <p className="mt-0.5 text-sm text-ink-muted">Credits come back after its 7 days</p>
                  </div>
                  <p className="shrink-0 text-right font-semibold text-good">
                    {NO_OVERVIEW_REFUND} <span className="text-sm font-normal">back</span>
                  </p>
                </li>
              </ul>
            </Card>
          </div>
        </section>

        <section className="bg-surface-alt">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:py-16">
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">Good to know</h2>
            <dl className="mt-8 space-y-6">
              {faqs.map((item) => (
                <div key={item.q}>
                  <dt className="font-semibold text-ink">{item.q}</dt>
                  <dd className="mt-1.5 text-ink-muted">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
