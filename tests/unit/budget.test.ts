import { describe, expect, it } from "vitest";
import { budgetState, computeBudget, incomeDatesInMonth, monthElapsed, parseMonthParam, shiftMonth } from "@/lib/domain/budget";
import { budgetMessage } from "@/lib/domain/budget-messages";
import type { Tone } from "@/lib/domain/billy-messages";

const BANNED = /late fee|credit score|penalt|lazy|stupid|irresponsible|broke\b|fail/i;

const base = {
  month: "2026-11-01",
  today: "2026-11-11",
  currency: "CAD",
  incomes: [{ id: "i1", name: "Paycheque", amount_minor: 200000, currency: "CAD", recurrence: "biweekly" as const, anchor_date: "2026-11-06" }],
  bills: [
    { amount_minor: 145000, currency: "CAD", due_date: "2026-11-01", paid: true },
    { amount_minor: 11248, currency: "CAD", due_date: "2026-11-15", paid: false },
    { amount_minor: 9999, currency: "CAD", due_date: "2026-12-01", paid: false },
  ],
  categories: [
    { id: "c1", name: "Groceries", monthly_limit_minor: 50000 },
    { id: "c2", name: "Fun", monthly_limit_minor: null },
  ],
  expenses: [
    { category_id: "c1", amount_minor: 12000, currency: "CAD", spent_on: "2026-11-03" },
    { category_id: "c2", amount_minor: 4000, currency: "CAD", spent_on: "2026-11-08" },
    { category_id: null, amount_minor: 1500, currency: "CAD", spent_on: "2026-11-09" },
    { category_id: "c1", amount_minor: 99999, currency: "CAD", spent_on: "2026-10-30" },
  ],
};

