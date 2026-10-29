import { addDays, endOfMonth, startOfMonth, type LocalDate } from "./dates";
import { addToTotals, type MoneyTotals } from "./money";

export interface SummaryOccurrence {
  status: "open" | "paid" | "skipped";
  due_date: LocalDate;
  amount_minor: number;
  currency: string;
}

export interface SummaryPayment {
  paid_on: LocalDate;
  amount_minor: number;
  currency: string;
  voided: boolean;
}

export interface DashboardSummary {
  overdue: { count: number; totals: MoneyTotals };
  dueToday: { count: number; totals: MoneyTotals };
  /** Open bills due from tomorrow through today + 7. Excludes overdue and due today, so nothing is counted twice. */
  next7: { count: number; totals: MoneyTotals };
  paidThisMonth: { count: number; totals: MoneyTotals };
  /** Occurrences due this calendar month: how many are paid out of the total. */
  monthProgress: { paid: number; total: number };
}

export function summarize(occurrences: SummaryOccurrence[], payments: SummaryPayment[], today: LocalDate): DashboardSummary {
  const s: DashboardSummary = {
    overdue: { count: 0, totals: {} },
    dueToday: { count: 0, totals: {} },
    next7: { count: 0, totals: {} },
    paidThisMonth: { count: 0, totals: {} },
    monthProgress: { paid: 0, total: 0 },
  };
  const weekEnd = addDays(today, 7);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);

  for (const o of occurrences) {
    if (o.due_date >= monthStart && o.due_date <= monthEnd && o.status !== "skipped") {
      s.monthProgress.total++;
      if (o.status === "paid") s.monthProgress.paid++;
    }
    if (o.status !== "open") continue;
    const bucket = o.due_date < today ? s.overdue : o.due_date === today ? s.dueToday : o.due_date <= weekEnd ? s.next7 : null;
    if (bucket) {
      bucket.count++;
      addToTotals(bucket.totals, o.currency, o.amount_minor);
    }
  }
  for (const p of payments) {
    if (p.voided || p.paid_on < monthStart || p.paid_on > monthEnd) continue;
    s.paidThisMonth.count++;
    addToTotals(s.paidThisMonth.totals, p.currency, p.amount_minor);
  }
  return s;
}
