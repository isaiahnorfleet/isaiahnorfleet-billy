import type { LocalDate } from "./dates";
import { shiftMonth } from "./budget";
import type { BillyAnimation } from "./billy-animation";
import type { Tone } from "./billy-messages";

/**
 * Where the money went: per-category spending for one month, plus the months before it, shaped for
 * the Budget tab's charts. Pure, so it's unit tested without a database.
 *
 * Colors follow the category, never its rank this month: the five categories with the most spending
 * across the whole window each get a fixed slot, and everything else (smaller categories and
 * spending without a category) shares the gray "Other" slot. Both charts use the same mapping, so a
 * category is the same color in the breakdown and in the trend.
 */

/** How many categories get their own color. More would stop being tellable apart (see the palette). */
export const SERIES_SLOTS = 5;
export const OTHER_KEY = "other";

export interface MonthCategoryTotal {
  /** First day of the month. */
  month: LocalDate;
  category_id: string | null;
  total_minor: number;
}

export interface Series {
  key: string;
  name: string;
  /** 0..SERIES_SLOTS-1, or null for Other. */
  slot: number | null;
}

export interface BreakdownPart {
  /** Category id, or "none" for spending without a category. */
  id: string;
  name: string;
  /** The series this category draws in (its own key, or "other"). */
  seriesKey: string;
  amount_minor: number;
  /** 0..1 share of the month's spending. */
  share: number;
}

export interface TrendMonth {
  month: LocalDate;
  total_minor: number;
  /** Amount per series key, in series order. */
  bySeries: Record<string, number>;
}

export interface SpendingInsights {
  month: LocalDate;
  total_minor: number;
  /** Every category with spending this month, largest first. */
  parts: BreakdownPart[];
  /** The colored series, in slot order, with Other last when anything folds into it. */
  series: Series[];
  /** Oldest first, ending at `month`. */
  trend: TrendMonth[];
  /** The same category last month, for "up/down from last month". Null when there's nothing to compare. */
  topVsPrevious: { previous_minor: number; delta_minor: number } | null;
}

const NONE = "none";

export function trendMonths(month: LocalDate, count: number): LocalDate[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
}

