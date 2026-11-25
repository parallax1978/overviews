import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe } from "lucide-react";
import { DraftView, type DraftVersions } from "@/components/app/draft-view";
import { ReportBody } from "@/components/app/report-view";
import { Footer } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { Eyebrow } from "@/components/ui/eyebrow";
import { getUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Analysis, Draft, DraftMode, Tracker } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared report",
  // Shared links are for the people they were sent to, not for search engines.
  robots: { index: false, follow: false },
};

/** Share tokens are 32 URL-safe characters (24 random bytes). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/**
 * GET /share/[token]: a keyword's newest report and the pages written from it,
 * read-only, for anyone with the link. The owner turns the link on and off on
 * the keyword page. Read with the service role by the token; nothing else of
 * the account is shown.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();

  const admin = createAdminClient();
  const { data: trackerRow } = await admin
    .from("trackers")
    .select("id, keyword, location_name, share_token")
    .eq("share_token", token)
    .maybeSingle();
  const tracker = trackerRow as Pick<Tracker, "id" | "keyword" | "location_name" | "share_token"> | null;
  if (!tracker) notFound();

  const { data: reportRow } = await admin
    .from("analyses")
    .select("*")
    .eq("tracker_id", tracker.id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const report = (reportRow as Analysis | null) ?? null;
  if (!report) notFound();

  const { data: draftRows } = await admin
    .from("drafts")
    .select("*")
    .eq("tracker_id", tracker.id)
    .eq("analysis_id", report.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const drafts: DraftVersions = { researched: null, placeholders: null };
  for (const row of (draftRows ?? []) as Draft[]) {
    const mode: DraftMode = row.mode === "researched" ? "researched" : "placeholders";
    if (!drafts[mode]) drafts[mode] = row;
  }
  const hasDraft = Boolean(drafts.researched || drafts.placeholders);
  const user = await getUser();

  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Eyebrow>Shared report</Eyebrow>
        <h1 className="mt-2 max-w-full break-words text-3xl font-bold tracking-tight text-ink">{tracker.keyword}</h1>
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-muted">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {tracker.location_name}
        </p>

        <div className="mt-8">
          <ReportBody
            tracker={tracker}
            analysis={report}
            snapshotsWithOverview={report.samples_total ?? 0}
            daysWithOverview={report.days_total ?? 0}
            draftHref={hasDraft ? "#page" : undefined}
          />
        </div>

        {hasDraft ? (
          <section id="page" className="mt-12 scroll-mt-24">
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-ink">The page we wrote</h2>
            <DraftView trackerId={tracker.id} keyword={tracker.keyword} drafts={drafts} canRegenerate={false} readOnly />
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}
