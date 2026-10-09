import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/app-header";
import { Footer } from "@/components/site/footer";
import { requireUser } from "@/lib/auth";

/** Shell for the signed-in area: header with the user's email, the page, then the footer. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <Footer />
    </>
  );
}
