/**
 * The two Claude calls: analyze the captured AI Overviews (with web_fetch on
 * the most-cited pages) and write the page (with web_search and web_fetch when
 * the draft is researched). Both stream, use adaptive thinking, server-side
 * refusal fallbacks and structured outputs, and validate the JSON with zod
 * before anything is stored.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { domainFromUrl, pluralize } from "@/lib/utils";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  buildDraftUserPrompt,
  draftSystemPrompt,
  type AnalysisInput,
  type AnalysisSnapshotInput,
  type CandidateUrl,
  type DraftInput,
} from "@/lib/prompts";
import type { AnalysisPatterns, CitationResearchItem, DraftSource, PageBlueprint } from "@/lib/types";

export type { AnalysisInput, AnalysisSnapshotInput, CandidateUrl, DraftInput } from "@/lib/prompts";

export const CLAUDE_MODEL = "claude-opus-5-5";
/** How many of the most-cited pages the analysis call is asked to fetch. */
export const MAX_FETCH_CANDIDATES = 8;

/** How many web searches and page fetches a researched draft may spend on its figures. */
export const DRAFT_MAX_SEARCHES = 10;
export const DRAFT_MAX_FETCHES = 10;
/** Web search list price: $10 per 1,000 searches. Web fetch is free. */
export const WEB_SEARCH_COST_USD = 0.01;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/**
 * max_tokens covers everything one turn generates: the thinking before every
 * web_fetch / web_search call, the tools' input, interim text, and only then
 * the JSON answer, written last. A research loop can spend 20-30k tokens before
 * the page, so give the answer room. Both calls stream, so no timeout is
 * involved, and room left unused costs nothing.
 */
const ANALYSIS_MAX_TOKENS = 64000;
const DRAFT_MAX_TOKENS = 64000;
/** Server tools pause the turn after ~10 tool iterations; we resume this many times at most. */
const MAX_PAUSE_RESUMES = 3;

let client: Anthropic | null = null;

/** Anthropic client, created on first use so importing this module never needs the API key. */
function getClient(): Anthropic {
  if (!client) {
    const workspaceId = serverEnv.anthropicWorkspaceId;
    client = new Anthropic({
      apiKey: serverEnv.anthropicApiKey,
      // User-scoped keys must name the workspace to bill; workspace keys ignore this.
      ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
    });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Schemas. These must match lib/types.ts key for key; `satisfies` enforces
// that every parsed object is assignable to the domain type.
// ---------------------------------------------------------------------------

export const PatternsSchema = z.object({
  recurring_claims: z.array(
    z.object({
      claim: z.string(),
      samples_present: z.number().int(),
      days_present: z.number().int(),
      example: z.string(),
    }),
  ),
  repeated_entities: z.array(
    z.object({
      entity: z.string(),
      samples_present: z.number().int(),
      days_present: z.number().int(),
      role: z.string(),
    }),
  ),
  formats: z.object({
    opening: z.string(),
    structure: z.string(),
    uses_table: z.boolean(),
    uses_list: z.boolean(),
    typical_length_words: z.number().int(),
  }),
  frequent_sources: z.array(
    z.object({
      domain: z.string(),
      url: z.string(),
      samples_cited: z.number().int(),
      days_cited: z.number().int(),
      cited_for: z.string(),
    }),
  ),
  differences: z.array(z.object({ day: z.number().int(), what_changed: z.string() })),
  stable_core: z.string(),
}) satisfies z.ZodType<AnalysisPatterns>;

export const CitationResearchItemSchema = z.object({
  url: z.string(),
  domain: z.string(),
  samples_cited: z.number().int(),
  days_cited: z.number().int(),
  fetched: z.boolean(),
  answers_how_fast: z.string(),
  topics_covered: z.array(z.string()),
  entities_covered: z.array(z.string()),
  structure: z.string(),
  uses_tables: z.boolean(),
  uses_lists: z.boolean(),
  data_included: z.array(z.string()),
  gaps: z.array(z.string()),
  how_to_beat: z.string(),
}) satisfies z.ZodType<CitationResearchItem>;

export const BlueprintSchema = z.object({
  page_goal: z.string(),
  target_question: z.string(),
  winning_angle: z.string(),
  gaps_to_fill: z.array(z.object({ gap: z.string(), found_in: z.string() })),
  contradictions_to_settle: z.array(z.object({ topic: z.string(), what_sources_say: z.string() })),
  must_cover: z.array(z.object({ topic: z.string(), why: z.string() })),
  terms_to_cover: z.array(z.string()),
  brands_google_names: z.array(z.string()),
  recommended_format: z.string(),
  opening_answer: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      purpose: z.string(),
      format: z.enum(["paragraph", "table", "list", "faq"]),
    }),
  ),
  something_new: z.array(z.object({ idea: z.string(), why_google_would_cite_it: z.string() })),
}) satisfies z.ZodType<PageBlueprint>;

