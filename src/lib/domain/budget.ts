import { addDays, daysInMonth, diffDays, endOfMonth, formatLocalDate, isLocalDate, parseLocalDate, startOfMonth, type LocalDate } from "./dates";
import type { Recurrence } from "./recurrence";

/**
 * Monthly budget math. Pure and deterministic: every figure is computed from stored rows for one
 * calendar month in the user's time zone. Only amounts in the user's main currency are counted;
 * anything in another currency is reported separately rather than silently mixed in.
 *
 *   left to spend = income this month - bills due this month - spending logged this month
 */

export interface IncomeSourceInput {
  id: string;
  name: string;
  amount_minor: number;
  currency: string;
  recurrence: Recurrence;
  anchor_date: LocalDate;
}

export interface BudgetBillInput {
  amount_minor: number;
  currency: string;
  due_date: LocalDate;
  paid: boolean;
}

export interface BudgetCategoryInput {
  id: string;
  name: string;
  monthly_limit_minor: number | null;
}

export interface ExpenseInput {
  category_id: string | null;
  amount_minor: number;
  currency: string;
  spent_on: LocalDate;
}

export interface IncomeLine {
  id: string;
  name: string;
  recurrence: Recurrence;
  amount_minor: number;
  dates: LocalDate[];
  total_minor: number;
}

export interface CategoryLine {
  id: string | null;
  name: string;
  limit_minor: number | null;
  spent_minor: number;
  /** limit - spent; null when the category has no limit. */
  remaining_minor: number | null;
  /** 0..n share of the limit used; null without a limit. */
  used: number | null;
  over: boolean;
}

export type MonthTiming = "past" | "current" | "future";

export interface BudgetSummary {
  month: LocalDate;
  monthEnd: LocalDate;
  timing: MonthTiming;
  currency: string;
  income: { total_minor: number; lines: IncomeLine[] };
  bills: { total_minor: number; paid_minor: number; unpaid_minor: number; count: number };
  spent_minor: number;
  categories: CategoryLine[];
  /** Sum of category limits. */
  planned_minor: number;
  /** income - bills - planned limits: money not assigned to a category (negative = over-planned). */
  unassigned_minor: number;
  left_minor: number;
  /** Days left in the month including today (current month only). */
  daysLeft: number | null;
  /** left / daysLeft, floored to a whole cent, when the current month still has money left. */
  perDay_minor: number | null;
  /** Rows skipped because they use another currency. */
  otherCurrencyCount: number;
  hasIncome: boolean;
}

/** "2026-11" or "2026-11-05" -> "2026-11-01". Anything else falls back to the month of `today`. */
export function parseMonthParam(value: string | undefined, today: LocalDate): LocalDate {
  if (value && /^\d{4}-\d{2}$/.test(value) && isLocalDate(`${value}-01`)) return `${value}-01`;
  return startOfMonth(today);
}

export function shiftMonth(month: LocalDate, delta: number): LocalDate {
  const { y, m } = parseLocalDate(month);
  const idx = y * 12 + (m - 1) + delta;
  return formatLocalDate(Math.floor(idx / 12), (idx % 12) + 1, 1);
}

export function computeBudget(input: {
  month: LocalDate;
  today: LocalDate;
  currency: string;
  incomes: IncomeSourceInput[];
  bills: BudgetBillInput[];
  categories: BudgetCategoryInput[];
  expenses: ExpenseInput[];
}): BudgetSummary {
  const month = startOfMonth(input.month);
  const monthEnd = endOfMonth(month);
  const cur = input.currency;
  let otherCurrencyCount = 0;
  const same = (c: string) => {
    if (c === cur) return true;
    otherCurrencyCount++;
    return false;
  };

  const lines: IncomeLine[] = [];
  for (const s of input.incomes) {
    if (!same(s.currency)) continue;
    const dates = incomeDatesInMonth(s.anchor_date, s.recurrence, month);
    lines.push({ id: s.id, name: s.name, recurrence: s.recurrence, amount_minor: s.amount_minor, dates, total_minor: dates.length * s.amount_minor });
  }
  const incomeTotal = lines.reduce((t, l) => t + l.total_minor, 0);

  let paid = 0;
  let unpaid = 0;
  let billCount = 0;
  for (const b of input.bills) {
    if (b.due_date < month || b.due_date > monthEnd) continue;
    if (!same(b.currency)) continue;
    billCount++;
    if (b.paid) paid += b.amount_minor;
    else unpaid += b.amount_minor;
  }
  const billsTotal = paid + unpaid;

  const spentBy = new Map<string | null, number>();
  let spent = 0;
  for (const e of input.expenses) {
    if (e.spent_on < month || e.spent_on > monthEnd) continue;
    if (!same(e.currency)) continue;
    const key = e.category_id && input.categories.some((c) => c.id === e.category_id) ? e.category_id : null;
    spentBy.set(key, (spentBy.get(key) ?? 0) + e.amount_minor);
    spent += e.amount_minor;
  }

  const categories: CategoryLine[] = input.categories.map((c) => line(c.id, c.name, c.monthly_limit_minor, spentBy.get(c.id) ?? 0));
  const uncategorized = spentBy.get(null) ?? 0;
  if (uncategorized > 0) categories.push(line(null, "Uncategorized", null, uncategorized));
  const planned = input.categories.reduce((t, c) => t + (c.monthly_limit_minor ?? 0), 0);

  const timing: MonthTiming = input.today < month ? "future" : input.today > monthEnd ? "past" : "current";
  const left = incomeTotal - billsTotal - spent;
  const daysLeft = timing === "current" ? diffDays(monthEnd, input.today) + 1 : null;
  const perDay = daysLeft && left > 0 ? Math.floor(left / daysLeft) : null;

  return {
    month,
    monthEnd,
    timing,
    currency: cur,
    income: { total_minor: incomeTotal, lines },
    bills: { total_minor: billsTotal, paid_minor: paid, unpaid_minor: unpaid, count: billCount },
    spent_minor: spent,
    categories,
    planned_minor: planned,
    unassigned_minor: incomeTotal - billsTotal - planned,
    left_minor: left,
    daysLeft,
    perDay_minor: perDay,
    otherCurrencyCount,
    hasIncome: input.incomes.length > 0,
  };
}

