import { diffDays, type LocalDate } from "./dates";

/**
 * Billy's curated message library. Deterministic: the same inputs always produce the same line.
 * Rules: firm and funny, never insulting, never shaming hardship, never inventing consequences
 * (no late fees, credit scores or penalties Billy cannot know about).
 */

export type Tone = "gentle" | "straight" | "extra";
export type Mood = "neutral" | "heads_up" | "due_today" | "overdue" | "celebrating" | "all_clear";

export const TONE_LABELS: Record<Tone, { label: string; description: string }> = {
  gentle: { label: "Gentle", description: "Kind nudges. Same reminders, softer words." },
  straight: { label: "Straight talk", description: "Clear and direct. Billy's default." },
  extra: { label: "Extra accountability", description: "Billy holds you to it. Same reminders, firmer words." },
};

type Template = (v: { name: string; days: number; count: number; firstName: string }) => string;
type Library = Record<Tone, Template[]>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const numberWord = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven"][n] ?? String(n);

const UPCOMING: Library = {
  gentle: [
    (v) => `${v.name} is due in ${numberWord(v.days)} ${v.days === 1 ? "day" : "days"}. Plenty of time to get it sorted.`,
    (v) => `Just a heads-up: ${v.name} comes due in ${numberWord(v.days)} ${v.days === 1 ? "day" : "days"}.`,
  ],
  straight: [
    (v) => `${v.name}'s due in ${numberWord(v.days)} ${v.days === 1 ? "day" : "days"}. Let's not make this a last-minute thing.`,
    (v) => `${v.name} lands in ${numberWord(v.days)} ${v.days === 1 ? "day" : "days"}. Handle it early and forget about it.`,
  ],
  extra: [
    (v) => `${v.name}. ${numberWord(v.days)[0].toUpperCase()}${numberWord(v.days).slice(1)} ${v.days === 1 ? "day" : "days"}. You know what to do, so let's do it now.`,
    (v) => `${v.name} is due in ${numberWord(v.days)} ${v.days === 1 ? "day" : "days"}. Future you is counting on present you.`,
  ],
};

const DUE_TODAY: Library = {
  gentle: [
    (v) => `${v.name} is due today. Take care of it when you have a moment.`,
    (v) => `Today's the day for ${v.name}. One small step and it's done.`,
  ],
  straight: [
    (v) => `Today's the day. Handle ${v.name} and get it off your mind.`,
    (v) => `${v.name} is due today. Two minutes now, zero stress later.`,
  ],
  extra: [
    (v) => `${v.name} is due today. Not tomorrow. Today. Let's go.`,
    (v) => `It's ${v.name} day. Open it, pay it, mark it. I'll wait.`,
  ],
};

const OVERDUE: Library = {
  gentle: [
    (v) => `${v.name} is still waiting. Whenever you're ready, let's figure out the next step together.`,
    (v) => `${v.name} slipped past its date. That happens. Want to pick a plan?`,
  ],
  straight: [
    (v) => `This one's still waiting. Let's figure out the next move on ${v.name}.`,
    (v) => `Ignoring it won't make it cheaper. ${v.name} is overdue. Let's handle it.`,
  ],
  extra: [
    (v) => `${v.name} is overdue. Pay it or set a plan today. No more pushing it around.`,
    (v) => `${v.name} has been waiting ${plural(v.days, "day")}. Let's close this loop now.`,
  ],
};

const MULTI_OVERDUE: Library = {
  gentle: [(v) => `${plural(v.count, "bill")} are past due. Let's take them one at a time.`],
  straight: [(v) => `${plural(v.count, "bill")} are overdue. Start with ${v.name} and work down the list.`],
  extra: [(v) => `${plural(v.count, "bill")} overdue. Start with ${v.name}. Right now.`],
};

const PAID: Library = {
  gentle: [(v) => `${v.name} is handled. Nicely done.`, () => `Handled. One less thing on your plate.`],
  straight: [() => `Handled. That's how you do it.`, (v) => `${v.name}: handled. Next.`],
  extra: [(v) => `${v.name} done. That's the standard. Keep it there.`, () => `Handled. See? You've got this.`],
};

const ALL_CLEAR: Library = {
  gentle: [() => `You're all caught up. Enjoy the quiet.`, () => `Nothing due right now. You're in good shape.`],
  straight: [() => `Nothing hanging over your head. Keep it that way.`, () => `All caught up. That's a clear head.`],
  extra: [() => `All clear. Don't get comfortable. I'll be back when something's due.`, () => `Caught up. This is what control looks like.`],
};

const NO_BILLS: Library = {
  gentle: [() => `Add your first bill and I'll keep an eye on it for you.`],
  straight: [() => `Add a bill. I'll make sure it never sneaks up on you.`],
  extra: [() => `No bills yet? Let's change that. Add one and I'll keep you honest.`],
};

const CANT_PAY: Library = {
  gentle: [() => `That's okay. Pick a date that works and I'll remind you then. The due date stays honest.`],
  straight: [() => `Can't pay yet? Set a plan. I'll remind you, and the due date stays what it is.`],
  extra: [() => `Not today? Fine. Pick a real date and I'll hold you to it.`],
};

function pick(lib: Library, tone: Tone, seed: string, v: Parameters<Template>[0]): string {
  const list = lib[tone];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length](v);
}

