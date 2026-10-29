import { diffDays, type LocalDate } from "./dates";

export type OccurrenceState = "paid" | "skipped" | "overdue" | "due_today" | "due_soon" | "upcoming";

/** Days ahead that count as "due soon". */
export const DUE_SOON_DAYS = 7;

export function occurrenceState(status: "open" | "paid" | "skipped", dueDate: LocalDate, today: LocalDate): OccurrenceState {
  if (status === "paid") return "paid";
  if (status === "skipped") return "skipped";
  const diff = diffDays(dueDate, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "due_today";
  if (diff <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

export const STATE_LABELS: Record<OccurrenceState, string> = {
  paid: "Paid",
  skipped: "Skipped",
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due soon",
  upcoming: "Upcoming",
};

/** Sort priority for the dashboard: overdue first, then due today, then soonest. */
export function statePriority(state: OccurrenceState): number {
  return { overdue: 0, due_today: 1, due_soon: 2, upcoming: 3, paid: 4, skipped: 5 }[state];
}
