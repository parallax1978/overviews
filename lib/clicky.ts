/**
 * Clicky analytics through our own domain (Clicky's "anti-adblock" proxy), so
 * visitors whose blockers stop third-party trackers are still counted. This is
 * a translation of the nginx setup from Clicky's tracking-code page:
 *
 *   /f9bb7dcc08c495e.js -> https://static.getclicky.com/js?in=%2Fdc95495f19525c8  (the tracker)
 *   /dc95495f19525c8    -> https://in.getclicky.com/in.php                        (its beacon)
 *   /e9415f48c064280    -> https://in.getclicky.com/101515245ns.gif               (no-JavaScript beacon)
 *
 * One deliberate difference: nginx passes every browser header on, which here
 * would include the Supabase sign-in cookies. Only an allowlist goes to Clicky,
 * plus Clicky's own two cookies on the beacons, as the nginx config does.
 *
 * These requests are visitors' own analytics pings relayed as they are, not
 * API calls the app makes, so they are not written to api_log.
 */

export const CLICKY_SITE_ID = "101515245";
export const CLICKY_SCRIPT_PATH = "/f9bb7dcc08c495e.js";
export const CLICKY_BEACON_PATH = "/dc95495f19525c8";
export const CLICKY_NOSCRIPT_PATH = "/e9415f48c064280";

export type ClickyTarget = "script" | "beacon" | "noscript";

const UPSTREAM: Record<ClickyTarget, string> = {
  script: "https://static.getclicky.com/js?in=%2Fdc95495f19525c8",
  beacon: "https://in.getclicky.com/in.php",
  noscript: `https://in.getclicky.com/${CLICKY_SITE_ID}ns.gif`,
};

/** Browser headers Clicky can use (browser, language, page that sent the ping). Nothing else is passed on. */
const FORWARDED_HEADERS = [
  "user-agent",
  "accept",
  "accept-language",
  "referer",
  "dnt",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "content-type",
];

/** Response headers that describe the connection or an encoding fetch already undid. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

const TIMEOUT_MS = 10_000;

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The URL and headers a request is relayed with. Pure, so the header rules are unit tested. */
export function clickyUpstreamRequest(
  target: ClickyTarget,
  request: Pick<Request, "url" | "headers">,
): { url: string; headers: Headers } {
  const incoming = new URL(request.url);
  // The tracker's own URL carries its query; the beacons pass the visitor's query on, as nginx does.
  const url = target === "script" ? UPSTREAM.script : `${UPSTREAM[target]}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Vercel sets x-forwarded-for to the visitor's address; Clicky reads the visitor's IP from it.
  const visitorIp = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  if (visitorIp) headers.set("x-forwarded-for", visitorIp);

  if (target !== "script") {
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
    headers.set("x-forwarded-host", incoming.host);
    // Only Clicky's first-party cookies, and only when the "ignore my visits" cookie is set.
    const cookies = request.headers.get("cookie");
    const ignore = readCookie(cookies, "_cky_ignore");
    if (ignore) headers.set("cookie", `_cky_ignore=${ignore}; _cky_osa=${readCookie(cookies, "_cky_osa") ?? ""}`);
  }
  return { url, headers };
}

/** Relays one request to Clicky and its answer back, Set-Cookie included (the "ignore my visits" link sets cookies). */
export async function proxyToClicky(target: ClickyTarget, request: Request): Promise<Response> {
  const { url, headers } = clickyUpstreamRequest(target, request);
  const hasBody = request.method === "POST";
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);

  const body = request.method === "HEAD" ? null : await upstream.arrayBuffer();
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
