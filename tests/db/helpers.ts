import { randomUUID } from "node:crypto";
import { sql, withUser } from "@/lib/db/client";

/** Wipe all app data between tests. Local test database only. */
export async function resetDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("Refusing to reset a non-local database");
  await sql()`truncate auth.users, public.rate_limits, public.job_runs cascade`;
}

export async function createUser(opts: { email?: string; timeZone?: string; name?: string; lockScreenDetails?: boolean } = {}) {
  const id = randomUUID();
  const email = opts.email ?? `${id.slice(0, 8)}@example.test`;
  await sql()`insert into auth.users (id, email) values (${id}, ${email})`;
  await withUser(id, async (tx) => {
    await tx`insert into profiles (id, display_name, time_zone, onboarded_at) values (${id}, ${opts.name ?? "Test"}, ${opts.timeZone ?? "America/Toronto"}, now())`;
    await tx`insert into notification_preferences (user_id, email_address, lock_screen_details) values (${id}, ${email}, ${opts.lockScreenDetails ?? false})`;
  });
  return { id, email };
}

export async function addPushSubscription(userId: string, endpoint = `https://push.example.test/${randomUUID()}`) {
  await sql()`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (${userId}, ${endpoint}, 'p256dh-key', 'auth-key')`;
  return endpoint;
}

export const billInput = (over: Record<string, unknown> = {}) => ({
  name: "Hydro",
  amount: "112.48",
  amount_minor: 11248,
  currency: "CAD",
  category: "utilities" as const,
  recurrence: "monthly" as const,
  due_date: "2026-11-15",
  autopay: false,
  autopay_account: null,
  payment_url: null,
  notes: null,
  reminders_enabled: true,
  reminder_offsets: null,
  ...over,
});
