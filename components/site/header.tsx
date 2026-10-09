import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";

/** Marketing header (landing + login). */
export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/#how" className="hidden text-ink-muted hover:text-ink sm:inline">
            How It Works
          </Link>
          {signedIn ? (
            <LinkButton href="/app" size="xs">
              Open dashboard
            </LinkButton>
          ) : (
            <>
              <Link href="/login" className="hidden text-ink-muted hover:text-ink sm:inline">
                Sign In
              </Link>
              <LinkButton href="/login?intent=new" size="xs">
                Start tracking
              </LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
