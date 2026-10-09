import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * GET /auth/confirm?token_hash&type&next
 * Exchanges the token_hash from the sign-in email for a session cookie, then
 * sends the user on. Expired or missing tokens go back to /login?error=link.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = (params.get("type") || "email") as EmailOtpType;
  const next = safeNextPath(params.get("next"));

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
