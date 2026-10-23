/**
 * Builds the report and the draft for one tracker, exactly as the app does
 * (same Claude calls, same database writes). For operators: validating a
 * prompt change on a real keyword, or re-running a report by hand.
 *
 *   npx tsx --conditions=react-server scripts/run-analysis.ts <tracker-id> [--draft-only] [--mode=researched|placeholders]
 *
 * --mode picks the draft: "researched" (default) searches the web for every
 * figure and cites it, ready to publish; "placeholders" leaves
 * [ADD YOUR DATA: ...] marks for the author's own data and does no research.
 *
 * The react-server condition makes the "server-only" guard in lib/supabase/admin.ts
 * resolve to its empty build, which is what a Node script needs.
 *
 * Reads Supabase and Anthropic settings from .env.local. Costs about $0.60
 * for the report, $0.25 for a placeholders draft and more for a researched
 * one (up to 10 web searches at $0.01 each, plus the pages it reads).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const USAGE =
  "Usage: npx tsx --conditions=react-server scripts/run-analysis.ts <tracker-id> [--draft-only] [--mode=researched|placeholders]";

function parseMode(argv: string[]): "researched" | "placeholders" {
  const flag = argv.find((arg) => arg.startsWith("--mode="));
  const value = flag ? flag.slice("--mode=".length) : "researched";
  if (value === "researched" || value === "placeholders") return value;
  throw new Error(`Unknown --mode "${value}". ${USAGE}`);
}

async function main() {
  const trackerId = process.argv[2];
  const draftOnly = process.argv.includes("--draft-only");
  const mode = parseMode(process.argv);
  if (!trackerId || trackerId.startsWith("--")) throw new Error(USAGE);

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
  console.log(`Writing the page (${mode})…`);
  const draft = await regenerateDraft(trackerId, null, mode);
  console.log(`Draft done in ${Math.round((Date.now() - started) / 1000)}s (draft ${draft.id}, ${draft.mode}): "${draft.title}"`);
  const words = draft.content_md?.split(/\s+/).length ?? 0;
  const placeholders = (draft.content_md?.match(/\[ADD YOUR DATA:/g) ?? []).length;
  if (draft.mode === "researched") {
    // A researched draft should cite and never leave a placeholder; print both so a prompt regression shows.
    console.log(`  ${words} words, ${draft.sources?.length ?? 0} sources, ${placeholders} placeholders`);
  } else {
    console.log(`  ${words} words, ${placeholders} placeholders`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
