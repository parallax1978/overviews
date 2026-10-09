import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiLogInsert } from "@/lib/types";

/**
 * Record one external API call. Never throws: a logging failure must not
 * break a capture or an analysis.
 */
export async function logApiCall(admin: SupabaseClient, entry: ApiLogInsert): Promise<void> {
  try {
    const { error } = await admin.from("api_log").insert({
      tracker_id: entry.tracker_id ?? null,
      provider: entry.provider,
      endpoint: entry.endpoint,
      status: entry.status,
      cost_usd: entry.cost_usd,
      duration_ms: entry.duration_ms,
      error: entry.error ?? null,
    });
    if (error) console.error("api_log insert failed", error.message);
  } catch (err) {
    console.error("api_log insert threw", err);
  }
}

/** Claude Opus 5.5 list prices, USD per million tokens. */
export const OPUS_55_PRICING = {
  input: 4,
  output: 20,
  cacheWrite: 5,
  cacheRead: 0.2,
};

export interface TokenUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Estimate the dollar cost of one Anthropic response from its usage block. */
export function estimateAnthropicCost(usage: TokenUsageLike | null | undefined): number {
  if (!usage) return 0;
  const p = OPUS_55_PRICING;
  const cost =
    ((usage.input_tokens ?? 0) * p.input +
      (usage.output_tokens ?? 0) * p.output +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