function line(id: string | null, name: string, limit: number | null, spent: number): CategoryLine {
  return {
    id,
    name,
    limit_minor: limit,
    spent_minor: spent,
    remaining_minor: limit === null ? null : limit - spent,
    used: limit === null ? null : limit === 0 ? (spent > 0 ? Infinity : 0) : spent / limit,
    over: limit !== null && spent > limit,
  };
}

/**
 * Pay dates that fall in a month. Unlike bills, a recurring income runs in both directions from
 * the date given, so entering your next pay date still counts the earlier ones this month.
 * Month-based schedules keep the anchor's day, clamped to short months (31st -> Feb 28/29).
 */
export function incomeDatesInMonth(anchor: LocalDate, recurrence: Recurrence, month: LocalDate): LocalDate[] {
  const start = startOfMonth(month);
  const end = endOfMonth(start);
  if (recurrence === "once") return anchor >= start && anchor <= end ? [anchor] : [];
  if (recurrence === "weekly" || recurrence === "biweekly") {
    const p = recurrence === "weekly" ? 7 : 14;
    const offset = (((diffDays(start, anchor) % p) + p) % p);
    const out: LocalDate[] = [];
    for (let d = addDays(start, (p - offset) % p); d <= end; d = addDays(d, p)) out.push(d);
    return out;
  }
  const a = parseLocalDate(anchor);
  const m = parseLocalDate(start);
  const step = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
  const delta = (m.y - a.y) * 12 + (m.m - a.m);
  if ((((delta % step) + step) % step) !== 0) return [];
  return [formatLocalDate(m.y, m.m, Math.min(a.d, daysInMonth(m.y, m.m)))];
}

/** Share of the month that has passed, 0..1 (counting today as passed). */
export function monthElapsed(month: LocalDate, today: LocalDate): number {
  const end = endOfMonth(month);
  if (today < month) return 0;
  if (today > end) return 1;
  const total = diffDays(addDays(end, 1), month);
  return (diffDays(today, month) + 1) / total;
}

export type BudgetState = "no_income" | "over" | "category_over" | "running_hot" | "on_track" | "closed_under" | "planning";

/** The single most important thing about this month, used to pick Billy's mood and line. */
export function budgetState(s: BudgetSummary, today: LocalDate): { state: BudgetState; categoryName?: string } {
  if (!s.hasIncome) return { state: "no_income" };
  if (s.left_minor < 0) return { state: "over" };
  const over = s.categories.filter((c) => c.over).sort((a, b) => b.spent_minor - (b.limit_minor ?? 0) - (a.spent_minor - (a.limit_minor ?? 0)));
  if (over.length > 0) return { state: "category_over", categoryName: over[0].name };
  if (s.timing === "future") return { state: "planning" };
  if (s.timing === "past") return { state: "closed_under" };
  // Spending pace: compare spending against the money available for it so far this month.
  const available = s.income.total_minor - s.bills.total_minor;
  if (available > 0 && s.spent_minor > 0) {
    const pace = s.spent_minor / available;
    if (pace > monthElapsed(s.month, today) + 0.15) return { state: "running_hot" };
  }
  return { state: "on_track" };
}
