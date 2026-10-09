/**
 * Runs the real Claude analysis and draft calls on the saved DataForSEO
 * response, without touching the database. Use it to verify the Anthropic
 * integration end to end (costs about $0.50 to $0.80).
 *
 *   npx tsx scripts/analyze-fixture.ts [path/to/fixture.json]
 *
 * Reads ANTHROPIC_API_KEY (and optional ANTHROPIC_WORKSPACE_ID) from .env.local.
 * Writes the outputs next to the fixture as *.analysis.json and *.draft.json.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main() {
  const fixture = process.argv[2] ?? path.join(root, "tests/fixtures/dataforseo-ai-overview.real.json");
  const { findAiOverviewItem, normalizeAiOverview } = await import("../lib/overview");
  const { analyzeOverviews, writeDraft } = await import("../lib/claude");

  const raw = JSON.parse(readFileSync(fixture, "utf8"));
  const overview = normalizeAiOverview(findAiOverviewItem(raw));
  if (!overview.hasOverview) throw new Error("Fixture has no AI Overview");

  const keyword = String(raw?.tasks?.[0]?.data?.keyword ?? "best form builder");
  console.log(
    `Analyzing "${keyword}" from ${path.relative(root, fixture)} (1 day, 1 sample, ${overview.references.length} sources)`,
  );

  const started = Date.now();
  const analysis = await analyzeOverviews(
    {
      keyword,
      locationName: "United States",
      languageCode: "en",
      targetDomain: null,
      userEdge: null,
      snapshots: [
        {
          day_number: 1,
          sample: 1,
          captured_at: new Date().toISOString(),
          has_overview: true,
          overview_text: overview.text,
          overview_markdown: overview.markdown,
          references: overview.references,
          inline_links: overview.inlineLinks,
        },
      ],
    },
    { onStep: (step) => console.log(`  [${Math.round((Date.now() - started) / 1000)}s] ${step}`) },
  );
  const analysisSeconds = Math.round((Date.now() - started) / 1000);
  const analysisOut = fixture.replace(/\.json$/, ".analysis.json");
  writeFileSync(analysisOut, JSON.stringify(analysis, null, 2));
  console.log(
    `Analysis done in ${analysisSeconds}s. model=${analysis.model} usage=${JSON.stringify(analysis.usage)}`,
  );
  const { patterns, citation_research: research } = analysis;
  console.log(
    `  claims=${patterns.recurring_claims.length} entities=${patterns.repeated_entities.length} sources=${patterns.frequent_sources.length} research=${research.length} fetched=${research.filter((c) => c.fetched).length} sections=${analysis.blueprint.sections.length}`,
  );
  // With one sample every count should be 1; anything else means Claude guessed.
  console.log(
    `  samples_present: claims=[${patterns.recurring_claims.map((c) => c.samples_present).join(",")}] entities=[${patterns.repeated_entities.map((e) => e.samples_present).join(",")}]` +
      ` samples_cited: sources=[${patterns.frequent_sources.map((s) => s.samples_cited).join(",")}] research=[${research.map((c) => c.samples_cited).join(",")}]`,
  );
  console.log(`  summary_md words=${analysis.summary_md.split(/\s+/).length}`);

  const draftStarted = Date.now();
  const draft = await writeDraft({
    keyword,
    blueprint: analysis.blueprint,
    patterns: analysis.patterns,
    citationResearch: analysis.citation_research,
    stableCore: analysis.patterns.stable_core,
    userEdge: null,
    targetDomain: null,
    notes: null,
    previousDraft: null,
  });
  const draftOut = fixture.replace(/\.json$/, ".draft.json");
  writeFileSync(draftOut, JSON.stringify(draft, null, 2));
  console.log(
    `Draft done in ${Math.round((Date.now() - draftStarted) / 1000)}s. model=${draft.model} usage=${JSON.stringify(draft.usage)}`,
  );
  console.log(
    `  title="${draft.title}" words=${draft.content_md.split(/\s+/).length} placeholders=${(draft.content_md.match(/\[ADD YOUR DATA:/g) ?? []).length} outline=${draft.outline.length}`,
  );
  console.log(`Wrote ${path.relative(root, analysisOut)} and ${path.relative(root, draftOut)}`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
