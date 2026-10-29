import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { env } from "@/lib/env";

/**
 * Fallback for the sign-in email's link (the 6-digit code is the main path, because a link
 * opens in Safari rather than in the installed Home Screen app). Handles both the
 * token-hash link format and the default PKCE "code" redirect.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const fail = NextResponse.redirect(new URL("/sign-in?link=expired", url));
  if (env().AUTH_MODE === "dev") return fail;
  const supabase = await createSupabaseServerClient();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail;
  } else {
    return fail;
  }
  return NextResponse.redirect(new URL("/", url));
}
