import { randomUUID, createHash } from "node:crypto";
import type { Sql, Tx } from "@/lib/db/client";
import { materializeOccurrences } from "@/lib/data/occurrences";
import { toPlanPrefs, type PreferencesRow } from "@/lib/data/notifications";
import { notificationCopy, type NotificationItem, type Tone } from "@/lib/domain/billy-messages";
import { todayIn, type LocalDate } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { applyQuietHours, planReminders, type Channel, type PlannedReminder } from "@/lib/domain/reminder-plan";
import type { Senders } from "./senders";

/** Cancel reasons after which the planner may revive a reminder with fresh timing. */
const REPLANNABLE = ["preferences_changed", "time_zone_changed", "due_date_changed"];
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const CLAIM_BATCH = 200;

export interface CycleOptions {
  sql: Sql;
  senders: Senders;
  now?: Date;
  appUrl: string;
  pushReady: boolean;
  emailReady: boolean;
}

export interface CycleSummary {
  materialized: number;
  planned: number;
  claimed: number;
  sentNotifications: number;
  remindersSent: number;
  failed: number;
  retried: number;
  canceled: number;
  deferred: number;
  skippedCap: number;
}

type PlanCandidate = PreferencesRow & {
  occurrence_id: string;
  user_id: string;
  due_date: LocalDate;
  status: "open" | "paid" | "skipped";
  snoozed_until: Date | null;
  created_at: Date;
  reminders_enabled: boolean;
  reminder_offsets: number[] | null;
  time_zone: string;
  has_push: boolean;
};

/**
 * One scheduler pass. Safe to run concurrently and repeatedly:
 *   1. materialize upcoming occurrences (idempotent inserts)
 *   2. plan reminders with unique dedupe keys (ON CONFLICT DO NOTHING)
 *   3. claim due reminders with FOR UPDATE SKIP LOCKED so two workers never take the same row
 *   4. re-check eligibility at send time (paid, archived, snoozed, quiet hours, channel off, daily cap)
 *   5. send grouped notifications and record every attempt
 * Delivery is at-least-once with deduplication, not exactly-once: if a worker dies after the
 * provider accepted a message but before recording it, the stale claim is retried (email uses
 * the provider's idempotency key to suppress that duplicate; web push has no such mechanism).
 */
