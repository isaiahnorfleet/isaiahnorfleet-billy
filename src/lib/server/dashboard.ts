import "server-only";
import type { Tx } from "@/lib/db/client";
import { listOccurrencesForDashboard, type OccurrenceRow } from "@/lib/data/occurrences";
import { listPayments } from "@/lib/data/payments";
import { dashboardMessage, type BillyMessage, type Tone } from "@/lib/domain/billy-messages";
import { addDays, startOfMonth, endOfMonth, type LocalDate } from "@/lib/domain/dates";
import { occurrenceState, statePriority, type OccurrenceState } from "@/lib/domain/status";
import { summarize, type DashboardSummary } from "@/lib/domain/summary";

export interface DashboardItem extends OccurrenceRow {
  state: OccurrenceState;
}

export interface DashboardData {
  summary: DashboardSummary;
  items: DashboardItem[];
  message: BillyMessage;
  hasBills: boolean;
  focus: DashboardItem | null;
}

export async function loadDashboard(tx: Tx, userId: string, today: LocalDate, tone: Tone, firstName: string): Promise<DashboardData> {
  const monthStart = startOfMonth(today);
  const until = addDays(today, 30) > endOfMonth(today) ? addDays(today, 30) : endOfMonth(today);
  const rows = await listOccurrencesForDashboard(tx, userId, monthStart, until);
  const payments = await listPayments(tx, userId, { from: monthStart, to: endOfMonth(today) });
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from bills where user_id = ${userId} and status = 'active'`;

  const items: DashboardItem[] = rows.map((r) => ({ ...r, state: occurrenceState(r.status, r.due_date, today) }));
  const summary = summarize(
    items.map((i) => ({ status: i.status, due_date: i.due_date, amount_minor: i.amount_minor, currency: i.currency })),
    payments.map((p) => ({ paid_on: p.paid_on, amount_minor: p.amount_minor, currency: p.currency, voided: false })),
    today,
  );
  const open = items
    .filter((i) => i.status === "open")
    .sort((a, b) => statePriority(a.state) - statePriority(b.state) || a.due_date.localeCompare(b.due_date) || b.amount_minor - a.amount_minor);
  const toFocus = (i: DashboardItem) => ({ name: i.bill_name, dueDate: i.due_date, state: i.state as "overdue" | "due_today" | "due_soon" | "upcoming" });
  const message = dashboardMessage({
    tone,
    today,
    hasBills: n > 0,
    overdue: open.filter((i) => i.state === "overdue").map(toFocus),
    dueToday: open.filter((i) => i.state === "due_today").map(toFocus),
    upcoming: open.filter((i) => i.state === "due_soon" || i.state === "upcoming").map(toFocus),
    firstName,
  });
  const paidThisMonth = items.filter((i) => i.status === "paid").sort((a, b) => (b.paid_on ?? "").localeCompare(a.paid_on ?? ""));
  return { summary, items: [...open, ...paidThisMonth], message, hasBills: n > 0, focus: open[0] ?? null };
}
