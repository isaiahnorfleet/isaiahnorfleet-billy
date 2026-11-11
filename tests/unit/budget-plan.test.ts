import { describe, expect, it } from "vitest";
import { budgetState, computeBudget, splitByWeight } from "@/lib/domain/budget";
import { goalMonthlyContribution, projectGoal, typicalMonthlyIncome } from "@/lib/domain/projection";

const base = {
  month: "2026-11-01",
  today: "2026-11-11",
  currency: "CAD",
  incomes: [{ id: "i1", name: "Paycheque", amount_minor: 200000, currency: "CAD", recurrence: "biweekly" as const, anchor_date: "2026-11-06" }],
  bills: [{ amount_minor: 150000, currency: "CAD", due_date: "2026-11-01", paid: true }],
  categories: [
    { id: "g", name: "Groceries", monthly_limit_minor: null },
    { id: "e", name: "Eating out", monthly_limit_minor: null },
    { id: "r", name: "Rent savings", monthly_limit_minor: 20000 },
  ],
  expenses: [],
};

describe("goals and spending money", () => {
  it("takes fixed and % goals out before spending money", () => {
    const s = computeBudget({
      ...base,
      goals: [
        { id: "s", name: "Savings", amount_minor: null, percent_bp: 1000 },
        { id: "v", name: "Investing", amount_minor: 20000, percent_bp: null },
      ],
    });
    expect(s.income.total_minor).toBe(400000);
    expect(s.goals.lines.map((g) => g.total_minor)).toEqual([40000, 20000]);
    expect(s.spendable_minor).toBe(400000 - 150000 - 60000);
    expect(s.left_minor).toBe(s.spendable_minor);
  });

  it("says goals are squeezed when spending eats into them but not past income", () => {
    const goals = [{ id: "s", name: "Savings", amount_minor: 100000, percent_bp: null }];
    const squeezed = computeBudget({ ...base, goals, expenses: [{ category_id: "g", amount_minor: 200000, currency: "CAD", spent_on: "2026-11-05" }] });
    expect(budgetState(squeezed, base.today).state).toBe("goals_squeezed");
    const over = computeBudget({ ...base, goals, expenses: [{ category_id: "g", amount_minor: 300000, currency: "CAD", spent_on: "2026-11-05" }] });
    expect(budgetState(over, base.today).state).toBe("over");
  });
});

describe("Billy's automatic limits", () => {
  it("keeps fixed limits and splits the rest across the others", () => {
    const s = computeBudget({ ...base, autoLimits: true });
    const pool = 400000 - 150000 - 20000;
    const byId = Object.fromEntries(s.categories.map((c) => [c.id, c]));
    expect(byId.r).toMatchObject({ limit_minor: 20000, auto: false });
    expect(byId.g.auto && byId.e.auto).toBe(true);
    expect(byId.g.limit_minor! + byId.e.limit_minor!).toBe(pool);
    // Starter weights: groceries gets more than eating out.
    expect(byId.g.limit_minor!).toBeGreaterThan(byId.e.limit_minor!);
    expect(s.unassigned_minor).toBe(0);
  });

  it("follows past spending when there is some", () => {
    const s = computeBudget({ ...base, autoLimits: true, history: new Map([["g", 10000], ["e", 30000]]) });
    const byId = Object.fromEntries(s.categories.map((c) => [c.id, c]));
    expect(byId.e.limit_minor!).toBeGreaterThan(byId.g.limit_minor!);
  });

  it("leaves limits alone when off", () => {
    const s = computeBudget(base);
    expect(s.categories.find((c) => c.id === "g")!.limit_minor).toBeNull();
  });

  it("splits into whole dollars that add up exactly", () => {
    const out = splitByWeight(123457, [1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(123457);
    expect(out.filter((x) => x % 100 === 0).length).toBeGreaterThanOrEqual(2);
    expect(splitByWeight(0, [1, 2])).toEqual([0, 0]);
  });
});

describe("goal projections", () => {
  it("finds the month a savings target is reached", () => {
    const p = projectGoal({ startMonth: "2026-11-01", balance_minor: 100000, monthly_minor: 50000, annual_return_bp: 0, target_minor: 1000000 });
    // $1,000 now + $500/month reaches $10,000 after 18 months.
    expect(p.reach).toMatchObject({ index: 18, month: "2028-05-01", value_minor: 1000000 });
    expect(p.milestones[0]).toMatchObject({ years: 1, value_minor: 700000, contributed_minor: 700000 });
  });

  it("compounds investment growth monthly", () => {
    const p = projectGoal({ startMonth: "2026-11-01", balance_minor: 0, monthly_minor: 10000, annual_return_bp: 600, target_minor: null });
    const tenYears = p.milestones[2];
    expect(tenYears.contributed_minor).toBe(1200000);
    // FV of $100/month at 6%/12 for 120 months ≈ $16,387.93
    expect(tenYears.value_minor).toBeGreaterThan(1638000);
    expect(tenYears.value_minor).toBeLessThan(1640000);
    expect(p.points).toHaveLength(61); // no target: 5-year chart
  });

  it("handles targets already reached or out of reach", () => {
    expect(projectGoal({ startMonth: "2026-11-01", balance_minor: 500, monthly_minor: 0, annual_return_bp: 0, target_minor: 100 }).reach?.index).toBe(0);
    expect(projectGoal({ startMonth: "2026-11-01", balance_minor: 0, monthly_minor: 100, annual_return_bp: 0, target_minor: 100000000 }).reach).toBeNull();
  });

  it("uses average monthly income so % goals aren't skewed by 3-payday months", () => {
    const monthly = typicalMonthlyIncome(base.incomes, "2026-11-01", "CAD");
    expect(monthly).toBe(Math.round((26 * 200000) / 12));
    expect(goalMonthlyContribution({ amount_minor: null, percent_bp: 1000 }, monthly)).toBe(Math.floor(monthly / 10));
  });
});