export async function runReminderCycle(opts: CycleOptions): Promise<CycleSummary> {
  const now = opts.now ?? new Date();
  const summary: CycleSummary = {
    materialized: 0, planned: 0, claimed: 0, sentNotifications: 0, remindersSent: 0,
    failed: 0, retried: 0, canceled: 0, deferred: 0, skippedCap: 0,
  };
  const { sql } = opts;

  // 1. Materialize occurrences for users with active bills.
  const users = await sql<{ id: string; time_zone: string }[]>`
    select p.id, p.time_zone from profiles p where exists (select 1 from bills b where b.user_id = p.id and b.status = 'active')`;
  for (const u of users) {
    summary.materialized += await sql.begin((tx) => materializeOccurrences(tx as unknown as Tx, u.id, todayIn(u.time_zone, now)));
  }

  // 2. Plan.
  summary.planned = await planAll(sql, now, opts);

  // 3. Claim.
  const token = randomUUID();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimed = await sql<{ id: string }[]>`
    with c as (
      select id from reminders
      where (status = 'pending' and send_at <= ${now}) or (status = 'claimed' and claimed_at < ${staleBefore})
      order by send_at
      for update skip locked
      limit ${CLAIM_BATCH}
    )
    update reminders r set status = 'claimed', claim_token = ${token}, claimed_at = ${now}, attempts = r.attempts + 1
    from c where r.id = c.id
    returning r.id`;
  summary.claimed = claimed.length;
  if (claimed.length === 0) return summary;

  // 4. Load context and evaluate eligibility.
  const rows = await sql<ClaimedRow[]>`
    select r.id, r.user_id, r.kind::text as kind, r.channel::text as channel, r.attempts, r.dedupe_key, r.occurrence_id,
           o.status::text as occ_status, o.due_date, o.amount_minor, o.currency, o.snoozed_until, o.bill_id,
           b.name as bill_name, b.status::text as bill_status, b.reminders_enabled,
           p.time_zone, p.tone::text as tone,
           np.push_enabled, np.email_enabled, np.email_address, np.quiet_hours_enabled,
           to_char(np.quiet_start, 'HH24:MI') as quiet_start, to_char(np.quiet_end, 'HH24:MI') as quiet_end,
           np.max_per_day, np.lock_screen_details, np.default_offsets, np.reminder_hour, np.overdue_followups, np.overdue_followup_days
    from reminders r
    join profiles p on p.id = r.user_id
    join notification_preferences np on np.user_id = r.user_id
    left join bill_occurrences o on o.id = r.occurrence_id
    left join bills b on b.id = o.bill_id
    where r.claim_token = ${token}`;

  const groups = new Map<string, ClaimedRow[]>();
  for (const r of rows) {
    const verdict = evaluate(r, now, opts);
    if (verdict.action === "cancel") {
      await sql`update reminders set status = 'canceled', skip_reason = ${verdict.reason}, claim_token = null where id = ${r.id} and claim_token = ${token}`;
      summary.canceled++;
    } else if (verdict.action === "defer") {
      await sql`update reminders set status = 'pending', send_at = ${verdict.until}, claim_token = null, attempts = attempts - 1
                where id = ${r.id} and claim_token = ${token}`;
      summary.deferred++;
    } else if (verdict.action === "fail") {
      await sql`update reminders set status = 'failed', last_error = ${verdict.reason}, claim_token = null where id = ${r.id} and claim_token = ${token}`;
      await recordDelivery(sql, { userId: r.user_id, reminderIds: [r.id], channel: r.channel, subId: null, status: "failed", httpStatus: null, providerId: null, error: verdict.reason, isTest: r.kind === "test", batchId: randomUUID() });
      summary.failed++;
    } else {
      const key = `${r.user_id}:${r.channel}:${r.kind === "test" ? "test" : "bill"}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  }

  // 5. Send one notification per (user, channel) group.
  for (const group of groups.values()) {
    const head = group[0];
    if (head.kind !== "test") {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(distinct batch_id)::int as n from notification_deliveries
        where user_id = ${head.user_id} and status = 'accepted' and not is_test and created_at > ${new Date(now.getTime() - 86_400_000)}`;
      if (n >= head.max_per_day) {
        const ids = group.map((g) => g.id);
        await sql`update reminders set status = 'skipped', skip_reason = 'daily_cap', claim_token = null where id = any(${ids}) and claim_token = ${token}`;
        summary.skippedCap += group.length;
        continue;
      }
    }
    const result = await sendGroup(sql, group, now, opts);
    const ids = group.map((g) => g.id);
    if (result.accepted) {
      await sql`update reminders set status = 'sent', sent_at = ${now}, last_error = null, claim_token = null where id = any(${ids}) and claim_token = ${token}`;
      summary.sentNotifications++;
      summary.remindersSent += group.length;
    } else {
      for (const g of group) {
        if (g.attempts < MAX_ATTEMPTS && result.retryable) {
          const retryAt = new Date(now.getTime() + 5 * 60_000 * g.attempts);
          await sql`update reminders set status = 'pending', send_at = ${retryAt}, last_error = ${result.error}, claim_token = null
                    where id = ${g.id} and claim_token = ${token}`;
          summary.retried++;
        } else {
          await sql`update reminders set status = 'failed', last_error = ${result.error}, claim_token = null where id = ${g.id} and claim_token = ${token}`;
          summary.failed++;
        }
      }
    }
  }
  return summary;
}

interface ClaimedRow {
  id: string;
  user_id: string;
  kind: "before" | "due" | "overdue" | "snooze" | "test";
  channel: Channel;
  attempts: number;
  dedupe_key: string;
  occurrence_id: string | null;
  occ_status: string | null;
  due_date: LocalDate | null;
  amount_minor: number | null;
  currency: string | null;
  snoozed_until: Date | null;
  bill_id: string | null;
  bill_name: string | null;
  bill_status: string | null;
  reminders_enabled: boolean | null;
  time_zone: string;
  tone: Tone;
  push_enabled: boolean;
  email_enabled: boolean;
  email_address: string | null;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  max_per_day: number;
  lock_screen_details: boolean;
  default_offsets: number[];
  reminder_hour: number;
  overdue_followups: boolean;
  overdue_followup_days: number;
}

type Verdict =
  | { action: "send" }
  | { action: "cancel"; reason: string }
  | { action: "defer"; until: Date }
  | { action: "fail"; reason: string };

