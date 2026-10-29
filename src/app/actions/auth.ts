"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { withService } from "@/lib/db/client";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { DEV_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { rateLimit } from "@/lib/server/rate-limit";
import { failure, type ActionResult } from "./result";

const email = z.string().trim().toLowerCase().email().max(254);

function allowed(address: string): boolean {
  const list = (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(address);
}

/** Where to go after signing in: straight to onboarding for a new account, so the dashboard never flashes. */
async function landingPath(userId: string): Promise<string> {
  const [row] = await withService((tx) => tx<{ onboarded_at: Date | null }[]>`select onboarded_at from profiles where id = ${userId}`);
  return row?.onboarded_at ? "/" : "/onboarding";
}

/** Step 1: email a 6-digit sign-in code. Codes (not links) work inside an installed iPhone web app. */
export async function sendCodeAction(rawEmail: string): Promise<ActionResult> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success) return failure("Enter a valid email address.");
  if (!(await rateLimit(`otp:${parsed.data}`, 5, 3600))) return failure("Too many codes requested. Wait a bit and try again.");
  if (!allowed(parsed.data)) return failure("This Billy is private. That email isn't on the guest list.");
  if (env().AUTH_MODE === "dev") return { ok: true };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true, emailRedirectTo: `${env().APP_URL}/auth/confirm` } });
  if (error) {
    console.error("signInWithOtp failed", error.status, error.code);
    return failure(error.status === 429 ? "Too many attempts. Try again in a few minutes." : "Couldn't send the code. Try again.");
  }
  return { ok: true };
}

/** Step 2: verify the code and start a session. */
export async function verifyCodeAction(rawEmail: string, code: string): Promise<ActionResult<{ next: string }>> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success || !/^\d{6,10}$/.test(code.trim())) return failure("Enter the code from the email.");
  if (!(await rateLimit(`verify:${parsed.data}`, 10, 900))) return failure("Too many attempts. Wait 15 minutes and try again.");
  if (!allowed(parsed.data)) return failure("This Billy is private.");

  if (env().AUTH_MODE === "dev") {
    // Local development / automated tests only. Any 6 digits work.
    const [user] = await withService(
      (tx) => tx<{ id: string }[]>`
        insert into auth.users (email) values (${parsed.data})
        on conflict (email) do update set email = excluded.email returning id`,
    );
    const jar = await cookies();
    jar.set(DEV_COOKIE, encodeDevSession(user.id, parsed.data), { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 30 });
    return { ok: true, next: await landingPath(user.id) };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: parsed.data, token: code.trim(), type: "email" });
  if (error || !data.user) return failure("That code didn't work. It may have expired. Request a new one.");
  return { ok: true, next: await landingPath(data.user.id) };
}

export async function signOutAction(): Promise<void> {
  if (env().AUTH_MODE === "dev") {
    (await cookies()).delete(DEV_COOKIE);
  } else {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/sign-in?signed_out=1");
}
