import { addDays, daysInMonth, diffDays, endOfMonth, formatLocalDate, isLocalDate, parseLocalDate, startOfMonth, type LocalDate } from "./dates";
import type { Recurrence } from "./recurrence";

/**
 * Monthly budget math. Pure and deterministic: every figure is computed from stored rows for one
 * calendar month in the user's time zone. Only amounts in the user's main currency are counted;
 * anything in another currency is reported separately rather than silently mixed in.
 *
 *   spending money = income this month - bills due this month - goals (savings, investing, ...)
 *   left to spend  = spending money - spending logged this month
 *
 * With auto limits on, Billy splits the spending money across categories that have no fixed limit,
 * weighted by what was actually spent in each over the previous three months.
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

export interface GoalInput {
  id: string;
  name: string;
  amount_minor: number | null;
  /** Basis points of the month's income (1000 = 10%). */
  percent_bp: number | null;
}

export interface GoalLine {
  id: string;
  name: string;
  amount_minor: number | null;
  percent_bp: number | null;
  /** What this goal sets aside this month. */
  total_minor: number;
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
  /** True when Billy worked the limit out (auto limits) rather than the user fixing it. */
  auto: boolean;
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
  goals: { total_minor: number; lines: GoalLine[] };
  /** income - bills - goals. */
  spendable_minor: number;
  autoLimits: boolean;
  spent_minor: number;
  categories: CategoryLine[];
  /** Sum of category limits. */
  planned_minor: number;
  /** spendable - planned limits: money not assigned to a category (negative = over-planned). */
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
  goals?: GoalInput[];
  autoLimits?: boolean;
  /** Spending per category id over the previous months (any span); used to weight auto limits. */
  history?: Map<string, number>;
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

  const goalLines: GoalLine[] = (input.goals ?? []).map((g) => ({
    ...g,
    total_minor: g.amount_minor ?? Math.floor((incomeTotal * (g.percent_bp ?? 0)) / 10000),
  }));
  const goalsTotal = goalLines.reduce((t, g) => t + g.total_minor, 0);
  const spendable = incomeTotal - billsTotal - goalsTotal;

  const autoLimits = input.autoLimits ?? false;
  const limits = new Map<string, { limit: number | null; auto: boolean }>();
  for (const c of input.categories) limits.set(c.id, { limit: c.monthly_limit_minor, auto: false });
  if (autoLimits) {
    const fixed = input.categories.reduce((t, c) => t + (c.monthly_limit_minor ?? 0), 0);
    const flexible = input.categories.filter((c) => c.monthly_limit_minor === null);
    const split = splitByWeight(Math.max(0, spendable - fixed), flexible.map((c) => categoryWeight(c, flexible, input.history)));
    flexible.forEach((c, i) => limits.set(c.id, { limit: split[i], auto: true }));
  }

  const categories: CategoryLine[] = input.categories.map((c) => {
    const l = limits.get(c.id)!;
    return line(c.id, c.name, l.limit, spentBy.get(c.id) ?? 0, l.auto);
  });
  const uncategorized = spentBy.get(null) ?? 0;
  if (uncategorized > 0) categories.push(line(null, "Uncategorized", null, uncategorized));
  const planned = [...limits.values()].reduce((t, l) => t + (l.limit ?? 0), 0);

  const timing: MonthTiming = input.today < month ? "future" : input.today > monthEnd ? "past" : "current";
  const left = spendable - spent;
  const daysLeft = timing === "current" ? diffDays(monthEnd, input.today) + 1 : null;
  const perDay = daysLeft && left > 0 ? Math.floor(left / daysLeft) : null;

  return {
    month,
    monthEnd,
    timing,
    currency: cur,
    income: { total_minor: incomeTotal, lines },
    bills: { total_minor: billsTotal, paid_minor: paid, unpaid_minor: unpaid, count: billCount },
    goals: { total_minor: goalsTotal, lines: goalLines },
    spendable_minor: spendable,
    autoLimits,
    spent_minor: spent,
    categories,
    planned_minor: planned,
    unassigned_minor: spendable - planned,
    left_minor: left,
    daysLeft,
    perDay_minor: perDay,
    otherCurrencyCount,
    hasIncome: input.incomes.length > 0,
  };
}

/** Typical shares when there's no spending history yet. Anything else gets an average share. */
const STARTER_WEIGHTS: Record<string, number> = {
  groceries: 35,
  "eating out": 12,
  "gas & transit": 15,
  shopping: 12,
  fun: 10,
  "personal care": 8,
};

function categoryWeight(c: BudgetCategoryInput, all: BudgetCategoryInput[], history?: Map<string, number>): number {
  const hist = all.map((x) => history?.get(x.id) ?? 0);
  const histTotal = hist.reduce((t, x) => t + x, 0);
  if (histTotal > 0) {
    // Follow real spending, with a floor so a category you haven't used yet still gets something.
    const floor = histTotal / all.length / 4;
    return Math.max(history?.get(c.id) ?? 0, floor);
  }
  const known = all.map((x) => STARTER_WEIGHTS[x.name.trim().toLowerCase()]).filter((w): w is number => w !== undefined);
  const avg = known.length > 0 ? known.reduce((t, w) => t + w, 0) / known.length : 1;
  return STARTER_WEIGHTS[c.name.trim().toLowerCase()] ?? avg;
}

/** Split `total` cents by weight, rounded down to whole dollars; the leftover goes to the biggest share. */
export function splitByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((t, w) => t + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((total * w) / sum / 100) * 100);
  let biggest = 0;
  weights.forEach((w, i) => {
    if (w > weights[biggest]) biggest = i;
  });
  out[biggest] += total - out.reduce((t, x) => t + x, 0);
  return out;
}

function line(id: string | null, name: string, limit: number | null, spent: number, auto = false): CategoryLine {
  return {
    id,
    name,
    auto,
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

export type BudgetState = "no_income" | "goals_squeezed" | "over" | "category_over" | "running_hot" | "on_track" | "closed_under" | "planning";

/** The single most important thing about this month, used to pick Billy's mood and line. */
export function budgetState(s: BudgetSummary, today: LocalDate): { state: BudgetState; categoryName?: string } {
  if (!s.hasIncome) return { state: "no_income" };
  if (s.left_minor < 0) {
    // Still within income, but not enough left to fully fund the goals.
    if (s.goals.total_minor > 0 && s.left_minor + s.goals.total_minor >= 0) return { state: "goals_squeezed" };
    return { state: "over" };
  }
  const over = s.categories.filter((c) => c.over).sort((a, b) => b.spent_minor - (b.limit_minor ?? 0) - (a.spent_minor - (a.limit_minor ?? 0)));
  if (over.length > 0) return { state: "category_over", categoryName: over[0].name };
  if (s.timing === "future") return { state: "planning" };
  if (s.timing === "past") return { state: "closed_under" };
  // Spending pace: compare spending against the money available for it so far this month.
  const available = s.spendable_minor;
  if (available > 0 && s.spent_minor > 0) {
    const pace = s.spent_minor / available;
    if (pace > monthElapsed(s.month, today) + 0.15) return { state: "running_hot" };
  }
  return { state: "on_track" };
}
