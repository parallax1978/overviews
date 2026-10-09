#!/usr/bin/env node
/**
 * Runs the daily capture by hand: calls GET /api/cron/capture on a running
 * app with the cron secret and prints the JSON summary.
 *
 *   node scripts/capture-now.mjs
 *   APP_URL=https://overviews.example.com node scripts/capture-now.mjs
 *
 * Reads CRON_SECRET (and APP_URL) from the environment or .env.local.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env.local or the environment.");
  process.exit(1);
}

const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const url = `${base}/api/cron/capture`;
console.log(`GET ${url}`);

const startedAt = Date.now();
let response;
try {
  response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
} catch (err) {
  console.error(`Request failed: ${err instanceof Error ? err.message : err}`);
  console.error("Is the app running? Start it with `npm run dev` or set APP_URL.");
  process.exit(1);
}

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(`HTTP ${response.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
process.exit(response.ok ? 0 : 1);
