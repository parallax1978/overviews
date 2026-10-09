/**
 * Pure helpers that turn a DataForSEO SERP response into one normalized
 * AI Overview snapshot. No IO, no environment access: safe to unit test.
 *
 * Documented DataForSEO shape (serp/google/organic/live/advanced):
 *   tasks[0].result[0].items[] -> item with type "ai_overview"
 *     .items[]      ai_overview_element | ai_overview_table_element |
 *                   ai_overview_expanded_element | ai_overview_video_element
 *     .references[] top-level sources ({ source, domain, url, title, text })
 *     .asynchronous_ai_overview boolean
 */
import { createHash } from "node:crypto";
import type { OverviewInlineLink, OverviewReference } from "@/lib/types";
import { domainFromUrl } from "@/lib/utils";

export interface NormalizedOverview {
  hasOverview: boolean;
  text: string | null;
  markdown: string | null;
  references: OverviewReference[];
  inlineLinks: OverviewInlineLink[];
  contentHash: string | null;
}

type Dict = Record<string, unknown>;

interface Rendered {
  text: string;
  markdown: string;
}

function empty(): NormalizedOverview {
  return { hasOverview: false, text: null, markdown: null, references: [], inlineLinks: [], contentHash: null };
}

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function join(parts: Array<string | null | undefined>, separator: string): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(separator);
}

