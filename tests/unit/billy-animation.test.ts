import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLY_ANIMATIONS, billyAnimation } from "@/lib/domain/billy-animation";
import { dashboardMessage, type Tone } from "@/lib/domain/billy-messages";

const days = Array.from({ length: 200 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${i}`);

describe("Billy's animations", () => {
  it("has a clip file for every animation", () => {
    for (const a of BILLY_ANIMATIONS) expect(existsSync(`public/billy/${a}.webp`), a).toBe(true);
  });

  it("uses the everyday clip for each mood without a seed", () => {
    expect(billyAnimation("neutral")).toBe("idle");
    expect(billyAnimation("heads_up")).toBe("heads-up");
    expect(billyAnimation("due_today")).toBe("due-today");
    expect(billyAnimation("overdue")).toBe("overdue");
    expect(billyAnimation("celebrating")).toBe("paid");
    expect(billyAnimation("all_clear")).toBe("all-clear");
  });

  it("is stable for the same day", () => {
    expect(billyAnimation("overdue", "extra", "2026-10-29")).toBe(billyAnimation("overdue", "extra", "2026-10-29"));
  });

  it("shows big reactions on some days, but not most", () => {
    const picks = days.map((d) => billyAnimation("celebrating", "straight", d));
    const rare = picks.filter((p) => p !== "paid").length;
    expect(rare).toBeGreaterThan(20);
    expect(rare).toBeLessThan(100);
    expect(new Set(picks)).toEqual(new Set(["paid", "pure-joy", "victory-scream"]));
  });

  it("never shows an angry Billy in the gentle tone", () => {
    const tones: Tone[] = ["gentle", "straight"];
    for (const tone of tones) {
      for (const d of days) expect(billyAnimation("overdue", tone, d)).not.toBe("rage-mode");
    }
    for (const d of days) expect(["overdue", "dramatic-despair"]).toContain(billyAnimation("overdue", "gentle", d));
  });

  it("never picks a big reaction for moods without one", () => {
    for (const d of days) expect(billyAnimation("due_today", "extra", d)).toBe("due-today");
  });

  it("comes with the dashboard message", () => {
    const msg = dashboardMessage({ tone: "straight", today: "2026-10-29", hasBills: true, overdue: [], dueToday: [], upcoming: [] });
    expect(msg.animation).toBe(billyAnimation("all_clear", "straight", "2026-10-29"));
  });
});
