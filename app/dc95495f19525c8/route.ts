import { proxyToClicky } from "@/lib/clicky";

export const dynamic = "force-dynamic";

/** Clicky's tracking beacon, relayed from our domain (see lib/clicky.ts). */
export function GET(request: Request) {
  return proxyToClicky("beacon", request);
}

export function HEAD(request: Request) {
  return proxyToClicky("beacon", request);
}

export function POST(request: Request) {
  return proxyToClicky("beacon", request);
}