export interface BillyFocusItem {
  name: string;
  dueDate: LocalDate;
  state: "overdue" | "due_today" | "due_soon" | "upcoming";
}

export interface BillyMessage {
  mood: Mood;
  headline: string;
  body: string;
}

/** Billy's most relevant message for the dashboard, from real occurrence data. */
export function dashboardMessage(input: {
  tone: Tone;
  today: LocalDate;
  hasBills: boolean;
  overdue: BillyFocusItem[];
  dueToday: BillyFocusItem[];
  upcoming: BillyFocusItem[];
  justPaidName?: string | null;
  firstName?: string;
}): BillyMessage {
  const { tone, today } = input;
  const firstName = input.firstName ?? "";
  const seed = today;
  if (input.justPaidName) {
    return { mood: "celebrating", headline: "Handled.", body: pick(PAID, tone, seed + input.justPaidName, { name: input.justPaidName, days: 0, count: 1, firstName }) };
  }
  if (!input.hasBills) {
    return { mood: "neutral", headline: "Let's get started.", body: pick(NO_BILLS, tone, seed, { name: "", days: 0, count: 0, firstName }) };
  }
  if (input.overdue.length > 0) {
    const oldest = input.overdue[0];
    const days = diffDays(today, oldest.dueDate);
    const headline = tone === "gentle" ? "Let's catch up." : tone === "extra" ? "No more waiting." : "Ignoring it won't make it cheaper.";
    const lib = input.overdue.length > 1 ? MULTI_OVERDUE : OVERDUE;
    return { mood: "overdue", headline, body: pick(lib, tone, seed + oldest.name, { name: oldest.name, days, count: input.overdue.length, firstName }) };
  }
  if (input.dueToday.length > 0) {
    const first = input.dueToday[0];
    const name = input.dueToday.length > 1 ? `${first.name} and ${plural(input.dueToday.length - 1, "other")}` : first.name;
    return { mood: "due_today", headline: "Today's the day.", body: pick(DUE_TODAY, tone, seed + name, { name, days: 0, count: input.dueToday.length, firstName }) };
  }
  const soon = input.upcoming.find((u) => u.state === "due_soon");
  if (soon) {
    const days = diffDays(soon.dueDate, today);
    return { mood: "heads_up", headline: "Heads up.", body: pick(UPCOMING, tone, seed + soon.name, { name: soon.name, days, count: 1, firstName }) };
  }
  return { mood: "all_clear", headline: "All caught up.", body: pick(ALL_CLEAR, tone, seed, { name: "", days: 0, count: 0, firstName }) };
}

export function paidMessage(tone: Tone, name: string, seed: string): string {
  return pick(PAID, tone, seed + name, { name, days: 0, count: 1, firstName: "" });
}

export function cantPayMessage(tone: Tone): string {
  return pick(CANT_PAY, tone, "cant-pay", { name: "", days: 0, count: 0, firstName: "" });
}

export interface NotificationItem {
  occurrenceId: string;
  name: string;
  amountLabel: string;
  dueDate: LocalDate;
  kind: "before" | "due" | "overdue" | "snooze" | "test";
}

/**
 * Notification copy for a group of reminders sent together to one channel.
 * When `details` is false (lock-screen privacy), bill names and amounts are omitted.
 */
export function notificationCopy(items: NotificationItem[], tone: Tone, today: LocalDate, details: boolean): { title: string; body: string } {
  if (items.length === 0) throw new Error("No items");
  if (items[0].kind === "test") {
    return { title: "Billy test reminder", body: "Scheduled reminders are working. You'll hear from me when a bill needs you." };
  }
  if (items.length > 1) {
    const overdue = items.filter((i) => diffDays(today, i.dueDate) > 0).length;
    const title = overdue > 0 ? `${plural(items.length, "bill")} need attention` : `${plural(items.length, "bill")} coming up`;
    const body = details
      ? items.slice(0, 4).map((i) => `${i.name} ${i.amountLabel} · ${dueLabel(i.dueDate, today)}`).join("\n")
      : "Open Billy to see what's due.";
    return { title, body };
  }
  const item = items[0];
  const days = diffDays(item.dueDate, today);
  if (!details) {
    const when = days < 0 ? "is overdue" : days === 0 ? "is due today" : `is due ${days === 1 ? "tomorrow" : `in ${days} days`}`;
    return { title: "Billy", body: `A bill ${when}. Open Billy for details.` };
  }
  const v = { name: item.name, days: Math.abs(days), count: 1, firstName: "" };
  const seed = item.occurrenceId + today;
  if (days < 0) return { title: `${item.name} is overdue · ${item.amountLabel}`, body: pick(OVERDUE, tone, seed, v) };
  if (days === 0) return { title: `${item.name} is due today · ${item.amountLabel}`, body: pick(DUE_TODAY, tone, seed, v) };
  return { title: `${item.name} due ${days === 1 ? "tomorrow" : `in ${days} days`} · ${item.amountLabel}`, body: pick(UPCOMING, tone, seed, v) };
}

function dueLabel(due: LocalDate, today: LocalDate): string {
  const d = diffDays(due, today);
  if (d < 0) return "overdue";
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d} days`;
}
