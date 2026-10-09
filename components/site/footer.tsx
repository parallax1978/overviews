import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm text-ink-muted">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2">
            <Link href="/" aria-label="Legiit Overviews" className="inline-flex items-center gap-2">
              <Wordmark />
            </Link>
            <span>
              · A{" "}
              <a
                href="https://legiit.com"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium hover:text-ink"
              >
                Legiit
              </a>{" "}
              product
            </span>
          </p>
          <nav className="flex flex-wrap items-center gap-4">
            <Link href="/#how" className="hover:text-ink">
              How It Works
            </Link>
            <a href="mailto:help@legiit.com" className="hover:text-ink">
              Support
            </a>
            <Link href="/login" className="hover:text-ink">
              Sign In
            </Link>
          </nav>
        </div>
        <p className="mt-6 border-t border-line pt-5 text-xs">
          Operated by Superstar SEO LLC. AI Overview data is captured from Google results and may
          change at any time.
        </p>
      </div>
    </footer>
  );
}
