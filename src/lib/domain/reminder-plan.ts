import { addDays, localMinutesIn, todayIn, zonedInstant, type LocalDate } from "./dates";

export type Channel = "push" | "email";
export type ReminderKind = "before" | "due" | "overdue" | "snooze" | "test";

export interface PlanPrefs {
  timeZone: string;
  defaultOffsets: number[];
  reminderHour: number;
  overdueFollowups: boolean;
  overdueFollowupDays: number;
  quietHoursEnabled: boolean;
  /** Minutes after local midnight. */
  quietStart: number;
  quietEnd: number;
}

export interface PlanBill {
  remindersEnabled: boolean;
  reminderOffsets: number[] | null;
  active: boolean;
}

export interface PlanOccurrence {
  id: string;
  dueDate: LocalDate;
  status: "open" | "paid" | "skipped";
  snoozedUntil: Date | null;
  createdAt: Date;
}

export interface PlannedReminder {
  occurrenceId: string;
  kind: ReminderKind;
  channel: Channel;
  slotDate: LocalDate;
  sendAt: Date;
  dedupeKey: string;
}

/** Reminders whose time passed more than this long ago are not planned (avoids a burst after an outage). */
export const PLAN_GRACE_MS = 18 * 60 * 60 * 1000;
/** Reminders are planned up to this far ahead so a worker can claim them on time. */
export const PLAN_LOOKAHEAD_MS = 36 * 60 * 60 * 1000;

export function dedupeKey(occurrenceId: string, kind: ReminderKind, slotDate: LocalDate, channel: Channel): string {
  return `${occurrenceId}:${kind}:${slotDate}:${channel}`;
}

export function isInQuietHours(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Move an instant out of quiet hours to the next local quiet-hours end.
 * Returns the instant unchanged when it is outside quiet hours.
 */
export function applyQuietHours(at: Date, prefs: Pick<PlanPrefs, "timeZone" | "quietHoursEnabled" | "quietStart" | "quietEnd">): Date {
  if (!prefs.quietHoursEnabled) return at;
  const minutes = localMinutesIn(prefs.timeZone, at);
  if (!isInQuietHours(minutes, prefs.quietStart, prefs.quietEnd)) return at;
  const day = todayIn(prefs.timeZone, at);
  // Quiet hours that started yesterday evening end this morning; otherwise they end on the next day's morning.
  const endDay = prefs.quietStart > prefs.quietEnd && minutes >= prefs.quietStart ? addDays(day, 1) : day;
  return zonedInstant(endDay, prefs.quietEnd, prefs.timeZone);
}

/** The local-day slots (before / due / overdue) for an occurrence, independent of time window. */
export function reminderSlots(occ: Pick<PlanOccurrence, "dueDate">, bill: PlanBill, prefs: PlanPrefs): { kind: ReminderKind; slotDate: LocalDate }[] {
  const offsets = [...new Set(bill.reminderOffsets ?? prefs.defaultOffsets)].sort((a, b) => b - a);
  const slots: { kind: ReminderKind; slotDate: LocalDate }[] = offsets.map((offset) => ({
    kind: offset === 0 ? "due" : "before",
    slotDate: addDays(occ.dueDate, -offset),
  }));
  if (prefs.overdueFollowups) {
    for (let day = 1; day <= prefs.overdueFollowupDays; day++) {
      slots.push({ kind: "overdue", slotDate: addDays(occ.dueDate, day) });
    }
  }
  return slots;
}

/**
 * Plan the reminders for one occurrence that fall inside the planning window around `now`.
 * Pure function: the caller inserts the results with ON CONFLICT (dedupe_key) DO NOTHING,
 * so running it repeatedly or from overlapping workers never creates duplicate reminder rows.
 */
export function planReminders(
  occ: PlanOccurrence,
  bill: PlanBill,
  prefs: PlanPrefs,
  channels: Channel[],
  now: Date,
): PlannedReminder[] {
  if (occ.status !== "open" || !bill.active || !bill.remindersEnabled || channels.length === 0) return [];
  const out: PlannedReminder[] = [];
  const windowStart = now.getTime() - PLAN_GRACE_MS;
  const windowEnd = now.getTime() + PLAN_LOOKAHEAD_MS;

  for (const slot of reminderSlots(occ, bill, prefs)) {
    const base = zonedInstant(slot.slotDate, prefs.reminderHour * 60, prefs.timeZone);
    // Never remind about a time that passed before the bill existed.
    if (base.getTime() < occ.createdAt.getTime()) continue;
    if (base.getTime() < windowStart || base.getTime() > windowEnd) continue;
    // A snooze replaces any reminder that would have fired before it ends.
    if (occ.snoozedUntil && base.getTime() < occ.snoozedUntil.getTime()) continue;
    const sendAt = applyQuietHours(base, prefs);
    for (const channel of channels) {
      out.push({
        occurrenceId: occ.id,
        kind: slot.kind,
        channel,
        slotDate: slot.slotDate,
        sendAt,
        dedupeKey: dedupeKey(occ.id, slot.kind, slot.slotDate, channel),
      });
    }
  }
  return out;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
