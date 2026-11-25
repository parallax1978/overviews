import { proxyToClicky } from "@/lib/clicky";

export const dynamic = "force-dynamic";

/** Clicky's beacon for visitors without JavaScript (a 1x1 image), relayed from our domain (see lib/clicky.ts). */
export function GET(request: Request) {
  return proxyToClicky("noscript", request);
}

export function HEAD(request: Request) {
  return proxyToClicky("noscript", request);
}
