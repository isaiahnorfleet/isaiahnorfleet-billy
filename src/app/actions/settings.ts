"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { env, emailConfigured, pushConfigured } from "@/lib/env";
import { sql, withService, withUser } from "@/lib/db/client";
import { requireUserForAction } from "@/lib/auth/session";
import { DEV_COOKIE } from "@/lib/auth/dev-session";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { availableChannels, cancelFuturePlannedReminders, getPreferences, removePushSubscription, savePushSubscription, scheduleTestReminder, updatePreferences } from "@/lib/data/notifications";
import { isValidTimeZone, todayIn } from "@/lib/domain/dates";
import { notificationCopy } from "@/lib/domain/billy-messages";
import { defaultSenders } from "@/lib/reminders/senders";
import { rateLimit } from "@/lib/server/rate-limit";
import { fieldErrors, preferencesInput, profileInput, pushSubscriptionInput } from "@/lib/validation";
import { failure, type ActionResult } from "./result";

export async function saveProfileAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = profileInput.safeParse({
      display_name: String(form.get("display_name") ?? ""),
      currency: String(form.get("currency") ?? "CAD"),
      time_zone: String(form.get("time_zone") ?? ""),
      tone: String(form.get("tone") ?? "straight"),
    });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    if (!isValidTimeZone(parsed.data.time_zone)) return failure("Pick a valid time zone.", { time_zone: "Unknown time zone" });
    const completeOnboarding = form.get("complete_onboarding") === "1";
    await withUser(user.id, async (tx) => {
      await tx`update profiles set display_name = ${parsed.data.display_name}, currency = ${parsed.data.currency},
               time_zone = ${parsed.data.time_zone}, tone = ${parsed.data.tone},
               onboarded_at = case when ${completeOnboarding} then coalesce(onboarded_at, now()) else onboarded_at end
               where id = ${user.id}`;
      // Reminders are planned in local time; re-plan them for the new zone. Tone never changes frequency.
      if (parsed.data.time_zone !== profile.time_zone) await cancelFuturePlannedReminders(tx, user.id, "time_zone_changed");
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return failure("Couldn't save. Try again.");
  }
}

