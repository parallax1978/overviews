import { proxyToClicky } from "@/lib/clicky";

export const dynamic = "force-dynamic";

/** Clicky's tracker, served from our domain so ad blockers don't drop it (see lib/clicky.ts). */
export function GET(request: Request) {
  return proxyToClicky("script", request);
}

export function HEAD(request: Request) {
  return proxyToClicky("script", request);
}
