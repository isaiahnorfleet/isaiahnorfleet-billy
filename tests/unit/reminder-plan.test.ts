import { describe, expect, it } from "vitest";
import { applyQuietHours, isInQuietHours, planReminders, reminderSlots, type PlanPrefs } from "@/lib/domain/reminder-plan";

const prefs: PlanPrefs = {
  timeZone: "America/Toronto",
  defaultOffsets: [3, 1, 0],
  reminderHour: 9,
  overdueFollowups: true,
  overdueFollowupDays: 3,
  quietHoursEnabled: true,
  quietStart: 21 * 60,
  quietEnd: 8 * 60,
};
const bill = { remindersEnabled: true, reminderOffsets: null, active: true };
const occ = (dueDate: string, extra: Partial<{ status: "open" | "paid"; snoozedUntil: Date | null; createdAt: Date }> = {}) => ({
  id: "occ1",
  dueDate,
  status: extra.status ?? "open",
  snoozedUntil: extra.snoozedUntil ?? null,
  createdAt: extra.createdAt ?? new Date("2026-01-01T00:00:00Z"),
});

describe("reminder slots", () => {
  it("3 days before, 1 day before, due day, then bounded overdue follow-ups", () => {
    expect(reminderSlots(occ("2026-11-10"), bill, prefs)).toEqual([
      { kind: "before", slotDate: "2026-11-07" },
      { kind: "before", slotDate: "2026-11-09" },
      { kind: "due", slotDate: "2026-11-10" },
      { kind: "overdue", slotDate: "2026-11-11" },
      { kind: "overdue", slotDate: "2026-11-12" },
      { kind: "overdue", slotDate: "2026-11-13" },
    ]);
  });

  it("per-bill offsets override the global defaults", () => {
    const slots = reminderSlots(occ("2026-11-10"), { ...bill, reminderOffsets: [7] }, { ...prefs, overdueFollowups: false });
    expect(slots).toEqual([{ kind: "before", slotDate: "2026-11-03" }]);
  });
});

describe("planReminders", () => {
  it("plans today's due reminder at 9:00 Toronto time for each channel with a unique key", () => {
    const now = new Date("2026-11-10T12:00:00Z"); // 07:00 EST
    const planned = planReminders(occ("2026-11-10"), bill, prefs, ["push", "email"], now);
    const due = planned.filter((p) => p.kind === "due");
    expect(due.map((p) => p.channel)).toEqual(["push", "email"]);
    expect(due[0].sendAt.toISOString()).toBe("2026-11-10T14:00:00.000Z");
    expect(new Set(planned.map((p) => p.dedupeKey)).size).toBe(planned.length);
  });

  it("is deterministic, so repeated runs produce the same keys", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const a = planReminders(occ("2026-11-10"), bill, prefs, ["push"], now).map((p) => p.dedupeKey);
    const b = planReminders(occ("2026-11-10"), bill, prefs, ["push"], new Date(now.getTime() + 5 * 60_000)).map((p) => p.dedupeKey);
    expect(a).toEqual(b);
  });

  it("plans nothing for a paid occurrence", () => {
    expect(planReminders(occ("2026-11-10", { status: "paid" }), bill, prefs, ["push"], new Date("2026-11-10T12:00:00Z"))).toEqual([]);
  });

  it("plans nothing when the bill's reminders are off or no channel is available", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(planReminders(occ("2026-11-10"), { ...bill, remindersEnabled: false }, prefs, ["push"], now)).toEqual([]);
    expect(planReminders(occ("2026-11-10"), bill, prefs, [], now)).toEqual([]);
  });

  it("a snooze suppresses reminders that would fire before it ends but leaves the due date alone", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const o = occ("2026-11-10", { snoozedUntil: new Date("2026-11-11T13:00:00Z") });
    const planned = planReminders(o, bill, prefs, ["push"], now);
    expect(planned.find((p) => p.kind === "due")).toBeUndefined();
    expect(o.dueDate).toBe("2026-11-10");
  });

  it("does not plan reminders for times before the bill was created", () => {
    const now = new Date("2026-11-09T18:00:00Z");
    const created = new Date("2026-11-09T17:00:00Z"); // after 9:00 today
    const planned = planReminders(occ("2026-11-10", { createdAt: created }), bill, prefs, ["push"], now);
    expect(planned.map((p) => p.kind)).toEqual(["due"]);
  });

  it("does not resend reminders from long ago after an outage", () => {
    const now = new Date("2026-11-12T14:00:00Z");
    const planned = planReminders(occ("2026-11-10"), bill, prefs, ["push"], now);
    expect(planned.map((p) => p.slotDate)).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("keeps 9:00 local across the November DST change", () => {
    const before = planReminders(occ("2026-10-31"), bill, prefs, ["push"], new Date("2026-10-31T10:00:00Z"));
    const after = planReminders(occ("2026-11-02"), bill, prefs, ["push"], new Date("2026-11-02T10:00:00Z"));
    expect(before.find((p) => p.kind === "due")!.sendAt.toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(after.find((p) => p.kind === "due")!.sendAt.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("quiet hours", () => {
  it("handles windows that cross midnight", () => {
    expect(isInQuietHours(22 * 60, 21 * 60, 8 * 60)).toBe(true);
    expect(isInQuietHours(7 * 60, 21 * 60, 8 * 60)).toBe(true);
    expect(isInQuietHours(12 * 60, 21 * 60, 8 * 60)).toBe(false);
    expect(isInQuietHours(13 * 60, 12 * 60, 14 * 60)).toBe(true);
  });

  it("moves a reminder out of quiet hours to the next morning", () => {
    // 22:30 EST on Nov 10 -> 08:00 EST Nov 11
    const moved = applyQuietHours(new Date("2026-11-11T03:30:00Z"), prefs);
    expect(moved.toISOString()).toBe("2026-11-11T13:00:00.000Z");
    // 06:00 EST -> 08:00 same day
    expect(applyQuietHours(new Date("2026-11-11T11:00:00Z"), prefs).toISOString()).toBe("2026-11-11T13:00:00.000Z");
  });

  it("a reminder hour set inside quiet hours is pushed to quiet-hours end", () => {
    const p = { ...prefs, reminderHour: 7 };
    const planned = planReminders(occ("2026-11-10"), bill, p, ["push"], new Date("2026-11-10T10:00:00Z"));
    expect(planned.find((x) => x.kind === "due")!.sendAt.toISOString()).toBe("2026-11-10T13:00:00.000Z");
  });
});
