import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Eyebrow } from "@/components/ui/eyebrow";
import { NewKeywordForm } from "./new-keyword-form";

export const metadata: Metadata = { title: "New keyword" };

/** The day-1 capture (several samples, up to a minute) runs inside this page's server action. */
// The day-1 capture runs inside the form action: SAMPLES_PER_DAY DataForSEO requests, with retries.
export const maxDuration = 120;

/** "Add keyword" screen. `?keyword=` (from the landing page input) prefills the search box. */
export default async function NewKeywordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { keyword } = await searchParams;
  const raw = Array.isArray(keyword) ? keyword[0] : keyword;
  const initialKeyword = (raw ?? "").trim().slice(0, 200);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/app"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Your keywords
      </Link>

      <div className="mt-6">
        <Eyebrow>New keyword</Eyebrow>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">
          What search do you want to win?
        </h1>
        <p className="mt-2 text-ink-muted">
          Pick a search that already shows an AI Overview. Buying-intent searches work best.
        </p>
      </div>

      <div className="mt-8">
        <NewKeywordForm initialKeyword={initialKeyword} />
      </div>
    </div>
  );
}
