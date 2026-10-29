import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { withUser } from "@/lib/db/client";
import { createSupabaseServerClient } from "./supabase-server";
import { DEV_COOKIE, decodeDevSession } from "./dev-session";

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in user, verified on the server, or null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (env().AUTH_MODE === "dev") {
    const jar = await cookies();
    const s = decodeDevSession(jar.get(DEV_COOKIE)?.value);
    return s ? { id: s.sub, email: s.email } : null;
  }
  const supabase = await createSupabaseServerClient();
  // getClaims verifies the JWT signature; never trust getSession() for authorization.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: String(data.claims.email ?? "") };
});

export interface Profile {
  id: string;
  display_name: string;
  currency: string;
  time_zone: string;
  tone: "gentle" | "straight" | "extra";
  onboarded_at: Date | null;
  email: string;
}

/** Ensure a profile and preference row exist for the user (first sign-in), then return it. */
export const getProfile = cache(async (user: SessionUser): Promise<Profile> => {
  return withUser(user.id, async (tx) => {
    let rows = await tx<Profile[]>`select id, display_name, currency, time_zone, tone, onboarded_at from profiles where id = ${user.id}`;
    if (rows.length === 0) {
      await tx`insert into profiles (id) values (${user.id}) on conflict (id) do nothing`;
      await tx`insert into notification_preferences (user_id, email_address) values (${user.id}, ${user.email || null}) on conflict (user_id) do nothing`;
      rows = await tx<Profile[]>`select id, display_name, currency, time_zone, tone, onboarded_at from profiles where id = ${user.id}`;
    }
    await tx`update profiles set last_active_at = now() where id = ${user.id} and (last_active_at is null or last_active_at < now() - interval '1 hour')`;
    return { ...rows[0], email: user.email };
  });
});

/** For pages: require a signed-in, onboarded user. */
export async function requireUser(opts: { allowUnonboarded?: boolean } = {}): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  const profile = await getProfile(user);
  if (!profile.onboarded_at && !opts.allowUnonboarded) redirect("/onboarding");
  return { user, profile };
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireUserForAction(): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  return { user, profile: await getProfile(user) };
}

export class AuthError extends Error {
  constructor() {
    super("Not signed in");
  }
}
