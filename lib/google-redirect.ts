/**
 * Google sometimes cites a source in an AI Overview through its own redirect,
 * https://google.com/goto?url=<token>, instead of the page's address. The
 * token can't be decoded, but Google answers it with a redirect to the page
 * (google.com -> www.google.com -> the page). We follow only Google's own hops,
 * never the destination, and keep the page's address, so citations show (and
 * count) the real page, and the report can read it.
 */
import { normalizeUrl } from "@/lib/overview";
import type { OverviewInlineLink, OverviewReference } from "@/lib/types";
import { domainFromUrl } from "@/lib/utils";

const MAX_HOPS = 4;
const HOP_TIMEOUT_MS = 5_000;
const CONCURRENCY = 6;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isGoogleHost(hostname: string): boolean {
  return /^(www\.)?google\.[a-z.]+$/i.test(hostname);
}

/** True for Google's redirect links: /goto?url=<token> and /url?q=<address>. */
export function isGoogleRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return isGoogleHost(u.hostname) && (u.pathname === "/goto" || u.pathname === "/url");
  } catch {
    return false;
  }
}

function plainTarget(u: URL): string | null {
  // /url?q=https://... (and some /goto links) carry the address in the clear.
  for (const key of ["q", "url"]) {
    const value = u.searchParams.get(key);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/**
 * The page a Google redirect link leads to, or null when Google doesn't say
 * (an error, a challenge page, too many hops). Never requests the page itself.
 */
export async function resolveGoogleRedirect(url: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isGoogleHost(current.hostname)) return current.toString();
    const plain = plainTarget(current);
    if (plain) return plain;
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LegiitOverviews/1.0)" },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    // Only the redirect matters; don't download Google's page body.
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return null;
    try {
      current = new URL(location, current);
    } catch {
      return null;
    }
  }
  return isGoogleHost(current.hostname) ? null : current.toString();
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Google redirect links written into the overview text, e.g. its footnote markers "[[1]](https://google.com/goto?url=...)". */
const MARKDOWN_REDIRECT = /https?:\/\/(?:www\.)?google\.[a-z.]+\/(?:goto|url)\?[^\s)\]"'<>]+/gi;

/** The site's domain when Google's `source` field names one ("proseocontent.com"), else null. */
function domainFromSource(source: string | null): string | null {
  const value = source?.trim().toLowerCase() ?? "";
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value.replace(/^www\./, "") : null;
}

export interface ResolvedLinks {
  references: OverviewReference[];
  inlineLinks: OverviewInlineLink[];
  markdown: string | null;
  /** Google redirect links found, and how many of them now point at the page. */
  found: number;
  resolved: number;
  /** Each resolved redirect link and the page it leads to. */
  destinations: Map<string, string>;
}

/**
 * Replaces Google redirect links in a sample's citations, inline links and
 * markdown (whose footnote markers carry links of their own) with the pages
 * they lead to. Citations that end up on the same page
 * are merged (the first one is kept). A link Google wouldn't resolve stays as
 * it was, with its site's name from `source` when Google gave one.
 */
export async function resolveOverviewLinks(
  overview: { references: OverviewReference[]; inlineLinks: OverviewInlineLink[]; markdown: string | null },
  fetchImpl: FetchLike = fetch,
): Promise<ResolvedLinks> {
  const redirects = [
    ...new Set(
      [
        ...overview.references.map((r) => r.url),
        ...overview.inlineLinks.map((l) => l.url),
        ...(overview.markdown?.match(MARKDOWN_REDIRECT) ?? []),
      ].filter(isGoogleRedirect),
    ),
  ];
  if (redirects.length === 0) {
    return { ...overview, found: 0, resolved: 0, destinations: new Map() };
  }

  const targets = await mapLimit(redirects, CONCURRENCY, (url) => resolveGoogleRedirect(url, fetchImpl));
  const destination = new Map<string, string>();
  redirects.forEach((url, i) => {
    const target = targets[i];
    if (target) destination.set(url, normalizeUrl(target));
  });

  const references = new Map<string, OverviewReference>();
  for (const ref of overview.references) {
    const target = destination.get(ref.url);
    const url = target ?? ref.url;
    if (references.has(url)) continue;
    const domain = target ? domainFromUrl(target) : isGoogleRedirect(ref.url) ? (domainFromSource(ref.source) ?? ref.domain) : ref.domain;
    references.set(url, { ...ref, url, domain });
  }

  const inlineLinks = new Map<string, OverviewInlineLink>();
  for (const link of overview.inlineLinks) {
    const target = destination.get(link.url);
    const url = target ?? link.url;
    if (inlineLinks.has(url)) continue;
    inlineLinks.set(url, { ...link, url, domain: target ? domainFromUrl(target) : link.domain });
  }

  let markdown = overview.markdown;
  if (markdown) {
    for (const [from, to] of destination) markdown = markdown.split(from).join(to);
  }

  return {
    references: [...references.values()],
    inlineLinks: [...inlineLinks.values()],
    markdown,
    found: redirects.length,
    resolved: destination.size,
    destinations: destination,
  };
}