function evaluate(r: ClaimedRow, now: Date, opts: CycleOptions): Verdict {
  if (r.attempts > MAX_ATTEMPTS) return { action: "fail", reason: "Gave up after repeated attempts (delivery result unknown)" };
  if (r.kind !== "test") {
    if (r.occ_status !== "open") return { action: "cancel", reason: r.occ_status === "paid" ? "paid" : "not_open" };
    if (r.bill_status !== "active") return { action: "cancel", reason: "bill_archived" };
    if (!r.reminders_enabled) return { action: "cancel", reason: "bill_reminders_off" };
    if (r.kind !== "snooze" && r.snoozed_until && r.snoozed_until.getTime() > now.getTime()) return { action: "cancel", reason: "snoozed" };
  }
  if (r.channel === "push" && !r.push_enabled) return { action: "cancel", reason: "channel_disabled" };
  if (r.channel === "email" && (!r.email_enabled || !r.email_address)) return { action: "cancel", reason: "channel_disabled" };
  if (r.channel === "push" && !opts.pushReady) return { action: "fail", reason: "Push is not configured on the server" };
  if (r.channel === "email" && !opts.emailReady) return { action: "fail", reason: "Email is not configured on the server" };
  if (r.kind !== "test") {
    const prefs = toPlanPrefs(r as unknown as PreferencesRow, r.time_zone);
    const moved = applyQuietHours(now, prefs);
    if (moved.getTime() !== now.getTime()) return { action: "defer", until: moved };
  }
  return { action: "send" };
}