/** Structured output of the analysis call. */
export const AnalysisSchema = z.object({
  patterns: PatternsSchema,
  citation_research: z.array(CitationResearchItemSchema),
  blueprint: BlueprintSchema,
  summary_md: z.string(),
});

export const DraftSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  used_for: z.string(),
}) satisfies z.ZodType<DraftSource>;

/** Structured output of the draft call. `sources` is empty for a placeholders draft. */
export const DraftSchema = z.object({
  title: z.string(),
  meta_description: z.string(),
  h1: z.string(),
  outline: z.array(z.object({ heading: z.string(), summary: z.string() })),
  content_md: z.string(),
  why_better_md: z.string(),
  sources: z.array(DraftSourceSchema),
});

export type AnalysisOutput = z.infer<typeof AnalysisSchema> & {
  usage: Anthropic.Beta.BetaUsage;
  model: string;
};

export type DraftOutput = z.infer<typeof DraftSchema> & {
  usage: Anthropic.Beta.BetaUsage;
  model: string;
};

export interface AnalysisHooks {
  /** Called with a short progress label the UI can show. Errors are swallowed. */
  onStep?: (step: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Candidate pages
// ---------------------------------------------------------------------------

/**
 * Every cited URL ranked by the number of distinct samples it was cited in,
 * then by distinct days (ties keep first-seen order), top `limit`. Each
 * snapshot is one sample and counts once, however many times it cites the URL.
 */
export function rankCandidateUrls(
  snapshots: AnalysisSnapshotInput[],
  limit = MAX_FETCH_CANDIDATES,
): CandidateUrl[] {
  const byUrl = new Map<string, CandidateUrl & { samples: Set<number>; days: Set<number> }>();
  for (const [index, snap] of snapshots.entries()) {
    if (!snap.has_overview) continue;
    for (const ref of snap.references ?? []) {
      if (!ref.url) continue;
      let entry = byUrl.get(ref.url);
      if (!entry) {
        entry = {
          url: ref.url,
          domain: ref.domain || domainFromUrl(ref.url),
          title: ref.title ?? null,
          samples_cited: 0,
          days_cited: 0,
          samples: new Set<number>(),
          days: new Set<number>(),
        };
        byUrl.set(ref.url, entry);
      }
      entry.samples.add(index);
      entry.days.add(snap.day_number);
      if (!entry.title && ref.title) entry.title = ref.title;
    }
  }
  return [...byUrl.values()]
    .map(({ samples, days, ...rest }) => ({ ...rest, samples_cited: samples.size, days_cited: days.size }))
    .sort((a, b) => b.samples_cited - a.samples_cited || b.days_cited - a.days_cited)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Shared call machinery
// ---------------------------------------------------------------------------

type BetaMessage = Anthropic.Beta.BetaMessage;
type ContentBlockStart = Anthropic.Beta.BetaRawContentBlockStartEvent["content_block"];

interface StructuredCall<S extends z.ZodType> {
  system: string;
  userPrompt: string;
  schema: S;
  maxTokens: number;
  tools?: Anthropic.Beta.BetaToolUnion[];
  onBlockStart?: (block: ContentBlockStart) => void;
}

interface StructuredResult<T> {
  parsed: T;
  usage: Anthropic.Beta.BetaUsage;
  model: string;
}

/** HTTP status of an Anthropic API error, or null for any other error. */
export function anthropicErrorStatus(err: unknown): number | null {
  return err instanceof Anthropic.APIError && typeof err.status === "number" ? err.status : null;
}

/**
 * True when the API refused the request because of output_config.format itself
 * (unsupported combination, or a schema whose compiled grammar is too large).
 */
function isFormatRejection(err: unknown): boolean {
  return (
    err instanceof Anthropic.BadRequestError &&
    /output_config|output_format|json_schema|structured output|grammar|schema/i.test(err.message)
  );
}

function schemaInstruction(schema: z.ZodType): string {
  return (
    "\n\nRespond with only one JSON object, no code fences, matching this JSON schema exactly:\n" +
    JSON.stringify(z.toJSONSchema(schema))
  );
}

function assertCompleted(message: BetaMessage): void {
  if (message.stop_reason === "refusal") {
    const why = message.stop_details?.explanation;
    throw new Error(`Claude declined this request${why ? `: ${why}` : ""}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Claude ran out of room before finishing. Please try again.");
  }
}

/**
 * The final answer: the trailing run of text blocks. Web-search citations split
 * one answer into several text blocks, so the last block alone may be only the
 * tail of the JSON. Walking back to the first non-text block (a tool call or
 * result, or thinking) leaves out any preamble text. Pure.
 */
export function finalText(message: Pick<BetaMessage, "content">): string {
  const parts: string[] = [];
  for (let i = message.content.length - 1; i >= 0; i--) {
    const block = message.content[i];
    if (block.type !== "text") break;
    parts.unshift(block.text);
  }
  const text = parts.join("").trim();
  if (!text) throw new Error("Claude returned no text");
  return text;
}

/** The JSON object in a text that may hold prose around it (the no-grammar path). Pure. */
export function jsonObjectIn(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}

function parseOutput<S extends z.ZodType>(message: BetaMessage, schema: S): z.infer<S> {
  assertCompleted(message);
  let json: unknown;
  try {
    json = JSON.parse(jsonObjectIn(stripFences(finalText(message))));
  } catch {
    throw new Error("Claude returned something that is not valid JSON");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join(".")}` : "";
    throw new Error(`Claude's answer did not match the expected shape${where}: ${first?.message ?? "unknown"}`);
  }
  return result.data as z.infer<S>;
}

function sumUsage(total: Anthropic.Beta.BetaUsage, next: Anthropic.Beta.BetaUsage): Anthropic.Beta.BetaUsage {
  const tools = total.server_tool_use || next.server_tool_use;
  return {
    ...next,
    input_tokens: total.input_tokens + next.input_tokens,
    output_tokens: total.output_tokens + next.output_tokens,
    cache_creation_input_tokens:
      (total.cache_creation_input_tokens ?? 0) + (next.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (total.cache_read_input_tokens ?? 0) + (next.cache_read_input_tokens ?? 0),
    // Tool counts arrive per response; a resumed turn must keep the earlier ones.
    server_tool_use: tools
      ? {
          web_search_requests:
            (total.server_tool_use?.web_search_requests ?? 0) + (next.server_tool_use?.web_search_requests ?? 0),
          web_fetch_requests:
            (total.server_tool_use?.web_fetch_requests ?? 0) + (next.server_tool_use?.web_fetch_requests ?? 0),
        }
      : null,
  };
}

/** Dollar cost of the web searches in a usage block (fetches are free). Token costs are estimated elsewhere. */
export function webSearchCost(usage: { server_tool_use?: { web_search_requests?: number | null } | null } | null | undefined): number {
  const searches = usage?.server_tool_use?.web_search_requests ?? 0;
  return Math.round(searches * WEB_SEARCH_COST_USD * 1_000_000) / 1_000_000;
}

/** The web_fetch server tool, capped per call. Both Claude calls read pages with it. */
function webFetchTool(opts: { maxUses: number; maxContentTokens: number }): Anthropic.Beta.BetaWebFetchTool20260209 {
  return {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: opts.maxUses,
    max_content_tokens: opts.maxContentTokens,
  };
}

/** The web_search server tool, capped per call. Only a researched draft searches. */
function webSearchTool(opts: { maxUses: number }): Anthropic.Beta.BetaWebSearchTool20260209 {
  return { type: "web_search_20260209", name: "web_search", max_uses: opts.maxUses };
}

/**
 * One streamed, structured call. Resumes `pause_turn` (server tools hit their
 * per-turn limit) by echoing the assistant content back, and falls back to
 * "JSON in the final text" once if the API rejects output_config.format
 * together with the tools in use.
 */
async function runStructured<S extends z.ZodType>(call: StructuredCall<S>): Promise<StructuredResult<z.infer<S>>> {
  const api = getClient();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: call.userPrompt }];
  // Keep only the JSON schema the helper derives: without its parse hook the SDK
  // leaves the final message alone, so refusals and max_tokens stops reach
  // parseOutput() and get the friendly messages below.
  const { type: formatType, schema: formatSchema } = zodOutputFormat(call.schema);
  let outputConfig: Anthropic.Beta.BetaOutputConfig = {
    effort: "high",
    format: { type: formatType, schema: formatSchema },
  };
  let usage: Anthropic.Beta.BetaUsage | null = null;
  let message: BetaMessage | null = null;
  let formatRetried = false;
  let resumes = 0;

  while (true) {
    const stream = api.beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: call.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: outputConfig,
      ...(call.tools ? { tools: call.tools } : {}),
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    if (call.onBlockStart) {
      const onBlockStart = call.onBlockStart;
      stream.on("streamEvent", (event) => {
        if (event.type === "content_block_start") onBlockStart(event.content_block);
      });
    }

    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (!formatRetried && outputConfig.format && isFormatRejection(err)) {
        formatRetried = true;
        outputConfig = { effort: "high" };
        messages[0] = { role: "user", content: call.userPrompt + schemaInstruction(call.schema) };
        continue;
      }
      throw err;
    }

    usage = usage ? sumUsage(usage, message.usage) : message.usage;
    if (message.stop_reason !== "pause_turn" || resumes >= MAX_PAUSE_RESUMES) break;
    resumes += 1;
    messages.push({ role: "assistant", content: message.content });
  }

  return { parsed: parseOutput(message, call.schema), usage: usage ?? message.usage, model: message.model };
}

// ---------------------------------------------------------------------------
// Call 1: analyze
// ---------------------------------------------------------------------------

/** Find the patterns across every sample of every captured day, study the most-cited pages, and build the page blueprint. */
export async function analyzeOverviews(input: AnalysisInput, hooks: AnalysisHooks = {}): Promise<AnalysisOutput> {
  const candidates = rankCandidateUrls(input.snapshots);
  const sampleCount = input.snapshots.length;
  const dayCount = new Set(input.snapshots.map((s) => s.day_number)).size;
  const steps = [
    `Reading ${pluralize(dayCount, "day")} of AI Overviews (${pluralize(sampleCount, "sample")})`,
    `Studying up to ${candidates.length} cited pages`,
    "Finding the patterns",
  ];

  // Progress labels are best-effort and reported in order, one at a time.
  let reached = -1;
  let queue: Promise<void> = Promise.resolve();
  const report = (index: number): Promise<void> => {
    if (index <= reached) return queue;
    reached = index;
    queue = queue
      .then(() => hooks.onStep?.(steps[index]))
      .catch((err) => console.warn("analysis step update failed", err));
    return queue;
  };

  await report(0);
  const { parsed, usage, model } = await runStructured({
    system: ANALYSIS_SYSTEM_PROMPT,
    userPrompt: buildAnalysisUserPrompt(input, candidates),
    schema: AnalysisSchema,
    maxTokens: ANALYSIS_MAX_TOKENS,
    tools: [webFetchTool({ maxUses: MAX_FETCH_CANDIDATES, maxContentTokens: 12000 })],
    onBlockStart: (block) => {
      if (block.type === "server_tool_use") void report(1);
      else if (block.type === "text") void report(2);
    },
  });
  await report(2);
  await hooks.onStep?.("Building the page blueprint");

  return { ...parsed, usage, model };
}

// ---------------------------------------------------------------------------
// Call 2: draft
// ---------------------------------------------------------------------------

/**
 * Write (or, with notes and a previous draft, revise) the page described by
 * the blueprint. A researched draft gets web_search and web_fetch so every
 * figure comes from a page it read and is cited; a placeholders draft gets no
 * tools and marks its figures [ADD YOUR DATA: ...] instead.
 */
export async function writeDraft(input: DraftInput): Promise<DraftOutput> {
  const researched = input.mode === "researched";
  const { parsed, usage, model } = await runStructured({
    system: draftSystemPrompt(input.mode),
    userPrompt: buildDraftUserPrompt(input),
    schema: DraftSchema,
    maxTokens: DRAFT_MAX_TOKENS,
    ...(researched
      ? {
          tools: [
            webSearchTool({ maxUses: DRAFT_MAX_SEARCHES }),
            webFetchTool({ maxUses: DRAFT_MAX_FETCHES, maxContentTokens: 8000 }),
          ],
        }
      : {}),
  });
  // A placeholders draft cites nothing, whatever the model put in the field. A
  // researched draft sometimes lists its sources only in the page's "## Sources"
  // section and leaves the field empty: read them from the page in that case.
  const sources = researched
    ? parsed.sources.length
      ? parsed.sources
      : extractSourcesFromMarkdown(parsed.content_md)
    : [];
  return { ...parsed, sources, usage, model };
}

/**
 * Sources a page cites, read from its "## Sources" section (one Markdown link
 * per bullet, with what it supports after the link). Falls back to every
 * distinct inline link in the page when there is no such section. Pure.
 */
export function extractSourcesFromMarkdown(markdown: string): DraftSource[] {
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const seen = new Map<string, DraftSource>();
  const add = (title: string, url: string, usedFor: string) => {
    if (!seen.has(url)) seen.set(url, { url, title: title.trim(), used_for: usedFor.trim() });
  };

  const match = /^##\s+Sources\s*$/m.exec(markdown);
  if (match) {
    const section = markdown.slice(match.index + match[0].length).split(/^##\s+/m)[0];
    for (const line of section.split("\n")) {
      const bullet = line.trim().replace(/^[-*]\s+/, "");
      const link = new RegExp(linkRe.source).exec(bullet);
      if (!link) continue;
      const rest = bullet.slice(link.index + link[0].length).replace(/^[\s:\u2014\u2013-]+/, "");
      add(link[1], link[2], rest);
    }
  }
  if (seen.size === 0) {
    for (const link of markdown.matchAll(linkRe)) add(link[1], link[2], "");
  }
  return [...seen.values()];
}
