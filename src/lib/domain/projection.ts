import { incomeDatesInMonth, shiftMonth, type IncomeSourceInput } from "./budget";
import type { LocalDate } from "./dates";

/**
 * Goal projections: "keep setting aside $X a month and you'll reach $Y by <month>".
 * Deterministic and deliberately simple: a fixed monthly contribution added at the end of each
 * month, with optional growth compounded monthly from an expected yearly return. Projections are
 * estimates, never promises; the UI says so.
 */

export interface ProjectionPoint {
  /** First day of the month the value is reached at the end of. */
  month: LocalDate;
  /** Months from now (0 = today's balance). */
  index: number;
  value_minor: number;
  /** Balance + contributions only, without growth. */
  contributed_minor: number;
}

export interface Projection {
  monthly_minor: number;
  /** Month-by-month values from now out to MAX_PROJECTION_MONTHS. */
  points: ProjectionPoint[];
  /** Month the target is first reached, or null (no target, or out of reach within the cap). */
  reach: ProjectionPoint | null;
  /** The chart length shown first: long enough to see the target, otherwise 10 years. */
  defaultYears: Horizon;
}

/** Projection lengths the user can pick, in years. */
export const HORIZONS = [5, 10, 20, 30, 40, 50] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Three checkpoints to show for a projection length, ending at it. */
export function milestoneYears(horizon: Horizon): [number, number, number] {
  const map: Record<Horizon, [number, number, number]> = { 5: [1, 3, 5], 10: [1, 5, 10], 20: [5, 10, 20], 30: [10, 20, 30], 40: [10, 20, 40], 50: [10, 25, 50] };
  return map[horizon];
}

export function isHorizon(v: unknown): v is Horizon {
  return HORIZONS.includes(v as Horizon);
}

export const MAX_PROJECTION_MONTHS = 600; // 50 years

/** Average monthly income over the next 12 months, so % goals reflect 2- and 3-payday months fairly. */
export function typicalMonthlyIncome(incomes: IncomeSourceInput[], fromMonth: LocalDate, currency: string): number {
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const m = shiftMonth(fromMonth, i);
    for (const s of incomes) if (s.currency === currency) total += incomeDatesInMonth(s.anchor_date, s.recurrence, m).length * s.amount_minor;
  }
  return Math.round(total / 12);
}

export function goalMonthlyContribution(goal: { amount_minor: number | null; percent_bp: number | null }, monthlyIncome: number): number {
  return goal.amount_minor ?? Math.floor((monthlyIncome * (goal.percent_bp ?? 0)) / 10000);
}

export function projectGoal(input: {
  startMonth: LocalDate;
  balance_minor: number;
  monthly_minor: number;
  annual_return_bp: number;
  target_minor: number | null;
}): Projection {
  const r = input.annual_return_bp / 10000 / 12;
  const step = (v: number) => v * (1 + r) + input.monthly_minor;
  let value = input.balance_minor;
  let contributed = input.balance_minor;
  const all: ProjectionPoint[] = [{ month: input.startMonth, index: 0, value_minor: Math.round(value), contributed_minor: contributed }];
  let reach: ProjectionPoint | null = input.target_minor !== null && value >= input.target_minor ? all[0] : null;
  for (let i = 1; i <= MAX_PROJECTION_MONTHS; i++) {
    value = step(value);
    contributed += input.monthly_minor;
    const p = { month: shiftMonth(input.startMonth, i), index: i, value_minor: Math.round(value), contributed_minor: contributed };
    all.push(p);
    if (!reach && input.target_minor !== null && value >= input.target_minor) reach = p;
  }
  const reachYears = reach ? Math.ceil((reach.index * 1.1) / 12) : 0;
  const defaultYears: Horizon = reach ? (HORIZONS.find((h) => h >= Math.max(5, reachYears)) ?? 50) : 10;
  return { monthly_minor: input.monthly_minor, points: all, reach, defaultYears };
}