describe("income pay dates", () => {
  it("counts biweekly paydays in both directions from the date given", () => {
    // Entering the NEXT pay date still counts the earlier one this month.
    expect(incomeDatesInMonth("2026-11-20", "biweekly", "2026-11-01")).toEqual(["2026-11-06", "2026-11-20"]);
    expect(incomeDatesInMonth("2026-10-02", "biweekly", "2026-10-01")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
    expect(incomeDatesInMonth("2026-11-06", "weekly", "2026-11-01")).toEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  });

  it("clamps month-based pay dates to short months", () => {
    expect(incomeDatesInMonth("2026-01-31", "monthly", "2027-02-01")).toEqual(["2027-02-28"]);
    expect(incomeDatesInMonth("2026-03-31", "monthly", "2025-11-01")).toEqual(["2025-11-30"]);
    expect(incomeDatesInMonth("2026-01-15", "quarterly", "2026-04-01")).toEqual(["2026-04-15"]);
    expect(incomeDatesInMonth("2026-01-15", "quarterly", "2026-05-01")).toEqual([]);
    expect(incomeDatesInMonth("2026-06-01", "yearly", "2027-06-01")).toEqual(["2027-06-01"]);
  });

  it("counts one-time income only in its month", () => {
    expect(incomeDatesInMonth("2026-11-20", "once", "2026-11-01")).toEqual(["2026-11-20"]);
    expect(incomeDatesInMonth("2026-11-20", "once", "2026-12-01")).toEqual([]);
  });
});

describe("computeBudget", () => {
  it("works out left to spend from income, bills and spending in the month", () => {
    const s = computeBudget(base);
    expect(s.income.total_minor).toBe(400000);
    expect(s.bills).toEqual({ total_minor: 156248, paid_minor: 145000, unpaid_minor: 11248, count: 2 });
    expect(s.spent_minor).toBe(17500);
    expect(s.left_minor).toBe(400000 - 156248 - 17500);
    expect(s.planned_minor).toBe(50000);
    expect(s.unassigned_minor).toBe(400000 - 156248 - 50000);
    expect(s.timing).toBe("current");
    expect(s.daysLeft).toBe(20);
    expect(s.perDay_minor).toBe(Math.floor(s.left_minor / 20));
  });

  it("tracks each category against its limit and collects uncategorized spending", () => {
    const s = computeBudget(base);
    const groceries = s.categories.find((c) => c.id === "c1")!;
    expect(groceries).toMatchObject({ spent_minor: 12000, remaining_minor: 38000, over: false });
    expect(s.categories.find((c) => c.id === "c2")).toMatchObject({ limit_minor: null, remaining_minor: null, over: false });
    expect(s.categories.find((c) => c.id === null)).toMatchObject({ name: "Uncategorized", spent_minor: 1500 });
  });

  it("does not mix currencies", () => {
    const s = computeBudget({ ...base, expenses: [...base.expenses, { category_id: "c1", amount_minor: 5000, currency: "USD", spent_on: "2026-11-05" }] });
    expect(s.spent_minor).toBe(17500);
    expect(s.otherCurrencyCount).toBe(1);
  });

  it("treats spending in a deleted category as uncategorized", () => {
    const s = computeBudget({ ...base, categories: [] });
    expect(s.categories).toHaveLength(1);
    expect(s.categories[0]).toMatchObject({ id: null, spent_minor: 17500 });
  });
});

describe("budget state and Billy's reaction", () => {
  it("picks the most important state", () => {
    expect(budgetState(computeBudget({ ...base, incomes: [] }), base.today).state).toBe("no_income");
    expect(budgetState(computeBudget(base), base.today).state).toBe("on_track");
    const overCat = computeBudget({ ...base, expenses: [{ category_id: "c1", amount_minor: 60000, currency: "CAD", spent_on: "2026-11-02" }] });
    expect(budgetState(overCat, base.today)).toEqual({ state: "category_over", categoryName: "Groceries" });
    const overall = computeBudget({ ...base, expenses: [{ category_id: "c2", amount_minor: 300000, currency: "CAD", spent_on: "2026-11-02" }] });
    expect(budgetState(overall, base.today).state).toBe("over");
    // ~$2,440 available after bills; $1,500 spent by Nov 4 is far ahead of the calendar.
    const hot = computeBudget({ ...base, today: "2026-11-04", expenses: [{ category_id: "c2", amount_minor: 150000, currency: "CAD", spent_on: "2026-11-02" }] });
    expect(budgetState(hot, "2026-11-04").state).toBe("running_hot");
    expect(budgetState(computeBudget({ ...base, today: "2026-12-05" }), "2026-12-05").state).toBe("closed_under");
    expect(budgetState(computeBudget({ ...base, today: "2026-10-20" }), "2026-10-20").state).toBe("planning");
  });

  it("measures how much of the month has passed", () => {
    expect(monthElapsed("2026-11-01", "2026-10-31")).toBe(0);
    expect(monthElapsed("2026-11-01", "2026-11-30")).toBe(1);
    expect(monthElapsed("2026-11-01", "2026-11-15")).toBe(0.5);
  });

  it("matches Billy's big reactions to the tone", () => {
    expect(budgetMessage("over", "extra", "s").animation).toBe("rage-mode");
    expect(budgetMessage("over", "gentle", "s").animation).toBe("dramatic-despair");
    expect(budgetMessage("closed_under", "straight", "s").mood).toBe("celebrating");
  });

  it("never shames or invents consequences, in any tone", () => {
    const states = ["no_income", "over", "category_over", "running_hot", "on_track", "closed_under", "planning"] as const;
    for (const tone of ["gentle", "straight", "extra"] as Tone[])
      for (const st of states)
        for (const seed of ["a", "b", "c", "d"]) {
          const m = budgetMessage(st, tone, seed, { category: "Groceries", left: "$120.00", perDay: "$6.00" });
          expect(m.headline + m.body).not.toMatch(BANNED);
          expect(m.body).not.toMatch(/undefined|\$\s/);
        }
  });
});

describe("month params", () => {
  it("parses and shifts months", () => {
    expect(parseMonthParam("2026-02", "2026-11-11")).toBe("2026-02-01");
    expect(parseMonthParam("2026-13", "2026-11-11")).toBe("2026-11-01");
    expect(parseMonthParam(undefined, "2026-11-11")).toBe("2026-11-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
  });
});
