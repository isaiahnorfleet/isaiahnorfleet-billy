import { describe, expect, it } from "vitest";
import { OTHER_KEY, spendingInsights, spendingStory, trendMonths } from "@/lib/domain/spending-insights";
import { formatMoney } from "@/lib/domain/money";

const cats = ["Groceries", "Eating out", "Gas", "Shopping", "Fun", "Personal care", "Pets"].map((name, i) => ({ id: `c${i}`, name }));
const NOV = "2026-11-01";
const OCT = "2026-10-01";
const money = (m: number) => formatMoney(m, "CAD");
const storyOpts = { tone: "straight" as const, timing: "current" as const, overLimit: [], money, monthName: "November", previousMonthName: "October" };

describe("trendMonths", () => {
  it("ends at the month and crosses the year", () => {
    expect(trendMonths("2026-02-01", 4)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });
});

describe("spendingInsights", () => {
  it("ranks this month's categories and computes shares", () => {
    const ins = spendingInsights({
      month: NOV,
      months: 6,
      categories: cats,
      rows: [
        { month: NOV, category_id: "c1", total_minor: 3000 },
        { month: NOV, category_id: "c0", total_minor: 6000 },
        { month: NOV, category_id: null, total_minor: 1000 },
      ],
    });
    expect(ins.total_minor).toBe(10000);
    expect(ins.parts.map((p) => [p.name, p.share])).toEqual([
      ["Groceries", 0.6],
      ["Eating out", 0.3],
      ["No category", 0.1],
    ]);
    // Spending without a category never gets its own color.
    expect(ins.parts[2].seriesKey).toBe(OTHER_KEY);
    expect(ins.series.map((s) => s.name)).toEqual(["Groceries", "Eating out", "Other"]);
  });

  it("gives colors by spending across the window, folding the tail into Other", () => {
    const rows = cats.map((c, i) => ({ month: OCT, category_id: c.id, total_minor: (10 - i) * 1000 }));
    rows.push({ month: NOV, category_id: "c6", total_minor: 50000 }); // Pets: small before, huge now
    const ins = spendingInsights({ month: NOV, months: 6, categories: cats, rows });
    expect(ins.series.map((s) => s.name)).toEqual(["Pets", "Groceries", "Eating out", "Gas", "Shopping", "Other"]);
    expect(ins.series.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, null]);
    const oct = ins.trend.find((t) => t.month === OCT)!;
    expect(oct.bySeries[OTHER_KEY]).toBe(6000 + 5000); // Fun + Personal care
    expect(oct.total_minor).toBe(Object.values(oct.bySeries).reduce((a, b) => a + b, 0));
    expect(ins.trend).toHaveLength(6);
    expect(ins.trend[5].month).toBe(NOV);
  });

  it("ignores rows outside the window and compares the top category with last month", () => {
    const ins = spendingInsights({
      month: NOV,
      months: 6,
      categories: cats,
      rows: [
        { month: "2026-01-01", category_id: "c0", total_minor: 99999 },
        { month: OCT, category_id: "c0", total_minor: 4000 },
        { month: NOV, category_id: "c0", total_minor: 5000 },
      ],
    });
    expect(ins.trend.reduce((a, t) => a + t.total_minor, 0)).toBe(9000);
    expect(ins.topVsPrevious).toEqual({ previous_minor: 4000, delta_minor: 1000 });
  });
});

describe("spendingStory", () => {
  const base = (rows: { month: string; category_id: string | null; total_minor: number }[]) => spendingInsights({ month: NOV, months: 6, categories: cats, rows });

  it("has a friendly empty state", () => {
    const s = spendingStory(base([]), storyOpts);
    expect(s.animation).toBe("idle");
    expect(s.body).toContain("+ button");
  });

  it("names the top category with its share", () => {
    const s = spendingStory(base([{ month: NOV, category_id: "c0", total_minor: 4000 }, { month: NOV, category_id: "c1", total_minor: 3000 }, { month: NOV, category_id: "c2", total_minor: 3000 }]), storyOpts);
    expect(s.headline).toBe("Groceries leads the way");
    expect(s.body).toBe("$40.00 of your $100.00 so far, 40% of your spending.");
    expect(s.animation).toBe("all-clear");
  });

  it("flags a category taking most of it, and an over-limit top category by tone", () => {
    const ins = base([{ month: NOV, category_id: "c0", total_minor: 8000 }, { month: NOV, category_id: "c1", total_minor: 2000 }]);
    expect(spendingStory(ins, storyOpts).headline).toBe("Groceries is taking most of it");
    expect(spendingStory(ins, { ...storyOpts, overLimit: ["Groceries"], tone: "extra" }).animation).toBe("about-to-snap");
    expect(spendingStory(ins, { ...storyOpts, overLimit: ["Groceries"], tone: "gentle" }).animation).toBe("heads-up");
  });

  it("compares finished months only", () => {
    const ins = base([{ month: OCT, category_id: "c0", total_minor: 3000 }, { month: NOV, category_id: "c0", total_minor: 5000 }]);
    expect(spendingStory(ins, storyOpts).body).not.toContain("October");
    expect(spendingStory(ins, { ...storyOpts, timing: "past" }).body).toContain("$20.00 more than October");
  });
});
