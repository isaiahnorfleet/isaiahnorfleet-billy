import { describe, expect, it } from "vitest";
import { dashboardMessage, notificationCopy, type Tone } from "@/lib/domain/billy-messages";

const base = { tone: "straight" as Tone, today: "2026-10-29", hasBills: true, overdue: [], dueToday: [], upcoming: [] };
const BANNED = /late fee|credit score|penalt|lazy|stupid|irresponsible|broke\b|fail/i;

describe("Billy's dashboard message", () => {
  it("reacts to real data in priority order", () => {
    expect(dashboardMessage({ ...base, hasBills: false }).mood).toBe("neutral");
    expect(dashboardMessage(base).mood).toBe("all_clear");
    expect(dashboardMessage({ ...base, upcoming: [{ name: "Rent", dueDate: "2026-11-01", state: "due_soon" }] })).toMatchObject({
      mood: "heads_up",
    });
    const today = dashboardMessage({ ...base, dueToday: [{ name: "Hydro", dueDate: "2026-10-29", state: "due_today" }] });
    expect(today.mood).toBe("due_today");
    expect(today.body).toContain("Hydro");
    const overdue = dashboardMessage({
      ...base,
      overdue: [{ name: "Hydro", dueDate: "2026-10-15", state: "overdue" }],
      dueToday: [{ name: "Rent", dueDate: "2026-10-29", state: "due_today" }],
    });
    expect(overdue.mood).toBe("overdue");
  });

  it("names the right number of days", () => {
    const msg = dashboardMessage({ ...base, upcoming: [{ name: "Rent", dueDate: "2026-11-01", state: "due_soon" }] });
    expect(msg.body).toMatch(/three days/);
  });

  it("never shames or invents consequences, in any tone", () => {
    for (const tone of ["gentle", "straight", "extra"] as Tone[]) {
      for (const scenario of [
        { overdue: [{ name: "Hydro", dueDate: "2026-10-01", state: "overdue" as const }] },
        { overdue: [{ name: "A", dueDate: "2026-10-01", state: "overdue" as const }, { name: "B", dueDate: "2026-10-02", state: "overdue" as const }] },
        { dueToday: [{ name: "Hydro", dueDate: "2026-10-29", state: "due_today" as const }] },
        { upcoming: [{ name: "Rent", dueDate: "2026-10-30", state: "due_soon" as const }] },
        {},
      ]) {
        const m = dashboardMessage({ ...base, tone, ...scenario });
        expect(m.body).not.toMatch(BANNED);
        expect(m.headline).not.toMatch(BANNED);
      }
    }
  });
});

describe("notification copy", () => {
  const item = { occurrenceId: "o1", name: "Hydro", amountLabel: "$112.48", dueDate: "2026-10-29", kind: "due" as const };

  it("includes the bill name and amount only when lock-screen details are allowed", () => {
    const detailed = notificationCopy([item], "straight", "2026-10-29", true);
    expect(detailed.title).toContain("Hydro");
    expect(detailed.title).toContain("$112.48");
    const privateCopy = notificationCopy([item], "straight", "2026-10-29", false);
    expect(`${privateCopy.title} ${privateCopy.body}`).not.toMatch(/Hydro|112/);
  });

  it("groups several reminders into one notification", () => {
    const copy = notificationCopy([item, { ...item, occurrenceId: "o2", name: "Rent", dueDate: "2026-10-20", kind: "overdue" }], "straight", "2026-10-29", true);
    expect(copy.title).toBe("2 bills need attention");
  });
});
