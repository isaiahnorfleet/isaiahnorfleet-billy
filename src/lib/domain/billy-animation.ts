import type { Mood, Tone } from "./billy-messages";

/**
 * Billy's animated clips (public/billy/<name>.webp). Each mood has an everyday clip, and some
 * moods have rarer, bigger reactions that show up on about one day in four. Deterministic: the
 * same day, mood and tone always pick the same clip, so Billy doesn't change on every refresh.
 */

export const BILLY_ANIMATIONS = [
  "idle",
  "heads-up",
  "due-today",
  "overdue",
  "paid",
  "all-clear",
  "rage-mode",
  "about-to-snap",
  "dramatic-despair",
  "pure-joy",
  "victory-scream",
  "smug-legend",
] as const;
export type BillyAnimation = (typeof BILLY_ANIMATIONS)[number];

const EVERYDAY: Record<Mood, BillyAnimation> = {
  neutral: "idle",
  heads_up: "heads-up",
  due_today: "due-today",
  overdue: "overdue",
  celebrating: "paid",
  all_clear: "all-clear",
};

// Big reactions match the tone: a gentle Billy is sad about an overdue bill, never angry.
const RARE: Partial<Record<Mood, Record<Tone, BillyAnimation[]>>> = {
  overdue: {
    gentle: ["dramatic-despair"],
    straight: ["dramatic-despair", "about-to-snap"],
    extra: ["dramatic-despair", "about-to-snap", "rage-mode"],
  },
  celebrating: {
    gentle: ["pure-joy", "victory-scream"],
    straight: ["pure-joy", "victory-scream"],
    extra: ["pure-joy", "victory-scream"],
  },
  all_clear: {
    gentle: ["smug-legend"],
    straight: ["smug-legend"],
    extra: ["smug-legend"],
  },
};

export const RARE_EVERY = 4;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function billyAnimation(mood: Mood, tone: Tone = "straight", seed = ""): BillyAnimation {
  const rare = RARE[mood]?.[tone];
  if (!rare || !seed) return EVERYDAY[mood];
  const h = hash(`${seed}:${mood}`);
  if (h % RARE_EVERY !== 0) return EVERYDAY[mood];
  return rare[Math.floor(h / RARE_EVERY) % rare.length];
}
