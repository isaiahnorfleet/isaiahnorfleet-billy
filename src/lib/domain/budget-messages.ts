import type { BillyAnimation } from "./billy-animation";
import type { BillyMessage, Mood, Tone } from "./billy-messages";
import type { BudgetState } from "./budget";

/**
 * Billy's lines for the Budget tab. Same rules as the bill messages: firm and funny, never
 * insulting, never shaming hardship, never inventing consequences. Deterministic per month.
 */

type Vars = { category: string; left: string; perDay: string };
type Line = (v: Vars) => string;

interface Entry {
  mood: Mood;
  headline: Record<Tone, string>;
  body: Record<Tone, Line[]>;
  /** Which clip plays. Big reactions match the tone: a gentle Billy is sad, never angry. */
  animation: Record<Tone, BillyAnimation>;
}

const LIBRARY: Record<BudgetState, Entry> = {
  no_income: {
    mood: "neutral",
    headline: { gentle: "Let's build a budget.", straight: "What's coming in?", extra: "Show me the money." },
    body: {
      gentle: [() => `Add what you earn and I'll work out what's left after your bills.`],
      straight: [() => `Add your income. I already know your bills, so I'll tell you what's actually yours to spend.`],
      extra: [() => `Add your income and I'll do the math. No more guessing what's left.`],
    },
    animation: { gentle: "idle", straight: "idle", extra: "idle" },
  },
  goals_squeezed: {
    mood: "heads_up",
    headline: { gentle: "Your goals are a bit short.", straight: "Goals are getting squeezed.", extra: "Hands off the savings." },
    body: {
      gentle: [(v) => `You're still within your income, but your savings goals are ${v.left} short this month. Easing off a little would cover it.`],
      straight: [(v) => `You haven't run out, but spending has eaten ${v.left} of what you meant to set aside. Pull back to protect it.`],
      extra: [(v) => `That's ${v.left} taken from your goals. Future you wanted that money. Stop spending it.`],
    },
    animation: { gentle: "heads-up", straight: "heads-up", extra: "about-to-snap" },
  },
  over: {
    mood: "overdue",
    headline: { gentle: "We went a little over.", straight: "That's over budget.", extra: "WE ARE OVER." },
    body: {
      gentle: [(v) => `You're ${v.left} past what came in this month. It happens. Let's ease off where we can.`],
      straight: [(v) => `You're ${v.left} over this month. Time to tighten up until the next paycheque.`, (v) => `${v.left} over. Pause the extras and let's steady this.`],
      extra: [(v) => `${v.left} over budget. Wallet goes in the drawer. I mean it.`, (v) => `${v.left} past the line. Every extra purchase now goes through me.`],
    },
    animation: { gentle: "dramatic-despair", straight: "about-to-snap", extra: "rage-mode" },
  },
  category_over: {
    mood: "heads_up",
    headline: { gentle: "One category ran over.", straight: "Heads up.", extra: "Easy there." },
    body: {
      gentle: [(v) => `${v.category} went past its limit. The overall budget still has room, so no panic.`],
      straight: [(v) => `${v.category} blew past its limit. You're still in the green overall, so keep it that way.`],
      extra: [(v) => `${v.category} is over its limit. I'm watching that category now.`, (v) => `${v.category}? Over. We talked about this.`],
    },
    animation: { gentle: "heads-up", straight: "heads-up", extra: "about-to-snap" },
  },
  running_hot: {
    mood: "heads_up",
    headline: { gentle: "Spending's running a bit fast.", straight: "Running hot.", extra: "Slow. Down." },
    body: {
      gentle: [(v) => `You've spent faster than the month is going. ${v.perDay} a day keeps you on track.`],
      straight: [(v) => `You're spending ahead of the calendar. Stick to about ${v.perDay} a day and you'll land fine.`],
      extra: [(v) => `Too fast for this point in the month. ${v.perDay} a day, max. I'm counting.`],
    },
    animation: { gentle: "heads-up", straight: "heads-up", extra: "about-to-snap" },
  },
  on_track: {
    mood: "all_clear",
    headline: { gentle: "You're doing great.", straight: "On track.", extra: "This is control." },
    body: {
      gentle: [(v) => `${v.left} left this month. That's about ${v.perDay} a day if you want a guide.`],
      straight: [(v) => `${v.left} left to spend. That's ${v.perDay} a day. Keep it there.`, (v) => `Bills covered, ${v.left} to go. About ${v.perDay} a day.`],
      extra: [(v) => `${v.left} left. ${v.perDay} a day. Don't get comfortable.`, (v) => `Bills handled, ${v.left} left. This is the standard.`],
    },
    animation: { gentle: "all-clear", straight: "all-clear", extra: "smug-legend" },
  },
  closed_under: {
    mood: "celebrating",
    headline: { gentle: "Month done, under budget.", straight: "Under budget.", extra: "UNDER BUDGET." },
    body: {
      gentle: [(v) => `You finished with ${v.left} to spare. Nicely done.`],
      straight: [(v) => `Closed the month with ${v.left} left over. That's how it's done.`],
      extra: [(v) => `${v.left} left over. Legendary. Do it again.`],
    },
    animation: { gentle: "pure-joy", straight: "victory-scream", extra: "smug-legend" },
  },
  planning: {
    mood: "neutral",
    headline: { gentle: "Planning ahead.", straight: "Looking ahead.", extra: "Future month." },
    body: {
      gentle: [(v) => `After bills and goals, this month should leave about ${v.left} to spend.`],
      straight: [(v) => `After bills and goals, you'll have about ${v.left} to spend.`],
      extra: [(v) => `${v.left} to spend after bills and goals. Plan it now so it doesn't vanish later.`],
    },
    animation: { gentle: "idle", straight: "idle", extra: "idle" },
  },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function budgetMessage(state: BudgetState, tone: Tone, seed: string, vars: Partial<Vars> = {}): BillyMessage {
  const e = LIBRARY[state];
  const lines = e.body[tone];
  const v: Vars = { category: vars.category ?? "", left: vars.left ?? "", perDay: vars.perDay ?? "" };
  return { mood: e.mood, headline: e.headline[tone], body: lines[hash(seed) % lines.length](v), animation: e.animation[tone] };
}