export function spendingInsights(input: {
  month: LocalDate;
  /** How many months the trend shows, ending at `month`. */
  months: number;
  categories: { id: string; name: string }[];
  rows: MonthCategoryTotal[];
}): SpendingInsights {
  const { month } = input;
  const window = trendMonths(month, input.months);
  const inWindow = new Set(window);
  const rows = input.rows.filter((r) => inWindow.has(r.month) && r.total_minor > 0);
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const keyOf = (id: string | null) => (id && names.has(id) ? id : NONE);
  const nameOf = (key: string) => (key === NONE ? "No category" : names.get(key)!);

  // Rank categories by spending across the whole window; ties go to the category list order.
  const order = new Map(input.categories.map((c, i) => [c.id, i]));
  const windowTotals = new Map<string, number>();
  for (const r of rows) windowTotals.set(keyOf(r.category_id), (windowTotals.get(keyOf(r.category_id)) ?? 0) + r.total_minor);
  const ranked = [...windowTotals.entries()]
    .filter(([k]) => k !== NONE)
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([k]) => k);
  const colored = ranked.slice(0, SERIES_SLOTS);
  const seriesKey = (key: string) => (colored.includes(key) ? key : OTHER_KEY);
  const series: Series[] = colored.map((k, i) => ({ key: k, name: nameOf(k), slot: i }));
  if (windowTotals.size > colored.length) series.push({ key: OTHER_KEY, name: "Other", slot: null });

  const trend: TrendMonth[] = window.map((m) => {
    const bySeries: Record<string, number> = Object.fromEntries(series.map((s) => [s.key, 0]));
    let total = 0;
    for (const r of rows) {
      if (r.month !== m) continue;
      bySeries[seriesKey(keyOf(r.category_id))] += r.total_minor;
      total += r.total_minor;
    }
    return { month: m, total_minor: total, bySeries };
  });

  const monthTotals = (m: LocalDate) => {
    const t = new Map<string, number>();
    for (const r of rows) if (r.month === m) t.set(keyOf(r.category_id), (t.get(keyOf(r.category_id)) ?? 0) + r.total_minor);
    return t;
  };
  const current = monthTotals(month);
  const total = [...current.values()].reduce((a, b) => a + b, 0);
  const parts: BreakdownPart[] = [...current.entries()]
    .map(([id, amount]) => ({ id, name: nameOf(id), seriesKey: seriesKey(id), amount_minor: amount, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount_minor - a.amount_minor || (a.id === NONE ? 1 : b.id === NONE ? -1 : (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));

  let topVsPrevious: SpendingInsights["topVsPrevious"] = null;
  if (parts.length > 0 && window.length > 1) {
    const prev = monthTotals(window[window.length - 2]);
    const prevTotal = [...prev.values()].reduce((a, b) => a + b, 0);
    if (prevTotal > 0) {
      const p = prev.get(parts[0].id) ?? 0;
      topVsPrevious = { previous_minor: p, delta_minor: parts[0].amount_minor - p };
    }
  }

  return { month, total_minor: total, parts, series, trend, topVsPrevious };
}

// ---------------------------------------------------------------------------
// Billy's take on the breakdown: which clip he plays and what he says.
// ---------------------------------------------------------------------------

export interface SpendingStory {
  animation: BillyAnimation;
  headline: string;
  body: string;
}

export function spendingStory(
  ins: SpendingInsights,
  opts: { tone: Tone; timing: "past" | "current" | "future"; overLimit: string[]; money: (minor: number) => string; monthName: string; previousMonthName: string },
): SpendingStory {
  const { money } = opts;
  if (ins.parts.length === 0) {
    return {
      animation: "idle",
      headline: opts.timing === "future" ? "Nothing to chart yet" : "A clean slate",
      body:
        opts.timing === "future"
          ? `${opts.monthName} hasn't started. Billy will chart where the money goes once it does.`
          : opts.timing === "past"
            ? `Nothing was logged in ${opts.monthName}.`
            : "Log what you spend with the + button and Billy will show where it all goes.",
    };
  }
  const top = ins.parts[0];
  const pct = Math.round(top.share * 100);
  const sofar = opts.timing === "current" ? " so far" : "";
  let body =
    ins.parts.length === 1
      ? `All ${money(top.amount_minor)} you've logged${sofar} went to ${top.name}.`
      : `${money(top.amount_minor)} of your ${money(ins.total_minor)}${sofar}, ${pct}% of your spending.`;
  // Comparing a month in progress against a whole month would always look "down", so only finished months compare.
  if (opts.timing === "past" && ins.topVsPrevious && ins.topVsPrevious.previous_minor > 0) {
    const d = ins.topVsPrevious.delta_minor;
    if (d !== 0) body += ` That's ${money(Math.abs(d))} ${d > 0 ? "more" : "less"} than ${opts.previousMonthName}.`;
  }

  const overTop = opts.overLimit.includes(top.name);
  if (overTop) {
    return {
      animation: opts.tone === "extra" ? "about-to-snap" : opts.tone === "straight" ? "overdue" : "heads-up",
      headline: `${top.name} is over its limit`,
      body,
    };
  }
  if (ins.parts.length > 1 && top.share >= 0.5) {
    return { animation: "heads-up", headline: `${top.name} is taking ${pct >= 75 ? "most" : "half"} of it`, body };
  }
  return {
    animation: opts.overLimit.length > 0 ? "heads-up" : opts.timing === "past" ? "smug-legend" : "all-clear",
    headline: `${top.name} leads the way`,
    body: opts.overLimit.length > 0 ? `${body} Watch ${opts.overLimit[0]}, it's over its limit.` : body,
  };
}
