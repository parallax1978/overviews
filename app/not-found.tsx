import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Footer } from "@/components/site/footer";
import { LinkButton } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Branded 404. Kept static (no cookies) so it can be prerendered. */
export default function NotFound() {
  return (
    <>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-3">
          <Logo />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <Eyebrow>404</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">That page is not here.</h1>
          <p className="mt-3 text-ink-muted">
            The link may be old, or the keyword may have been deleted.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton href="/">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </LinkButton>
            <LinkButton href="/app" variant="secondary">
              Open dashboard
            </LinkButton>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
