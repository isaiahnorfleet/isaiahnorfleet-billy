import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/domain/summary";
import { occurrenceState } from "@/lib/domain/status";

const today = "2026-10-29";
const occ = (due_date: string, amount_minor: number, status: "open" | "paid" | "skipped" = "open") => ({
  due_date,
  amount_minor,
  status,
  currency: "CAD",
});

describe("dashboard summary", () => {
  it("puts each open bill in exactly one bucket (no double counting)", () => {
    const s = summarize(
      [occ("2026-10-15", 11248), occ("2026-10-29", 5000), occ("2026-11-01", 145000), occ("2026-11-05", 7999), occ("2026-11-06", 100)],
      [],
      today,
    );
    expect(s.overdue).toEqual({ count: 1, totals: { CAD: 11248 } });
    expect(s.dueToday).toEqual({ count: 1, totals: { CAD: 5000 } });
    // Nov 1 and Nov 5 are within 7 days; Nov 6 is day 8.
    expect(s.next7).toEqual({ count: 2, totals: { CAD: 152999 } });
  });

  it("counts only non-voided payments made this month", () => {
    const s = summarize([], [
      { paid_on: "2026-10-03", amount_minor: 1000, currency: "CAD", voided: false },
      { paid_on: "2026-10-04", amount_minor: 2000, currency: "CAD", voided: true },
      { paid_on: "2026-09-30", amount_minor: 4000, currency: "CAD", voided: false },
    ], today);
    expect(s.paidThisMonth).toEqual({ count: 1, totals: { CAD: 1000 } });
  });

  it("tracks monthly completion", () => {
    const s = summarize([occ("2026-10-01", 1, "paid"), occ("2026-10-15", 1), occ("2026-10-31", 1), occ("2026-11-01", 1)], [], today);
    expect(s.monthProgress).toEqual({ paid: 1, total: 3 });
  });
});

describe("occurrence state", () => {
  it("an unpaid past occurrence stays overdue regardless of newer cycles", () => {
    expect(occurrenceState("open", "2026-09-01", today)).toBe("overdue");
    expect(occurrenceState("paid", "2026-09-01", today)).toBe("paid");
    expect(occurrenceState("open", today, today)).toBe("due_today");
    expect(occurrenceState("open", "2026-11-05", today)).toBe("due_soon");
    expect(occurrenceState("open", "2026-11-06", today)).toBe("upcoming");
  });
});
