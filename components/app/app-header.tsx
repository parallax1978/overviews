import Link from "next/link";
import { Coins, Plus } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/button";
import { creditsLabel, isPlanActive, type PlanId } from "@/lib/plans";

export interface AppHeaderProps {
  email: string | null;
  plan: PlanId;
  subscriptionStatus: string | null;
  credits: number;
}

/** What the plan chip says: credits on an active plan, else the plan. */
function planChipLabel({ plan, subscriptionStatus, credits }: Omit<AppHeaderProps, "email">): string {
  if (plan === "staff") return "Staff";
  if (isPlanActive({ plan, subscription_status: subscriptionStatus })) return creditsLabel(credits);
  return "Free plan";
}

/** Header for the signed-in area. Sign out posts to /auth/signout. */
export function AppHeader({ email, plan, subscriptionStatus, credits }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Logo href="/app" />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/app" className="hidden text-ink-muted hover:text-ink sm:inline">
            Keywords
          </Link>
          <Link href="/app/settings" className="hidden text-ink-muted hover:text-ink md:inline">
            Settings
          </Link>
          <Link
            href="/app/billing"
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-faint px-2.5 py-1 text-xs font-semibold text-brand-strong hover:bg-brand-soft"
            title="Your plan and credits"
          >
            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
            {planChipLabel({ plan, subscriptionStatus, credits })}
          </Link>
          {email ? (
            <span className="hidden max-w-[180px] truncate text-ink-soft lg:inline" title={email}>
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