/**
 * Canonical form of a URL used to dedupe citations across elements and days:
 * lower-cased host, no utm_* params, no fragment, no trailing slash.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return trimmed.replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

/** "example.com" from a DataForSEO domain or URL field: lower-case, no "www.". */
function cleanDomain(domain: unknown, url: string): string {
  const given = str(domain);
  const base = given ? given.replace(/^https?:\/\//, "").split("/")[0] : domainFromUrl(url);
  return base.toLowerCase().replace(/^www\./, "");
}

/**
 * Returns the `ai_overview` item of a SERP response, or null. Accepts the full
 * response, a `result[0]` object, a list of SERP items, or the item itself.
 */
export function findAiOverviewItem(serpResponse: unknown): unknown | null {
  if (isDict(serpResponse) && serpResponse.type === "ai_overview") return serpResponse;
  for (const item of serpItems(serpResponse)) {
    if (isDict(item) && item.type === "ai_overview") return item;
  }
  return null;
}

function serpItems(input: unknown): unknown[] {
  if (Array.isArray(input)) return input;
  if (!isDict(input)) return [];
  if (Array.isArray(input.items)) return input.items;
  const task = list(input.tasks)[0];
  if (!isDict(task)) return [];
  const result = list(task.result)[0];
  return isDict(result) ? list(result.items) : [];
}

/**
 * Flattens an `ai_overview` item into plain text, markdown, deduped references
 * and inline links. Never throws: unexpected shapes are skipped.
 */
export function normalizeAiOverview(aiOverviewItem: unknown): NormalizedOverview {
  if (!isDict(aiOverviewItem)) return empty();

  const references = new Map<string, OverviewReference>();
  const inlineLinks = new Map<string, OverviewInlineLink>();
  const textParts: string[] = [];
  const markdownParts: string[] = [];

  list(aiOverviewItem.items).forEach((element, index) => {
    if (!isDict(element)) return;
    const rendered = renderElement(element);
    if (rendered.text) textParts.push(rendered.text);
    if (rendered.markdown) markdownParts.push(rendered.markdown);
    collectReferences(references, element.references, index);
    collectLinks(inlineLinks, element.links);
    for (const component of list(element.components)) {
      if (!isDict(component)) continue;
      collectReferences(references, component.references, index);
      collectLinks(inlineLinks, component.links);
    }
  });
  collectReferences(references, aiOverviewItem.references, -1);

  if (textParts.length === 0) return empty();

  const text = textParts.join("\n\n");
  const markdown = markdownParts.length
    ? markdownParts.join("\n\n")
    : (str(aiOverviewItem.markdown) ?? text);

  return {
    hasOverview: true,
    text,
    markdown,
    references: [...references.values()],
    inlineLinks: [...inlineLinks.values()],
    contentHash: hashText(text),
  };
}

/** sha256 of the text with whitespace collapsed, so cosmetic changes do not count. */
function hashText(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

function collectReferences(map: Map<string, OverviewReference>, refs: unknown, elementIndex: number) {
  for (const ref of list(refs)) {
    if (!isDict(ref)) continue;
    const rawUrl = str(ref.url);
    if (!rawUrl) continue;
    const url = normalizeUrl(rawUrl);
    if (map.has(url)) continue; // keep the first title/snippet and element seen
    map.set(url, {
      url,
      domain: cleanDomain(ref.domain, url),
      title: str(ref.title),
      snippet: str(ref.text) ?? str(ref.snippet),
      source: str(ref.source),
      element_index: elementIndex,
    });
  }
}

function collectLinks(map: Map<string, OverviewInlineLink>, links: unknown) {
  for (const link of list(links)) {
    if (!isDict(link)) continue;
    const url = str(link.url);
    if (!url || map.has(url)) continue;
    map.set(url, { url, domain: cleanDomain(link.domain, url), title: str(link.title) });
  }
}

function renderElement(element: Dict): Rendered {
  switch (element.type) {
    case "ai_overview_table_element":
      return renderTable(element);
    case "ai_overview_expanded_element":
      return renderExpanded(element);
    case "ai_overview_video_element":
      return renderVideo(element);
    default:
      return renderBasic(element);
  }
}

/** ai_overview_element (and any unknown element): title + text, markdown preferred. */
function renderBasic(element: Dict): Rendered {
  const title = str(element.title);
  const markdown = str(element.markdown);
  const text = str(element.text) ?? plainFromMarkdown(markdown);
  const body = markdown ?? text;
  return {
    text: join([title, text], "\n"),
    markdown: join([titleLine(title, body), body], "\n\n"),
  };
}

function renderTable(element: Dict): Rendered {
  const title = str(element.title);
  const rows = tableRows(element.table);
  const rowLines = rows.map((row) => row.join(" | "));
  const caption = str(element.text);
  const body = str(element.markdown) ?? (rows.length ? markdownTable(rows) : caption);
  return {
    text: join([title, caption, ...rowLines], "\n"),
    markdown: join([titleLine(title, body), body], "\n\n"),
  };
}

function renderExpanded(element: Dict): Rendered {
  const base = renderBasic(element);
  const components = list(element.components)
    .filter(isDict)
    .map((component) => renderBasic(component));
  return {
    text: join([base.text, ...components.map((c) => c.text)], "\n"),
    markdown: join([base.markdown, ...components.map((c) => c.markdown)], "\n\n"),
  };
}

function renderVideo(element: Dict): Rendered {
  const title = str(element.title);
  const snippet = str(element.snippet) ?? str(element.text);
  const url = str(element.url);
  const source = str(element.source) ?? str(element.domain);
  const heading = title ? (url ? `**[${title}](${url})**` : `**${title}**`) : null;
  const credit = source ? `Video from ${source}` : null;
  return {
    text: join([title, snippet, credit], "\n"),
    markdown: join([heading, snippet, credit], "\n\n"),
  };
}

/** A bold title line, unless the markdown body already starts with that title. */
function titleLine(title: string | null, body: string | null): string | null {
  if (!title) return null;
  const firstLine = (body ?? "").split("\n")[0].replace(/[#*_`]/g, "").trim().toLowerCase();
  if (firstLine && firstLine === title.toLowerCase()) return null;
  return `**${title}**`;
}

/** Table rows (header first when present) from DataForSEO's `table` object. */
function tableRows(table: unknown): string[][] {
  if (Array.isArray(table)) return table.map(cellsOf).filter((r) => r.length > 0);
  if (!isDict(table)) return [];
  const rows: string[][] = [];
  const header = cellsOf(table.table_header ?? table.header);
  if (header.length) rows.push(header);
  for (const row of list(table.table_content ?? table.rows ?? table.content)) {
    const cells = cellsOf(row);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function cellsOf(row: unknown): string[] {
  const values = Array.isArray(row) ? row : isDict(row) ? Object.values(row) : [];
  return values.map((cell) => {
    if (cell == null) return "";
    if (typeof cell === "string") return cell.replace(/\s+/g, " ").trim();
    if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
    if (isDict(cell)) return str(cell.text) ?? str(cell.title) ?? "";
    return "";
  });
}

function markdownTable(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => (cells[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const [header, ...body] = rows;
  return [line(header), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

/** Rough plain text from markdown, used only when an element has no `text`. */
function plainFromMarkdown(markdown: string | null): string | null {
  if (!markdown) return null;
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .trim();
  return text || null;
}
