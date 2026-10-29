import { randomUUID } from "node:crypto";
import type { Tx } from "@/lib/db/client";
import { todayIn, type LocalDate } from "@/lib/domain/dates";
import { parseTimeToMinutes, type Channel, type PlanPrefs } from "@/lib/domain/reminder-plan";

export interface PreferencesRow {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  email_address: string | null;
  default_offsets: number[];
  reminder_hour: number;
  overdue_followups: boolean;
  overdue_followup_days: number;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  max_per_day: number;
  lock_screen_details: boolean;
}

export async function getPreferences(tx: Tx, userId: string): Promise<PreferencesRow> {
  const [row] = await tx<PreferencesRow[]>`
    select user_id, push_enabled, email_enabled, email_address, default_offsets, reminder_hour, overdue_followups,
           overdue_followup_days, quiet_hours_enabled, to_char(quiet_start, 'HH24:MI') as quiet_start,
           to_char(quiet_end, 'HH24:MI') as quiet_end, max_per_day, lock_screen_details
    from notification_preferences where user_id = ${userId}`;
  if (!row) throw new Error("Preferences missing");
  return row;
}

export function toPlanPrefs(p: PreferencesRow, timeZone: string): PlanPrefs {
  return {
    timeZone,
    defaultOffsets: p.default_offsets,
    reminderHour: p.reminder_hour,
    overdueFollowups: p.overdue_followups,
    overdueFollowupDays: p.overdue_followup_days,
    quietHoursEnabled: p.quiet_hours_enabled,
    quietStart: parseTimeToMinutes(p.quiet_start),
    quietEnd: parseTimeToMinutes(p.quiet_end),
  };
}

/**
 * Changing preferences cancels pending reminders that no longer match (disabled channels),
 * and reschedules the rest on the next scheduler run by canceling not-yet-due planned rows
 * so they are re-planned with the new timing.
 */
export async function updatePreferences(tx: Tx, userId: string, p: Omit<PreferencesRow, "user_id">): Promise<void> {
  await tx`
    update notification_preferences set
      push_enabled = ${p.push_enabled}, email_enabled = ${p.email_enabled}, email_address = ${p.email_address},
      default_offsets = ${p.default_offsets}, reminder_hour = ${p.reminder_hour}, overdue_followups = ${p.overdue_followups},
      overdue_followup_days = ${p.overdue_followup_days}, quiet_hours_enabled = ${p.quiet_hours_enabled},
      quiet_start = ${p.quiet_start}, quiet_end = ${p.quiet_end}, max_per_day = ${p.max_per_day},
      lock_screen_details = ${p.lock_screen_details}
    where user_id = ${userId}`;
  await cancelFuturePlannedReminders(tx, userId, "preferences_changed");
}

/**
 * Cancel pending, not-yet-due before/due/overdue reminders so the scheduler re-plans them under
 * current settings. Each re-plan uses a new key suffix (see engine), so canceled rows do not block it.
 */
export async function cancelFuturePlannedReminders(tx: Tx, userId: string, reason: string): Promise<void> {
  await tx`
    update reminders set status = 'canceled', skip_reason = ${reason}
    where user_id = ${userId} and status = 'pending' and kind in ('before', 'due', 'overdue') and send_at > now()`;
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string;
  user_agent: string | null;
  created_at: Date;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error: string | null;
  failure_count: number;
  disabled_at: Date | null;
}

export async function listPushSubscriptions(tx: Tx, userId: string): Promise<PushSubscriptionRow[]> {
  return tx<PushSubscriptionRow[]>`
    select id, endpoint, p256dh, auth, device_label, user_agent, created_at, last_success_at, last_failure_at,
           last_error, failure_count, disabled_at
    from push_subscriptions where user_id = ${userId} order by created_at desc`;
}

/**
 * Save a browser's push subscription. The endpoint is globally unique: if this browser was
 * previously subscribed under another account on the same device, that old row is replaced
 * (done with privileged access by the caller, because RLS hides other users' rows).
 */
