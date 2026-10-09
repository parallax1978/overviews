import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout: ends the session (used by the "Sign out" form in the app
 * header). POST only, so a third-party page cannot sign a user out with a link.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 so the browser follows the redirect with GET after a form POST.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
