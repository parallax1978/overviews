import {
  ChevronRight,
  Clock,
  FileText,
  Globe,
  PenLine,
  Sparkles,
} from "lucide-react";
import { getUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { NumberBadge } from "@/components/ui/number-badge";

const heroInputClasses =
  "h-14 w-full rounded-full border border-white/15 bg-white/10 px-5 text-base text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-brand-soft/40 sm:h-12";

const steps = [
  {
    title: "Add the search you want to win",
    body: "Type the Google search your customers use. We take the first snapshot right away.",
  },
  {
    title: "We watch the AI Overview for 7 days",
    body: "Every day we save the full answer and every page Google cites, and show what changed.",
  },
  {
    title: "You get the patterns, the cited pages, and a better page written for you",
    body: "A plain-English report, a teardown of the top sources, and a finished draft to publish.",
  },
];

const features = [
  {
    icon: Clock,
    title: "Timeline",
    body: "One card per day with the full AI Overview, with changes from the day before highlighted.",
  },
  {
    icon: Globe,
    title: "Citations",
    body: "Every page Google cited, ranked by how many days it showed up. The sources Google trusts.",
  },
  {
    icon: FileText,
    title: "Report",
    body: "What stays the same, what moves, and what the cited pages do that yours does not. In plain English.",
  },
  {
    icon: PenLine,
    title: "Draft",
    body: "A complete page written around the findings, with clear spots to add your own data and experience.",
  },
];

/** A static preview of the keyword timeline card. Illustrative only. */
function PreviewCard() {
  return (
    <Card className="text-left text-ink">
      <div className="flex items-center justify-between gap-3">
        <Chip tone="brand">Day 3 of 7</Chip>
        <span className="text-xs text-ink-soft">Preview</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">AI Overview today</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        The best choice depends on your budget and how much setup you want. Most guides recommend
        starting with a free plan, then upgrading once you need
        <mark className="rounded bg-brand-faint px-1 text-brand-strong"> team features and reporting</mark>.
      </p>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-soft">Cited pages</p>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-ink-soft" />
            <span className="truncate">Industry guide</span>
          </span>
          <Chip tone="good">3 of 3 days</Chip>
        </li>
        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-ink-soft" />
            <span className="truncate">Comparison review</span>
          </span>
          <Chip tone="good">2 of 3 days</Chip>
        </li>
        <li className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-ink-soft" />
            <span className="truncate">Vendor page</span>
          </span>
          <Chip tone="brand">New today</Chip>
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-soft">1 sentence changed and 1 new source since yesterday.</p>
    </Card>
  );
}

export default async function LandingPage() {
  const user = await getUser();
  const signedIn = Boolean(user);
  // Signed-in users skip the login step and go straight to the add-keyword form.
  const startAction = signedIn ? "/app/new" : "/login";
  const ctaHref = signedIn ? "/app/new" : "/login?intent=new";

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main className="flex-1">
        <section className="hero-dark">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-2">
            <div>
              <p className="eyebrow text-brand-soft">Win the AI Overview</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
                Track one AI Overview for a week,
                <span className="text-gradient block">then write the page that wins it.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-white/75">
                We save Google&apos;s AI answer for your search every day, show you which pages it
                keeps citing, and write you a better page.
              </p>
              <form action={startAction} method="get" className="mt-8 flex flex-col gap-3 sm:flex-row">
                <label htmlFor="hero-keyword" className="sr-only">
                  The search you want to win
                </label>
                <input
                  id="hero-keyword"
                  name="keyword"
                  type="text"
                  required
                  maxLength={200}
                  placeholder="What search do you want to win?"
                  className={heroInputClasses}
                />
                <input type="hidden" name="intent" value="new" />
                <Button type="submit" size="md" className="h-14 shrink-0 sm:h-12">
                  Start tracking
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-4 text-sm text-white/60">No password. First snapshot in under a minute.</p>
            </div>
            <div className="lg:pl-6">
              <PreviewCard />
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">Three steps. One week.</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4 sm:flex-col">
                  <NumberBadge>{index + 1}</NumberBadge>
                  <div>
                    <h3 className="font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-surface-alt">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
            <Eyebrow>What you get</Eyebrow>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">
              Everything you need to earn the citation.
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, body }) => (
                <Card key={title} className="p-5 sm:p-5">
                  <span className="brand-gradient inline-flex h-9 w-9 items-center justify-center rounded-lg text-white shadow-glow">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-4 font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="hero-dark">
          <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:py-20">
            <span className="brand-gradient inline-flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-glow">
              <Sparkles className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
              Pick one search. See what Google wants.
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-white/75">
              Start today and your report is ready in a week.
            </p>
            <div className="mt-8">
              <LinkButton href={ctaHref} size="lg">
                Start tracking
                <ChevronRight className="h-5 w-5" />
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-white/60">No password. Cancel any time.</p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
