import Link from "next/link";
import { Plus } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";

/** Header for the signed-in area. Sign out posts to /auth/signout. */
export function AppHeader({ email }: { email: string | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo href="/app" />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/app" className="hidden text-ink-muted hover:text-ink sm:inline">
            Keywords
          </Link>
          {email ? (
            <span className="hidden max-w-[180px] truncate text-ink-soft md:inline" title={email}>
              {email}
            </span>
          ) : null}
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-ink-muted hover:text-ink">
              Sign out
            </button>
          </form>
          <LinkButton href="/app/new" size="xs">
            <Plus className="h-3.5 w-3.5" />
            Add keyword
          </LinkButton>
        </nav>
      </div>
    </header>
  );
}
