import { addDays, addMonthsClamped, diffDays, type LocalDate } from "./dates";

export const RECURRENCES = ["once", "weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  once: "One time",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Every three months",
  yearly: "Yearly",
};

/** The n-th occurrence date (n = 0 is the anchor), always computed from the anchor. */
export function nthOccurrence(anchor: LocalDate, recurrence: Recurrence, n: number): LocalDate {
  if (n < 0) throw new Error("n must be >= 0");
  switch (recurrence) {
    case "once":
      if (n > 0) throw new Error("One-time bills have a single occurrence");
      return anchor;
    case "weekly":
      return addDays(anchor, 7 * n);
    case "biweekly":
      return addDays(anchor, 14 * n);
    case "monthly":
      return addMonthsClamped(anchor, n);
    case "quarterly":
      return addMonthsClamped(anchor, 3 * n);
    case "yearly":
      return addMonthsClamped(anchor, 12 * n);
  }
}

/** A lower bound on the index of the first occurrence on or after `date`. */
function estimateIndex(anchor: LocalDate, recurrence: Recurrence, date: LocalDate): number {
  const days = diffDays(date, anchor);
  if (days <= 0) return 0;
  switch (recurrence) {
    case "once":
      return 0;
    case "weekly":
      return Math.max(0, Math.floor(days / 7) - 1);
    case "biweekly":
      return Math.max(0, Math.floor(days / 14) - 1);
    case "monthly":
      return Math.max(0, Math.floor(days / 31) - 1);
    case "quarterly":
      return Math.max(0, Math.floor(days / 92) - 1);
    case "yearly":
      return Math.max(0, Math.floor(days / 366) - 1);
  }
}

/**
 * All occurrence dates d with from <= d <= to, in order.
 * Dates before the anchor are never produced.
 */
export function occurrencesBetween(
  anchor: LocalDate,
  recurrence: Recurrence,
  from: LocalDate,
  to: LocalDate,
  limit = 1000,
): LocalDate[] {
  if (to < from) return [];
  if (recurrence === "once") return anchor >= from && anchor <= to ? [anchor] : [];
  const out: LocalDate[] = [];
  for (let n = estimateIndex(anchor, recurrence, from); out.length < limit; n++) {
    const date = nthOccurrence(anchor, recurrence, n);
    if (date > to) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** The first occurrence on or after `date`, or null for a past one-time bill. */
export function nextOccurrenceOnOrAfter(anchor: LocalDate, recurrence: Recurrence, date: LocalDate): LocalDate | null {
  if (recurrence === "once") return anchor >= date ? anchor : null;
  for (let n = estimateIndex(anchor, recurrence, date); ; n++) {
    const d = nthOccurrence(anchor, recurrence, n);
    if (d >= date) return d;
  }
}

/** Default materialization horizon for occurrences (days after today). */
export const MATERIALIZE_HORIZON_DAYS = 45;
