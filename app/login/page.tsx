import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { safeNextPath } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Where to send the user after sign-in: a safe `next`, else the new-keyword flow, else the dashboard. */
function resolveNext(next: string | undefined, keyword: string | undefined): string {
  const safe = safeNextPath(next, "");
  if (safe) return safe;
  if (keyword) return `/app/new?keyword=${encodeURIComponent(keyword)}`;
  return "/app";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const keyword = first(params.keyword)?.trim() || undefined;
  const intent = first(params.intent);
  const errorCode = first(params.error);
  const next = resolveNext(first(params.next), keyword);
  const startingFirstKeyword = intent === "new" || Boolean(keyword);

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center bg-surface-alt px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">
          <Card>
            <Eyebrow>{startingFirstKeyword ? "Free to start" : "Welcome back"}</Eyebrow>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
              {startingFirstKeyword ? "Start tracking your first keyword" : "Sign in"}
            </h1>
            <p className="mt-2 text-ink-muted">Sign in with your email. No password.</p>

            {keyword ? (
              <p className="mt-4 rounded-xl bg-brand-faint px-4 py-2.5 text-sm text-brand-strong">
                We will start tracking <span className="font-semibold">&ldquo;{keyword}&rdquo;</span> as
                soon as you are in.
              </p>
            ) : null}

            {errorCode === "link" ? (
              <p role="alert" className="mt-4 rounded-xl bg-bad-soft px-4 py-2.5 text-sm text-bad">
                That link has expired. Request a new code.
              </p>
            ) : null}

            <div className="mt-6">
              <LoginForm next={next} />
            </div>
          </Card>
          <p className="mt-6 text-center text-xs text-ink-soft">
            We only use your email to sign you in. Codes expire after one hour.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
