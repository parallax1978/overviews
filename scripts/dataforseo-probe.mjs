#!/usr/bin/env node
/**
 * Probes DataForSEO for one keyword and reports whether Google showed an
 * AI Overview. Same request as lib/dataforseo.ts, no app code imported.
 *
 *   node scripts/dataforseo-probe.mjs "best form builder"
 *   node scripts/dataforseo-probe.mjs "best form builder" --save
 *   node scripts/dataforseo-probe.mjs "best form builder" --location 2826 --language en --device mobile
 *
 * --save writes the raw response to tests/fixtures/dataforseo-ai-overview.real.json
 * so the unit tests can run against a real capture.
 *
 * Reads DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD from the environment or .env.local.
 * Costs about $0.004 per run.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const options = { save: false, location: 2840, language: "en", device: "desktop" };
const words = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--save") options.save = true;
  else if (arg === "--location") options.location = Number(args[++i]);
  else if (arg === "--language") options.language = String(args[++i]);
  else if (arg === "--device") options.device = String(args[++i]);
  else words.push(arg);
}
const keyword = words.join(" ").trim();

if (!keyword) {
  console.error('Usage: node scripts/dataforseo-probe.mjs "<keyword>" [--save] [--location 2840] [--language en] [--device desktop|mobile]');
  process.exit(1);
}
if (!["desktop", "mobile"].includes(options.device)) {
  console.error("--device must be desktop or mobile");
  process.exit(1);
}

const login = process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_PASSWORD;
if (!login || !password) {
  console.error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set (see .env.example).");
  process.exit(1);
}

const task = {
  keyword,
  location_code: options.location,
  language_code: options.language,
  device: options.device,
  os: options.device === "desktop" ? "windows" : "android",
  depth: 10,
  load_async_ai_overview: true,
};

console.log(`Searching "${keyword}" (location ${task.location_code}, ${task.language_code}, ${task.device})...`);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 90_000);
const startedAt = Date.now();
let response;
try {
  response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([task]),
    signal: controller.signal,
  });
} catch (err) {
  console.error(`Request failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

const json = await response.json().catch(() => null);
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
if (!json) {
  console.error(`HTTP ${response.status}: response was not JSON`);
  process.exit(1);
}
if (json.status_code !== 20000) {
  console.error(`DataForSEO error ${json.status_code}: ${json.status_message}`);
  process.exit(1);
}

const taskResult = json.tasks?.[0];
if (!taskResult || taskResult.status_code !== 20000) {
  console.error(`Task error ${taskResult?.status_code}: ${taskResult?.status_message}`);
  process.exit(1);
}

const result = taskResult.result?.[0] ?? {};
const items = Array.isArray(result.items) ? result.items : [];
const aiOverview = items.find((item) => item && item.type === "ai_overview") ?? null;

console.log(`Done in ${seconds}s. Cost: $${Number(taskResult.cost ?? 0).toFixed(4)}`);
console.log(`SERP item types: ${(result.item_types ?? []).join(", ") || "(none)"}`);
console.log(`Check URL: ${result.check_url ?? "(none)"}`);

if (!aiOverview) {
  console.log("AI Overview: not shown for this search.");
} else {
  const elements = Array.isArray(aiOverview.items) ? aiOverview.items : [];
  const typeCounts = new Map();
  for (const element of elements) {
    const type = element?.type ?? "unknown";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }
  const elementRefs = elements.reduce((sum, element) => {
    const own = Array.isArray(element?.references) ? element.references.length : 0;
    const components = Array.isArray(element?.components) ? element.components : [];
    const nested = components.reduce(
      (n, c) => n + (Array.isArray(c?.references) ? c.references.length : 0),
      0,
    );
    return sum + own + nested;
  }, 0);
  const topRefs = Array.isArray(aiOverview.references) ? aiOverview.references.length : 0;

  console.log(`AI Overview: yes (asynchronous_ai_overview=${aiOverview.asynchronous_ai_overview ?? "n/a"})`);
  console.log(
    `Elements: ${elements.length}` +
      (typeCounts.size ? ` (${[...typeCounts].map(([t, n]) => `${t} x${n}`).join(", ")})` : ""),
  );
  console.log(`References: ${elementRefs} in elements + ${topRefs} top-level`);
}

if (options.save) {
  const file = path.join(root, "tests", "fixtures", "dataforseo-ai-overview.real.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(json, null, 2));
  console.log(`Saved raw response to ${path.relative(root, file)}`);
}
