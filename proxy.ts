import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets, images, the cron endpoint, Stripe's webhook, the auth callback
    // and the Clicky analytics relay (lib/clicky.ts), which never needs a session.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|api/cron|api/stripe|auth/confirm|f9bb7dcc08c495e\\.js|dc95495f19525c8|e9415f48c064280|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