async function sendGroup(sql: Sql, group: ClaimedRow[], now: Date, opts: CycleOptions): Promise<{ accepted: boolean; retryable: boolean; error: string | null }> {
  const head = group[0];
  const today = todayIn(head.time_zone, now);
  const items: NotificationItem[] = group.map((g) => ({
    occurrenceId: g.occurrence_id ?? g.id,
    name: g.bill_name ?? "Billy",
    amountLabel: g.amount_minor !== null && g.currency ? formatMoney(g.amount_minor, g.currency) : "",
    dueDate: g.due_date ?? today,
    kind: g.kind,
  }));
  // Most urgent first.
  items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const batchId = randomUUID();
  const ids = group.map((g) => g.id);
  const path = head.kind === "test" ? "/settings#notifications" : group.length === 1 && head.bill_id ? `/bills/${head.bill_id}?occurrence=${head.occurrence_id}` : "/";
  const url = new URL(path, opts.appUrl).toString();
  const isTest = head.kind === "test";

  if (head.channel === "push") {
    const copy = notificationCopy(items, head.tone, today, head.lock_screen_details);
    const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
      select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${head.user_id} and disabled_at is null`;
    if (subs.length === 0) {
      await recordDelivery(sql, { userId: head.user_id, reminderIds: ids, channel: "push", subId: null, status: "failed", httpStatus: null, providerId: null, error: "No active devices for push", isTest, batchId });
      return { accepted: false, retryable: false, error: "No active devices for push" };
    }
    let accepted = false;
    let lastError: string | null = null;
    const tag = group.length === 1 ? `billy-${items[0].occurrenceId}` : "billy-batch";
    for (const s of subs) {
      const res = await opts.senders.push(s, { title: copy.title, body: copy.body, url, tag });
      await recordDelivery(sql, { userId: head.user_id, reminderIds: ids, channel: "push", subId: s.id, status: res.status, httpStatus: res.httpStatus, providerId: null, error: res.error, isTest, batchId });
      if (res.status === "accepted") {
        accepted = true;
        await sql`update push_subscriptions set last_success_at = ${now}, failure_count = 0, last_error = null where id = ${s.id}`;
      } else if (res.status === "expired") {
        await sql`update push_subscriptions set disabled_at = ${now}, last_failure_at = ${now}, last_error = ${res.error} where id = ${s.id}`;
        lastError = res.error;
      } else {
        await sql`update push_subscriptions set last_failure_at = ${now}, failure_count = failure_count + 1, last_error = ${res.error},
                  disabled_at = case when failure_count + 1 >= 10 then ${now}::timestamptz else null end where id = ${s.id}`;
        lastError = res.error;
      }
    }
    return { accepted, retryable: true, error: lastError };
  }

  // Email: always includes details (it is not a lock-screen surface), kept brief and actionable.
  const copy = notificationCopy(items, head.tone, today, true);
  const idempotencyKey = createHash("sha256").update(group.map((g) => g.dedupe_key).sort().join("|")).digest("hex");
  const text = `${copy.body}\n\nOpen Billy: ${url}\n\nBilly records payments you confirm. It never moves money.\nChange reminder settings: ${new URL("/settings", opts.appUrl)}`;
  const html = emailHtml(copy.title, copy.body, url, new URL("/settings", opts.appUrl).toString());
  const res = await opts.senders.email({ to: head.email_address!, subject: copy.title, text, html, idempotencyKey });
  await recordDelivery(sql, { userId: head.user_id, reminderIds: ids, channel: "email", subId: null, status: res.status, httpStatus: res.httpStatus, providerId: res.providerId, error: res.error, isTest, batchId });
  return { accepted: res.status === "accepted", retryable: res.httpStatus === null || res.httpStatus >= 500 || res.httpStatus === 429, error: res.error };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function emailHtml(title: string, body: string, url: string, settingsUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#141714;font-family:Arial,sans-serif;color:#F4F5EE">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="100%" style="max-width:480px;background:#1E221E;border:1px solid #32372F;border-radius:16px">
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#F4F5EE">billy<span style="color:#C1F474">*</span></p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#F4F5EE">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#F4F5EE;white-space:pre-line">${escapeHtml(body)}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#C1F474;color:#141714;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px">Open Billy</a>
<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#969E93">Billy records payments you confirm. It never moves money.<br><a href="${escapeHtml(settingsUrl)}" style="color:#969E93">Reminder settings</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

async function recordDelivery(
  sql: Sql,
  d: { userId: string; reminderIds: string[]; channel: Channel; subId: string | null; status: "accepted" | "failed" | "expired"; httpStatus: number | null; providerId: string | null; error: string | null; isTest: boolean; batchId: string },
): Promise<void> {
  const rows = d.reminderIds.map((rid) => ({
    user_id: d.userId,
    reminder_id: rid,
    channel: d.channel,
    push_subscription_id: d.subId,
    batch_id: d.batchId,
    status: d.status,
    http_status: d.httpStatus,
    provider_message_id: d.providerId,
    error: d.error ? d.error.slice(0, 500) : null,
    is_test: d.isTest,
  }));
  await sql`insert into notification_deliveries ${sql(rows)}`;
}

async function planAll(sql: Sql, now: Date, opts: CycleOptions): Promise<number> {
  const candidates = await sql<PlanCandidate[]>`
    select o.id as occurrence_id, o.user_id, o.due_date, o.status::text as status, o.snoozed_until, o.created_at,
           b.reminders_enabled, b.reminder_offsets, p.time_zone,
           np.user_id, np.push_enabled, np.email_enabled, np.email_address, np.default_offsets, np.reminder_hour,
           np.overdue_followups, np.overdue_followup_days, np.quiet_hours_enabled,
           to_char(np.quiet_start, 'HH24:MI') as quiet_start, to_char(np.quiet_end, 'HH24:MI') as quiet_end,
           np.max_per_day, np.lock_screen_details,
           exists (select 1 from push_subscriptions s where s.user_id = o.user_id and s.disabled_at is null) as has_push
    from bill_occurrences o
    join bills b on b.id = o.bill_id
    join profiles p on p.id = o.user_id
    join notification_preferences np on np.user_id = o.user_id
    where o.status = 'open' and b.status = 'active' and b.reminders_enabled
      and o.due_date between (${now}::timestamptz at time zone 'UTC')::date - 16 and (${now}::timestamptz at time zone 'UTC')::date + 32`;
  const planned: (PlannedReminder & { userId: string })[] = [];
  for (const c of candidates) {
    const channels: Channel[] = [];
    if (opts.pushReady && c.push_enabled && c.has_push) channels.push("push");
    if (opts.emailReady && c.email_enabled && c.email_address) channels.push("email");
    const prefs = toPlanPrefs(c, c.time_zone);
    for (const p of planReminders(
      { id: c.occurrence_id, dueDate: c.due_date, status: c.status, snoozedUntil: c.snoozed_until, createdAt: c.created_at },
      { remindersEnabled: c.reminders_enabled, reminderOffsets: c.reminder_offsets, active: true },
      prefs,
      channels,
      now,
    )) {
      planned.push({ ...p, userId: c.user_id });
    }
  }
  if (planned.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < planned.length; i += 500) {
    const chunk = planned.slice(i, i + 500).map((p) => ({
      user_id: p.userId,
      occurrence_id: p.occurrenceId,
      kind: p.kind,
      channel: p.channel,
      slot_date: p.slotDate,
      send_at: p.sendAt,
      dedupe_key: p.dedupeKey,
    }));
    const res = await sql`
      insert into reminders ${sql(chunk)}
      on conflict (dedupe_key) do update set status = 'pending', send_at = excluded.send_at, skip_reason = null, attempts = 0
      where reminders.status = 'canceled' and reminders.skip_reason = any(${REPLANNABLE})
      returning id`;
    inserted += res.length;
  }
  return inserted;
}
