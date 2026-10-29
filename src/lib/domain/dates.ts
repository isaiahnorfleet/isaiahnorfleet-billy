import { DateTime } from "luxon";

/**
 * A calendar date with no time or zone, formatted YYYY-MM-DD.
 * Due dates are always LocalDates in the user's time zone. Arithmetic on them is pure
 * civil-calendar arithmetic, so daylight-saving changes and UTC offsets cannot shift a date.
 */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(value: LocalDate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${value}`);
  return { y, m, d };
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

export function formatLocalDate(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01 for a civil date (proleptic Gregorian). */
function toDayNumber(date: LocalDate): number {
  const { y, m, d } = parseLocalDate(date);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * 86_400_000);
  return formatLocalDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/**
 * Add whole months to the ORIGINAL anchor date, clamping to the last valid day.
 * Always computing from the anchor (never from the previous result) is what lets a bill due
 * on Jan 31 fall on Feb 28/29 and then return to Mar 31.
 */
export function addMonthsClamped(anchor: LocalDate, months: number): LocalDate {
  const { y, m, d } = parseLocalDate(anchor);
  const zeroBased = y * 12 + (m - 1) + months;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12) + 1;
  return formatLocalDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** Today's calendar date in a time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  const dt = DateTime.fromJSDate(now, { zone: timeZone });
  if (!dt.isValid) throw new Error(`Invalid time zone: ${timeZone}`);
  return dt.toISODate()!;
}

/** Local wall-clock minutes since midnight for an instant in a time zone. */
export function localMinutesIn(timeZone: string, now: Date): number {
  const dt = DateTime.fromJSDate(now, { zone: timeZone });
  return dt.hour * 60 + dt.minute;
}

/**
 * The instant at which a local wall-clock time occurs on a date in a time zone.
 * If the time falls in a DST gap (e.g. 02:30 on spring-forward day), Luxon moves it forward.
 */
export function zonedInstant(date: LocalDate, minutesOfDay: number, timeZone: string): Date {
  const { y, m, d } = parseLocalDate(date);
  const dt = DateTime.fromObject(
    { year: y, month: m, day: d, hour: Math.floor(minutesOfDay / 60), minute: minutesOfDay % 60 },
    { zone: timeZone },
  );
  if (!dt.isValid) throw new Error(`Invalid zoned time: ${date} ${minutesOfDay} ${timeZone}`);
  return dt.toJSDate();
}

export function isValidTimeZone(timeZone: string): boolean {
  return DateTime.local().setZone(timeZone).isValid;
}

export function startOfMonth(date: LocalDate): LocalDate {
  const { y, m } = parseLocalDate(date);
  return formatLocalDate(y, m, 1);
}

export function endOfMonth(date: LocalDate): LocalDate {
  const { y, m } = parseLocalDate(date);
  return formatLocalDate(y, m, daysInMonth(y, m));
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: LocalDate): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function formatDateLabel(date: LocalDate, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const { y, m, d } = parseLocalDate(date);
  return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "today", "tomorrow", "in 3 days", "yesterday", "5 days ago". */
export function relativeDayLabel(date: LocalDate, today: LocalDate): string {
  const diff = diffDays(date, today);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1) return `in ${diff} days`;
  return `${-diff} days ago`;
}
