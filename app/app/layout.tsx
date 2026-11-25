import type { ReactNode } from "react";
import { after } from "next/server";
import { AppHeader } from "@/components/app/app-header";
import { Footer } from "@/components/site/footer";
import { requireUser } from "@/lib/auth";
import { addUserToMailingList } from "@/lib/getresponse";
import { createClient } from "@/lib/supabase/server";
import type { Account } from "@/lib/types";

type HeaderAccount = Pick<Account, "plan" | "subscription_status" | "credits_balance" | "marketing_synced_at">;

/** Shell for the signed-in area: header with the plan, credits and email, the page, then the footer. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const supabase = await createClient();
  // Read through RLS: a user only ever sees their own account row. No row yet means the free plan.
  const { data } = await supabase
    .from("accounts")
    .select("plan, subscription_status, credits_balance, marketing_synced_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const account: HeaderAccount = (data as HeaderAccount | null) ?? {
    plan: "free",
    subscription_status: null,
    credits_balance: 0,
    marketing_synced_at: null,
  };
  // New users join the GetResponse list once, after the page is sent (never slows it down).
  if (!account.marketing_synced_at) after(() => addUserToMailingList({ id: user.id, email: user.email }));

  return (
    <>
      <AppHeader
        email={user.email}
        plan={account.plan}
        subscriptionStatus={account.subscription_status}
        credits={account.credits_balance}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <Footer />
    </>
  );
}
