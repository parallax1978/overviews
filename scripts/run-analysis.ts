/**
 * Builds the report and the draft for one tracker, exactly as the app does
 * (same Claude calls, same database writes). For operators: validating a
 * prompt change on a real keyword, or re-running a report by hand.
 *
 *   npx tsx scripts/run-analysis.ts <tracker-id> [--draft-only]
 *
 * Reads Supabase and Anthropic settings from .env.local. Costs about $0.60
 * for the report and $0.25 for the draft.
 */
import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
// lib/analyze.ts pulls in the admin Supabase client, which is marked server-only.
register("./_server-only-shim.mjs", import.meta.url);

async function main() {
  const trackerId = process.argv[2];
  const draftOnly = process.argv.includes("--draft-only");
  if (!trackerId) throw new Error("Usage: npx tsx scripts/run-analysis.ts <tracker-id> [--draft-only]");

  const { regenerateDraft, runAnalysis } = await import("../lib/analyze");

  if (!draftOnly) {
    const started = Date.now();
    console.log(`Building the report for ${trackerId}…`);
    const analysis = await runAnalysis(trackerId);
    console.log(
      `Report done in ${Math.round((Date.now() - started) / 1000)}s (analysis ${analysis.id}, ${analysis.samples_total} samples over ${analysis.days_total} days)`,
    );
    const b = analysis.blueprint;
    if (b) {
      console.log(`  winning angle: ${b.winning_angle}`);
      console.log(`  gaps to fill: ${b.gaps_to_fill.length} · contradictions: ${b.contradictions_to_settle.length} · terms: ${b.terms_to_cover.length} · brands named: ${b.brands_google_names.length}`);
    }
  }

  const started = Date.now();
  console.log("Writing the page…");
  const draft = await regenerateDraft(trackerId, null);
  console.log(`Draft done in ${Math.round((Date.now() - started) / 1000)}s (draft ${draft.id}): "${draft.title}"`);
  console.log(`  ${draft.content_md?.split(/\s+/).length ?? 0} words, ${(draft.content_md?.match(/\[ADD YOUR DATA:/g) ?? []).length} placeholders`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
