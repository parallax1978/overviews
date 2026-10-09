import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOutThenHome(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303 so the browser follows the redirect with GET after a form POST.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

/** POST /auth/signout: ends the session (used by the "Sign out" form in the app header). */
export async function POST(request: NextRequest) {
  return signOutThenHome(request);
}

/** GET /auth/signout: same as POST, so a plain link also works. */
export async function GET(request: NextRequest) {
  return signOutThenHome(request);
}
