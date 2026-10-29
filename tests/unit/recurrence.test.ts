import { describe, expect, it } from "vitest";
import { nthOccurrence, nextOccurrenceOnOrAfter, occurrencesBetween } from "@/lib/domain/recurrence";
import { addMonthsClamped, dayOfWeek, todayIn, zonedInstant } from "@/lib/domain/dates";

describe("monthly recurrence keeps its anchor", () => {
  it("a bill due on the 31st uses the last day of short months and returns to the 31st", () => {
    const dates = [0, 1, 2, 3, 4].map((n) => nthOccurrence("2026-01-31", "monthly", n));
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("handles leap-year February", () => {
    expect(nthOccurrence("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(nthOccurrence("2028-01-30", "monthly", 1)).toBe("2028-02-29");
    expect(nthOccurrence("2027-01-29", "monthly", 1)).toBe("2027-02-28");
  });

  it("does not drift after passing through February", () => {
    // A naive implementation that adds one month to the previous date would get stuck on the 28th.
    expect(nthOccurrence("2026-01-30", "monthly", 2)).toBe("2026-03-30");
    expect(nthOccurrence("2026-01-31", "monthly", 13)).toBe("2027-02-28");
    expect(nthOccurrence("2026-01-31", "monthly", 14)).toBe("2027-03-31");
  });

  it("yearly bills anchored on Feb 29 fall on Feb 28 in non-leap years and come back", () => {
    expect([0, 1, 2, 3, 4].map((n) => nthOccurrence("2028-02-29", "yearly", n))).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("quarterly from Nov 30 clamps to Feb 28 and returns to May 30", () => {
    expect([0, 1, 2].map((n) => nthOccurrence("2026-11-30", "quarterly", n))).toEqual(["2026-11-30", "2027-02-28", "2027-05-30"]);
  });

  it("crosses year boundaries correctly", () => {
    expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsClamped("2026-12-31", 2)).toBe("2027-02-28");
  });
});

describe("weekly and biweekly", () => {
  it("keeps the weekday across a DST change", () => {
    // Toronto falls back on 2026-11-01. Date arithmetic must not be affected.
    const dates = occurrencesBetween("2026-10-23", "weekly", "2026-10-23", "2026-11-20");
    expect(dates).toEqual(["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20"]);
    expect(new Set(dates.map(dayOfWeek))).toEqual(new Set([5]));
  });

  it("biweekly spaces 14 days apart", () => {
    expect(occurrencesBetween("2026-10-02", "biweekly", "2026-10-01", "2026-11-30")).toEqual([
      "2026-10-02",
      "2026-10-16",
      "2026-10-30",
      "2026-11-13",
      "2026-11-27",
    ]);
  });
});

describe("range queries", () => {
  it("never produces dates before the anchor", () => {
    expect(occurrencesBetween("2026-11-15", "monthly", "2026-01-01", "2026-12-31")).toEqual(["2026-11-15", "2026-12-15"]);
  });

  it("one-time bills have exactly one occurrence", () => {
    expect(occurrencesBetween("2026-11-15", "once", "2026-01-01", "2027-12-31")).toEqual(["2026-11-15"]);
    expect(nextOccurrenceOnOrAfter("2026-11-15", "once", "2026-11-16")).toBeNull();
  });

  it("finds the next occurrence far from the anchor", () => {
    expect(nextOccurrenceOnOrAfter("2020-01-31", "monthly", "2026-02-10")).toBe("2026-02-28");
    expect(nextOccurrenceOnOrAfter("2020-01-31", "monthly", "2026-03-01")).toBe("2026-03-31");
  });
});

describe("time zones", () => {
  it("today's date depends on the user's zone, not UTC", () => {
    // 2026-10-30 02:30 UTC is still Oct 29 in Toronto (EDT, UTC-4).
    const instant = new Date("2026-10-30T02:30:00Z");
    expect(todayIn("America/Toronto", instant)).toBe("2026-10-29");
    expect(todayIn("UTC", instant)).toBe("2026-10-30");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-10-30");
  });

  it("9:00 local stays 9:00 local on both sides of a DST change", () => {
    expect(zonedInstant("2026-10-31", 9 * 60, "America/Toronto").toISOString()).toBe("2026-10-31T13:00:00.000Z"); // EDT
    expect(zonedInstant("2026-11-02", 9 * 60, "America/Toronto").toISOString()).toBe("2026-11-02T14:00:00.000Z"); // EST
    expect(zonedInstant("2027-03-15", 9 * 60, "America/Toronto").toISOString()).toBe("2027-03-15T13:00:00.000Z"); // EDT again
  });

  it("a wall-clock time inside the spring-forward gap still resolves to a real instant", () => {
    const at = zonedInstant("2027-03-14", 2 * 60 + 30, "America/Toronto");
    expect(at.toISOString()).toBe("2027-03-14T07:30:00.000Z"); // shifted to 03:30 EDT
  });
});