export async function finishOnboardingAction(): Promise<ActionResult> {
  const { user } = await requireUserForAction();
  await withUser(user.id, (tx) => tx`update profiles set onboarded_at = coalesce(onboarded_at, now()) where id = ${user.id}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

const bool = (form: FormData, k: string) => form.get(k) === "on";

export async function savePreferencesAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    const parsed = preferencesInput.safeParse({
      push_enabled: bool(form, "push_enabled"),
      email_enabled: bool(form, "email_enabled"),
      email_address: String(form.get("email_address") ?? ""),
      default_offsets: form.getAll("default_offsets").map(String),
      reminder_hour: String(form.get("reminder_hour") ?? "9"),
      overdue_followups: bool(form, "overdue_followups"),
      overdue_followup_days: String(form.get("overdue_followup_days") ?? "5"),
      quiet_hours_enabled: bool(form, "quiet_hours_enabled"),
      quiet_start: String(form.get("quiet_start") ?? "21:00"),
      quiet_end: String(form.get("quiet_end") ?? "08:00"),
      max_per_day: String(form.get("max_per_day") ?? "6"),
      lock_screen_details: bool(form, "lock_screen_details"),
    });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    await withUser(user.id, (tx) => updatePreferences(tx, user.id, parsed.data));
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return failure("Couldn't save your reminder settings. Try again.");
  }
}

export async function savePushSubscriptionAction(input: { endpoint: string; keys: { p256dh: string; auth: string }; deviceLabel?: string; userAgent?: string }): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    const parsed = pushSubscriptionInput.safeParse({ endpoint: input.endpoint, keys: input.keys, device_label: input.deviceLabel });
    if (!parsed.success) return failure("This browser returned an invalid subscription.");
    // If this browser was registered by another account on this device, hand it over to this account.
    await withService((tx) => tx`delete from push_subscriptions where endpoint = ${parsed.data.endpoint} and user_id <> ${user.id}`);
    await withUser(user.id, async (tx) => {
      await savePushSubscription(tx, user.id, {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        deviceLabel: parsed.data.device_label ?? "This device",
        userAgent: input.userAgent?.slice(0, 400) ?? null,
      });
      await tx`update notification_preferences set push_enabled = true where user_id = ${user.id}`;
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return failure("Couldn't save this device. Try again.");
  }
}

export async function removePushSubscriptionAction(input: { id?: string; endpoint?: string }): Promise<ActionResult> {
  const { user } = await requireUserForAction();
  await withUser(user.id, (tx) => removePushSubscription(tx, user.id, input));
  revalidatePath("/settings");
  return { ok: true };
}

/** Immediate test through each enabled channel. This checks delivery, not the scheduler. */
export async function sendTestNowAction(): Promise<ActionResult<{ results: { channel: string; status: string; detail: string }[] }>> {
  const { user, profile } = await requireUserForAction();
  if (!(await rateLimit(`test-now:${user.id}`, 6, 3600))) return failure("That's a lot of tests. Try again in a bit.");
  const senders = defaultSenders();
  const results: { channel: string; status: string; detail: string }[] = [];
  const copy = notificationCopy([{ occurrenceId: "test", name: "Billy", amountLabel: "", dueDate: todayIn(profile.time_zone), kind: "test" }], profile.tone, todayIn(profile.time_zone), true);
  const appUrl = env().APP_URL;
  const { prefs, subs } = await withUser(user.id, async (tx) => ({
    prefs: await getPreferences(tx, user.id),
    subs: await tx<{ id: string; endpoint: string; p256dh: string; auth: string; device_label: string }[]>`
      select id, endpoint, p256dh, auth, device_label from push_subscriptions where user_id = ${user.id} and disabled_at is null`,
  }));
  const batchId = crypto.randomUUID();
  const record = (channel: "push" | "email", status: "accepted" | "failed" | "expired", subId: string | null, http: number | null, error: string | null, providerId: string | null = null) =>
    sql()`insert into notification_deliveries (user_id, channel, push_subscription_id, batch_id, status, http_status, provider_message_id, error, is_test)
          values (${user.id}, ${channel}, ${subId}, ${batchId}, ${status}, ${http}, ${providerId}, ${error}, true)`;

  if (!prefs.push_enabled) results.push({ channel: "Push", status: "off", detail: "Push reminders are turned off." });
  else if (!pushConfigured()) results.push({ channel: "Push", status: "failed", detail: "Push isn't configured on the server yet." });
  else if (subs.length === 0) results.push({ channel: "Push", status: "failed", detail: "No devices are set up for push yet." });
  for (const s of prefs.push_enabled && pushConfigured() ? subs : []) {
    const res = await senders.push(s, { title: copy.title, body: "This is a test. Real reminders arrive on schedule, even when Billy is closed.", url: `${appUrl}/settings#notifications`, tag: "billy-test" });
    await record("push", res.status, s.id, res.httpStatus, res.error);
    if (res.status === "expired") await withService((tx) => tx`update push_subscriptions set disabled_at = now(), last_error = ${res.error} where id = ${s.id}`);
    results.push({ channel: `Push · ${s.device_label}`, status: res.status, detail: res.status === "accepted" ? "Accepted by the push service. Check your device." : res.error ?? "Failed" });
  }
  if (!prefs.email_enabled) results.push({ channel: "Email", status: "off", detail: "Email reminders are turned off." });
  else if (!emailConfigured()) results.push({ channel: "Email", status: "failed", detail: "Email isn't configured on the server yet." });
  else if (prefs.email_address) {
    const res = await senders.email({
      to: prefs.email_address,
      subject: "Billy test email",
      text: `This is a test from Billy. Real reminders arrive on schedule.\n\n${appUrl}`,
      html: `<p>This is a test from Billy. Real reminders arrive on schedule.</p><p><a href="${appUrl}">Open Billy</a></p>`,
      idempotencyKey: `test-email:${batchId}`,
    });
    await record("email", res.status, null, res.httpStatus, res.error, res.providerId);
    results.push({ channel: "Email", status: res.status, detail: res.status === "accepted" ? `Accepted by Resend for ${prefs.email_address}.` : res.error ?? "Failed" });
  }
  revalidatePath("/settings");
  return { ok: true, results };
}

/** Schedules a reminder ~2 minutes out that only the background scheduler can deliver. */
export async function scheduleTestReminderAction(): Promise<ActionResult<{ sendAt: string; channels: number }>> {
  const { user, profile } = await requireUserForAction();
  if (!(await rateLimit(`test-sched:${user.id}`, 6, 3600))) return failure("That's a lot of tests. Try again in a bit.");
  const sendAt = new Date(Date.now() + 2 * 60_000);
  const n = await withUser(user.id, async (tx) => {
    const channels = await availableChannels(tx, user.id, emailConfigured(), pushConfigured());
    return scheduleTestReminder(tx, user.id, sendAt, channels, profile.time_zone);
  });
  if (n === 0) return failure("Set up push on this device or turn on email first.");
  revalidatePath("/settings");
  return { ok: true, sendAt: sendAt.toISOString(), channels: n };
}

/** Permanently delete the account and all data. Requires typing DELETE. */
export async function deleteAccountAction(confirm: string): Promise<ActionResult> {
  if (confirm.trim() !== "DELETE") return failure('Type DELETE to confirm.');
  const { user } = await requireUserForAction();
  const e = env();
  if (e.AUTH_MODE === "dev") {
    await withService((tx) => tx`delete from auth.users where id = ${user.id}`);
    (await cookies()).delete(DEV_COOKIE);
    return { ok: true };
  }
  if (!e.SUPABASE_SECRET_KEY || !e.NEXT_PUBLIC_SUPABASE_URL) return failure("Account deletion isn't configured on the server.");
  // Deleting the auth user cascades to profiles and every user-owned table.
  const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return failure("Couldn't delete the account. Try again.");
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return { ok: true };
}
