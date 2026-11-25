/**
 * Replaces Google redirect links (https://google.com/goto?url=...) stored in
 * snapshots before lib/google-redirect.ts resolved them at capture time, or
 * that Google wouldn't resolve then. Also recomputes the day-to-day changes of
 * the keywords it touched, and swaps the same links inside their reports.
 * Safe to run again: links that still won't resolve are left as they are.
 *
 *   npx tsx --conditions=react-server scripts/resolve-google-links.ts [--dry-run]
 *
 * Reads Supabase settings from .env.local (or the environment).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

type Row = Record<string, unknown>;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { isGoogleRedirect, resolveGoogleRedirect, resolveOverviewLinks } = await import("@/lib/google-redirect");
  const { normalizeUrl } = await import("@/lib/overview");
  const { computeDayDiff } = await import("@/lib/diff");
  const { domainFromUrl } = await import("@/lib/utils");
  const admin = createAdminClient();

  // 1. Snapshots with a redirect link anywhere (a few thousand rows at most: filtered here).
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("snapshots")
      .select("id, tracker_id, day_number, sample, references, inline_links, overview_markdown")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]).filter((r) => JSON.stringify(r).includes("google.com/goto")));
    if ((data ?? []).length < 1000) break;
  }

  const destination = new Map<string, string>();
  const touchedTrackers = new Set<string>();
  let found = 0;
  let resolved = 0;
  for (const row of rows) {
    const before = {
      references: (row.references ?? []) as never[],
      inlineLinks: (row.inline_links ?? []) as never[],
      markdown: (row.overview_markdown as string | null) ?? null,
    };
    const after = await resolveOverviewLinks(before);
    if (after.found === 0) continue;
    found += after.found;
    resolved += after.resolved;
    // Remember each redirect's page for the reports below.
    for (const [from, to] of after.destinations) destination.set(from, to);
    if (after.resolved === 0) continue;
    touchedTrackers.add(row.tracker_id as string);
    console.log(`snapshot ${row.id} (day ${row.day_number}, sample ${row.sample}): ${after.resolved} of ${after.found} resolved`);
    if (!dryRun) {
      const { error: updateError } = await admin
        .from("snapshots")
        .update({ references: after.references, inline_links: after.inlineLinks, overview_markdown: after.markdown })
        .eq("id", row.id as string);
      if (updateError) throw new Error(updateError.message);
    }
  }

  // 2. The day-to-day changes compare citations by address: recompute them for the keywords touched.
  for (const trackerId of touchedTrackers) {
    const { data: samples, error: samplesError } = await admin
      .from("snapshots")
      .select("id, day_number, sample, overview_text, references, diff")
      .eq("tracker_id", trackerId)
      .order("day_number")
      .order("sample");
    if (samplesError) throw new Error(samplesError.message);
    const byDay = new Map<number, Row[]>();
    for (const s of (samples ?? []) as Row[]) {
      const day = s.day_number as number;
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    const comparable = (s: Row) => ({ text: (s.overview_text as string | null) ?? null, references: (s.references ?? []) as never[] });
    for (const [day, daySamples] of byDay) {
      const previous = byDay.get(day - 1);
      const diff = computeDayDiff(previous ? previous.map(comparable) : null, daySamples.map(comparable));
      if (!dryRun) {
        const { error: diffError } = await admin.from("snapshots").update({ diff }).eq("id", daySamples[0].id as string);
        if (diffError) throw new Error(diffError.message);
      }
    }
    console.log(`keyword ${trackerId}: day changes recomputed for ${byDay.size} days`);
  }

  // 3. Reports that name a redirect link: point them at the pages too.
  const { data: analyses, error: analysesError } = await admin.from("analyses").select("id, patterns, citation_research");
  if (analysesError) throw new Error(analysesError.message);
  for (const analysis of ((analyses ?? []) as Row[]).filter((a) => JSON.stringify(a).includes("google.com/goto"))) {
    let changed = 0;
    const fix = async (item: { url?: string; domain?: string }) => {
      if (!item.url || !isGoogleRedirect(item.url)) return;
      const target = destination.get(item.url) ?? (await resolveGoogleRedirect(item.url).then((t) => (t ? normalizeUrl(t) : null)));
      if (!target) return;
      item.url = target;
      item.domain = domainFromUrl(target);
      changed++;
    };
    const research = (analysis.citation_research ?? []) as { url?: string; domain?: string }[];
    for (const item of research) await fix(item);
    const patterns = (analysis.patterns ?? {}) as { frequent_sources?: { url?: string; domain?: string }[] };
    for (const item of patterns.frequent_sources ?? []) await fix(item);
    if (changed === 0) continue;
    console.log(`report ${analysis.id}: ${changed} links pointed at their pages`);
    if (!dryRun) {
      const { error: updateError } = await admin
        .from("analyses")
        .update({ citation_research: research, patterns })
        .eq("id", analysis.id as string);
      if (updateError) throw new Error(updateError.message);
    }
  }

  console.log(`${dryRun ? "[dry run] " : ""}${resolved} of ${found} redirect links resolved.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
