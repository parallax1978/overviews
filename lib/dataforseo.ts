/**
 * DataForSEO SERP client: one live Google search with the AI Overview loaded.
 * Docs: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
 */
import { serverEnv } from "@/lib/env";
import { findAiOverviewItem, normalizeAiOverview } from "@/lib/overview";

/** Endpoint path recorded in api_log rows. */
export const DATAFORSEO_ENDPOINT = "serp/google/organic/live/advanced";

const API_URL = `https://api.dataforseo.com/v3/${DATAFORSEO_ENDPOINT}`;
const TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 1_500;
const OK = 20000;

/** Thrown for DataForSEO status codes other than 20000, HTTP 5xx after retry, and network failures (statusCode 0). */
export class DataForSeoError extends Error {
  statusCode: number;
  statusMessage: string;

  constructor(statusCode: number, statusMessage: string) {
    super(`DataForSEO error ${statusCode}: ${statusMessage}`);
    this.name = "DataForSeoError";
    this.statusCode = statusCode;
    this.statusMessage = statusMessage;
  }
}

export interface CaptureRequest {
  keyword: string;
  location_code: number;
  language_code: string;
  device: "desktop" | "mobile";
}

export interface CaptureResult {
  hasOverview: boolean;
  /** The `ai_overview` SERP item, untouched. */
  aiOverviewItem: unknown | null;
  /** USD charged for this request (tasks[0].cost). */
  cost: number;
  statusCode: number;
  statusMessage: string;
  /** The full tasks[0].result[0] object (items, item_types, check_url, ...). */
  raw: unknown;
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The single task object sent to DataForSEO for one capture. */
export function buildSerpTask(req: CaptureRequest): Record<string, unknown> {
  return {
    keyword: req.keyword,
    location_code: req.location_code,
    language_code: req.language_code,
    device: req.device,
    os: req.device === "desktop" ? "windows" : "android",
    depth: 10,
    load_async_ai_overview: true,
  };
}

/** Runs one live SERP request and returns the AI Overview item plus cost. Retries once on network errors and HTTP 5xx. */
export async function fetchSerpWithAiOverview(req: CaptureRequest): Promise<CaptureResult> {
  const auth = Buffer.from(`${serverEnv.dataforseoLogin}:${serverEnv.dataforseoPassword}`).toString(
    "base64",
  );
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify([buildSerpTask(req)]),
    cache: "no-store",
  };

  const response = await postWithRetry(init);
  const json: unknown = await response.json().catch(() => null);
  if (!isDict(json)) {
    throw new DataForSeoError(response.status, `Unexpected response (HTTP ${response.status})`);
  }

  const topStatus = Number(json.status_code);
  if (topStatus !== OK) {
    throw new DataForSeoError(topStatus || response.status, String(json.status_message ?? "Request failed"));
  }

  const task = Array.isArray(json.tasks) ? json.tasks[0] : null;
  if (!isDict(task)) throw new DataForSeoError(topStatus, "No task in response");

  const taskStatus = Number(task.status_code);
  const taskMessage = String(task.status_message ?? "");
  if (taskStatus !== OK) throw new DataForSeoError(taskStatus, taskMessage || "Task failed");

  const result = Array.isArray(task.result) ? task.result[0] : null;
  const aiOverviewItem = findAiOverviewItem(json);
  const cost = Number(task.cost);

  return {
    hasOverview: normalizeAiOverview(aiOverviewItem).hasOverview,
    aiOverviewItem,
    cost: Number.isFinite(cost) ? cost : 0,
    statusCode: taskStatus,
    statusMessage: taskMessage,
    raw: isDict(result) ? result : null,
  };
}

/** POST with a 90s timeout; retries once after 1.5s on a network error or HTTP 5xx. */
async function postWithRetry(init: RequestInit): Promise<Response> {
  let lastError: DataForSeoError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS);
    try {
      const response = await postOnce(init);
      if (response.status < 500) return response;
      lastError = new DataForSeoError(response.status, `HTTP ${response.status} from DataForSEO`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof Error && err.name === "AbortError";
      lastError = new DataForSeoError(0, timedOut ? `Request timed out after ${TIMEOUT_MS / 1000}s` : reason);
    }
  }
  throw lastError ?? new DataForSeoError(0, "Request failed");
}

async function postOnce(init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(API_URL, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