export async function savePushSubscription(
  tx: Tx,
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string; deviceLabel: string; userAgent: string | null },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label, user_agent)
    values (${userId}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${sub.deviceLabel}, ${sub.userAgent})
    on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
      device_label = excluded.device_label, user_agent = excluded.user_agent, disabled_at = null,
      failure_count = 0, last_error = null
    returning id`;
  return row.id;
}

export async function removePushSubscription(tx: Tx, userId: string, idOrEndpoint: { id?: string; endpoint?: string }): Promise<void> {
  if (idOrEndpoint.id) await tx`delete from push_subscriptions where id = ${idOrEndpoint.id} and user_id = ${userId}`;
  else if (idOrEndpoint.endpoint) await tx`delete from push_subscriptions where endpoint = ${idOrEndpoint.endpoint} and user_id = ${userId}`;
}

/** Channels that can actually deliver for this user right now. */
export async function availableChannels(tx: Tx, userId: string, emailReady: boolean, pushReady: boolean): Promise<Channel[]> {
  const prefs = await getPreferences(tx, userId);
  const channels: Channel[] = [];
  if (pushReady && prefs.push_enabled) {
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from push_subscriptions where user_id = ${userId} and disabled_at is null`;
    if (n > 0) channels.push("push");
  }
  if (emailReady && prefs.email_enabled && prefs.email_address) channels.push("email");
  return channels;
}

/**
 * Snooze an occurrence's reminders until a time. The due date does not change.
 * Pending reminders before `until` are canceled and one snooze reminder per channel is created.
 */
export async function snoozeOccurrence(tx: Tx, userId: string, occurrenceId: string, until: Date, channels: Channel[]): Promise<void> {
  const rows = await tx`
    update bill_occurrences set snoozed_until = ${until}
    where id = ${occurrenceId} and user_id = ${userId} and status = 'open' returning id`;
  if (rows.length === 0) throw new Error("Only unpaid bills can be snoozed.");
  await tx`
    update reminders set status = 'canceled', skip_reason = 'snoozed'
    where occurrence_id = ${occurrenceId} and status = 'pending' and send_at < ${until}`;
  await tx`
    update reminders set status = 'canceled', skip_reason = 'replaced_by_new_snooze'
    where occurrence_id = ${occurrenceId} and status = 'pending' and kind = 'snooze'`;
  const [{ tz }] = await tx<{ tz: string }[]>`select time_zone as tz from profiles where id = ${userId}`;
  const slot: LocalDate = todayIn(tz, until);
  for (const channel of channels) {
    await tx`
      insert into reminders (user_id, occurrence_id, kind, channel, slot_date, send_at, dedupe_key)
      values (${userId}, ${occurrenceId}, 'snooze', ${channel}, ${slot}, ${until},
              ${`${occurrenceId}:snooze:${until.toISOString()}:${channel}`})
      on conflict (dedupe_key) do nothing`;
  }
}

/** Schedule a test reminder through the real scheduler (not an immediate send). */
export async function scheduleTestReminder(tx: Tx, userId: string, sendAt: Date, channels: Channel[], timeZone: string): Promise<number> {
  let n = 0;
  for (const channel of channels) {
    const rows = await tx`
      insert into reminders (user_id, occurrence_id, kind, channel, slot_date, send_at, dedupe_key)
      values (${userId}, null, 'test', ${channel}, ${todayIn(timeZone, sendAt)}, ${sendAt},
              ${`test:${userId}:${randomUUID()}:${channel}`})
      returning id`;
    n += rows.length;
  }
  return n;
}

export interface DeliveryRow {
  id: string;
  channel: Channel;
  status: "accepted" | "failed" | "expired";
  http_status: number | null;
  error: string | null;
  is_test: boolean;
  created_at: Date;
  device_label: string | null;
  kind: string | null;
  bill_name: string | null;
}

export async function listRecentDeliveries(tx: Tx, userId: string, limit = 25): Promise<DeliveryRow[]> {
  return tx<DeliveryRow[]>`
    select d.id, d.channel, d.status, d.http_status, d.error, d.is_test, d.created_at, s.device_label,
           r.kind::text as kind, b.name as bill_name
    from notification_deliveries d
    left join push_subscriptions s on s.id = d.push_subscription_id
    left join reminders r on r.id = d.reminder_id
    left join bill_occurrences o on o.id = r.occurrence_id
    left join bills b on b.id = o.bill_id
    where d.user_id = ${userId}
    order by d.created_at desc limit ${limit}`;
}

export interface UpcomingReminderRow {
  id: string;
  kind: string;
  channel: Channel;
  send_at: Date;
  status: string;
  bill_name: string | null;
}

export async function listPendingReminders(tx: Tx, userId: string, limit = 10): Promise<UpcomingReminderRow[]> {
  return tx<UpcomingReminderRow[]>`
    select r.id, r.kind::text as kind, r.channel, r.send_at, r.status::text as status, b.name as bill_name
    from reminders r
    left join bill_occurrences o on o.id = r.occurrence_id
    left join bills b on b.id = o.bill_id
    where r.user_id = ${userId} and r.status in ('pending', 'claimed')
    order by r.send_at limit ${limit}`;
}
