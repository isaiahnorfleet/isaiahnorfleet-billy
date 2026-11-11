"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { withService } from "@/lib/db/client";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { DEV_COOKIE, encodeDevSession } from "@/lib/auth/dev-session";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/server/rate-limit";
import { failure, type ActionResult } from "./result";

const email = z.string().trim().toLowerCase().email().max(254);
/** Supabase (bcrypt) only uses the first 72 bytes, so cap it there. */
const password = z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer.");

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
    await startDevSession(user.id, parsed.data);
    return { ok: true, next: await landingPath(user.id) };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: parsed.data, token: code.trim(), type: "email" });
  if (error || !data.user) return failure("That code didn't work. It may have expired. Request a new one.");
  return { ok: true, next: await landingPath(data.user.id) };
}

async function startDevSession(id: string, address: string) {
  const jar = await cookies();
  jar.set(DEV_COOKIE, encodeDevSession(id, address), { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 60 * 60 * 24 * 30 });
}

/** Sign in with an email and password (for people whose inbox Billy's sign-in emails can't reach yet). */
export async function signInWithPasswordAction(rawEmail: string, rawPassword: string): Promise<ActionResult<{ next: string }>> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success || !rawPassword) return failure("Enter your email and password.");
  if (!(await rateLimit(`password:${parsed.data}`, 10, 900))) return failure("Too many attempts. Wait 15 minutes and try again.");
  if (!allowed(parsed.data)) return failure("This Billy is private. That email isn't on the guest list.");
  const wrong = failure("That email and password don't match. If you've never set a password, sign in with a code and set one in Settings.");

  if (env().AUTH_MODE === "dev") {
    const [user] = await withService(
      (tx) => tx<{ id: string }[]>`
        select id from auth.users
        where email = ${parsed.data} and encrypted_password is not null and encrypted_password = crypt(${rawPassword}, encrypted_password)`,
    );
    if (!user) return wrong;
    await startDevSession(user.id, parsed.data);
    return { ok: true, next: await landingPath(user.id) };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data, password: rawPassword });
  if (error || !data.user) {
    if (error?.status === 429) return failure("Too many attempts. Try again in a few minutes.");
    return wrong;
  }
  return { ok: true, next: await landingPath(data.user.id) };
}

/** Set or change the signed-in user's password, so they can sign in without an email code. */
export async function setPasswordAction(rawPassword: string, confirm: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return failure("You're signed out. Sign in again.");
  const parsed = password.safeParse(rawPassword);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? "Choose a different password.");
  if (rawPassword !== confirm) return failure("The two passwords don't match.");
  if (!(await rateLimit(`set-password:${user.id}`, 10, 3600))) return failure("Too many changes. Try again later.");

  if (env().AUTH_MODE === "dev") {
    await withService((tx) => tx`update auth.users set encrypted_password = crypt(${parsed.data}, gen_salt('bf')) where id = ${user.id}`);
    return { ok: true };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    console.error("updateUser password failed", error.status, error.code);
    if (error.code === "same_password") return failure("That's already your password.");
    if (error.code === "weak_password") return failure("That password is too easy to guess. Try a longer one.");
    return failure("Couldn't save the password. Try again.");
  }
  return { ok: true };
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
