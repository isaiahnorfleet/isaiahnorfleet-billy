import { addDays, dayOfWeek, type LocalDate } from "./dates";
import { parseAmountToMinor } from "./money";

/**
 * Fast expense logging: read a one-line entry like "23.50 groceries Metro", and work out smart
 * defaults (which category a store usually goes in, what the user tends to log around now).
 * Pure and deterministic; runs in the browser with no network or paid AI.
 */

export interface QuickCategory {
  id: string;
  name: string;
}

/** What the user has logged before, newest first. */
export interface PastExpense {
  category_id: string | null;
  note: string | null;
  amount_minor: number;
  /** Minutes after local midnight when it was logged (0..1439). */
  minute_of_day: number;
}

export interface ParsedEntry {
  amount_minor: number | null;
  category_id: string | null;
  /** How the category was chosen: typed, remembered from this store, or a built-in store hint. */
  category_source: "typed" | "remembered" | "store" | null;
  /** The store or note, as typed (null when nothing is left). */
  note: string | null;
  spent_on: LocalDate;
}

/** Lowercase, strip accents and punctuation, collapse spaces: "Tim Horton's" -> "tim hortons". */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normalizeKey(value).split(" ").filter((w) => w.length > 0 && w !== "and");
}

/**
 * Common Canadian stores, matched to the starter categories by name. Only used when the user has
 * a category with that name and hasn't taught Billy otherwise.
 */
const STORE_HINTS: Record<string, string[]> = {
  groceries: ["metro", "loblaws", "no frills", "nofrills", "sobeys", "freshco", "food basics", "costco", "iga", "provigo", "maxi", "superstore", "real canadian superstore", "farm boy", "longos", "fortinos", "zehrs", "safeway", "save on foods", "t t", "walmart", "grocery", "groceries"],
  "eating out": ["tim hortons", "tims", "timmies", "starbucks", "mcdonalds", "mcd", "subway", "a w", "harveys", "pizza", "pizza pizza", "dominos", "uber eats", "ubereats", "doordash", "skip", "skipthedishes", "chipotle", "wendys", "burger king", "kfc", "popeyes", "coffee", "lunch", "dinner", "breakfast", "restaurant", "cafe", "second cup", "mary browns", "osmows", "st louis", "boston pizza", "the keg"],
  "gas & transit": ["esso", "petro canada", "petrocan", "shell", "ultramar", "pioneer", "husky", "mobil", "canadian tire gas", "presto", "ttc", "go transit", "stm", "oc transpo", "uber", "lyft", "gas", "fuel", "parking", "transit"],
  shopping: ["amazon", "best buy", "bestbuy", "canadian tire", "winners", "marshalls", "homesense", "ikea", "home depot", "dollarama", "hm", "h m", "zara", "old navy", "gap", "uniqlo", "indigo", "staples", "apple", "lululemon", "simons", "the bay", "aritzia"],
  fun: ["cineplex", "netflix", "spotify", "steam", "playstation", "xbox", "nintendo", "ticketmaster", "movies", "movie", "concert", "bar", "lcbo", "saq", "beer store", "bowling"],
  "personal care": ["shoppers", "shoppers drug mart", "rexall", "jean coutu", "pharmaprix", "sephora", "haircut", "barber", "salon", "pharmacy", "gym", "goodlife"],
};

/**
 * Find a category the user named in the text. Matches a whole category name ("eating out"), any
 * word of it ("gas" -> "Gas & transit"), or a prefix of 3+ letters ("groc" -> "Groceries").
 * Returns the category and the number of leading words of `tokens` it used up... anywhere in the text.
 */
function matchCategory(tokens: string[], categories: QuickCategory[]): { id: string; start: number; length: number } | null {
  const cats = categories.map((c) => ({ id: c.id, words: words(c.name) })).filter((c) => c.words.length > 0);
  // 1. Full name, longest first ("eating out" beats "eating").
  const byLength = [...cats].sort((a, b) => b.words.length - a.words.length);
  for (const c of byLength) {
    for (let i = 0; i + c.words.length <= tokens.length; i++) {
      if (c.words.every((w, j) => tokens[i + j] === w || tokens[i + j] === `${w}s` || `${tokens[i + j]}s` === w)) {
        return { id: c.id, start: i, length: c.words.length };
      }
    }
  }
  // 2. One word that is a word of the name, or a 3+ letter prefix of the name's first word.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length < 3) continue;
    const hit =
      cats.find((c) => c.words.includes(t) || c.words.some((w) => `${w}s` === t || `${t}s` === w)) ??
      cats.find((c) => c.words[0].startsWith(t));
    if (hit) return { id: hit.id, start: i, length: 1 };
  }
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Date words: "today", "yesterday", "monday" (most recent one, never in the future). */
function parseDateWord(token: string, today: LocalDate): LocalDate | null {
  if (token === "today") return today;
  if (token === "yesterday" || token === "yday") return addDays(today, -1);
  let idx = WEEKDAYS.indexOf(token);
  if (idx < 0) idx = WEEKDAY_SHORT.indexOf(token);
  if (idx < 0) return null;
  const back = (dayOfWeek(today) - idx + 7) % 7;
  return addDays(today, -back);
}

/** The amount in the text: the first token that reads as money ("23.50", "$23.50", "23,50", "23$"). */
function takeAmount(raw: string[], currency: string): { minor: number; index: number } | null {
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].replace(/\$$/, "").replace(/^(\d+),(\d{1,2})$/, "$1.$2");
    if (!/\d/.test(t)) continue;
    const minor = parseAmountToMinor(t, currency);
    if (minor !== null && minor > 0) return { minor, index: i };
  }
  return null;
}

export interface Memory {
  /** normalized note -> category id the user picked most recently for it. */
  merchants: Map<string, string | null>;
}

/** Build the store -> category memory from past entries (newest first wins). */
export function buildMemory(past: PastExpense[]): Memory {
  const merchants = new Map<string, string | null>();
  for (const e of past) {
    if (!e.note) continue;
    const key = normalizeKey(e.note);
    if (key && !merchants.has(key)) merchants.set(key, e.category_id);
  }
  return { merchants };
}

/** Category for a store or note: what the user picked last time, else a built-in store hint. */
export function categoryForNote(
  note: string,
  categories: QuickCategory[],
  memory: Memory,
): { id: string | null; source: "remembered" | "store" } | null {
  const key = normalizeKey(note);
  if (!key) return null;
  const valid = (id: string | null) => id === null || categories.some((c) => c.id === id);
  if (memory.merchants.has(key)) {
    const id = memory.merchants.get(key)!;
    if (valid(id)) return { id, source: "remembered" };
  }
  // "Metro on Queen" still remembers "Metro": try the longest remembered prefix of the words.
  const parts = key.split(" ");
  for (let n = parts.length - 1; n >= 1; n--) {
    const prefix = parts.slice(0, n).join(" ");
    if (memory.merchants.has(prefix)) {
      const id = memory.merchants.get(prefix)!;
      if (valid(id)) return { id, source: "remembered" };
    }
  }
  const byName = new Map(categories.map((c) => [normalizeKey(c.name), c.id]));
  for (const [catName, stores] of Object.entries(STORE_HINTS)) {
    const id = byName.get(normalizeKey(catName));
    if (!id) continue;
    if (stores.some((s) => key === s || key.startsWith(`${s} `) || (s.includes(" ") && key.includes(s)))) return { id, source: "store" };
  }
  return null;
}

/**
 * Read a one-line entry. Order doesn't matter: "groceries 23.50 Metro", "Metro 23.50",
 * "12 coffee yesterday". Whatever isn't the amount, a category or a date word becomes the note.
 */
export function parseEntry(input: string, opts: { categories: QuickCategory[]; memory: Memory; today: LocalDate; currency: string }): ParsedEntry {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const used = new Set<number>();
  const amount = takeAmount(raw, opts.currency);
  if (amount) used.add(amount.index);

  let spent_on = opts.today;
  for (let i = 0; i < raw.length; i++) {
    if (used.has(i)) continue;
    const d = parseDateWord(normalizeKey(raw[i]), opts.today);
    if (d) {
      spent_on = d;
      used.add(i);
      break;
    }
  }

  // Leftover words, keeping their original spelling for the note.
  const rest = raw.map((w, i) => ({ w, i })).filter((x) => !used.has(x.i) && normalizeKey(x.w) !== "" && !/^(on|at|for|spent)$/i.test(x.w));
  const restKeys = rest.map((x) => normalizeKey(x.w));

  // A remembered or known store wins over reading a category out of the words, so
  // "Shoppers 14" stays a store and isn't read as the "Shopping" category.
  const fullNote = rest.map((x) => x.w).join(" ");
  const remembered = fullNote ? categoryForNote(fullNote, opts.categories, opts.memory) : null;
  if (remembered?.source === "remembered") {
    return { amount_minor: amount?.minor ?? null, category_id: remembered.id, category_source: "remembered", note: fullNote, spent_on };
  }

  const cat = matchCategory(restKeys, opts.categories);
  if (cat) {
    const noteWords = rest.filter((_, k) => k < cat.start || k >= cat.start + cat.length).map((x) => x.w);
    const note = noteWords.join(" ") || null;
    return { amount_minor: amount?.minor ?? null, category_id: cat.id, category_source: "typed", note, spent_on };
  }

  return {
    amount_minor: amount?.minor ?? null,
    category_id: remembered?.id ?? null,
    category_source: remembered ? remembered.source : null,
    note: fullNote || null,
    spent_on,
  };
}

/** Categories ordered by how often they were used (ties keep the user's own order). */
export function sortCategoriesByUse<T extends QuickCategory>(categories: T[], past: PastExpense[]): T[] {
  const counts = new Map<string, number>();
  for (const e of past) if (e.category_id) counts.set(e.category_id, (counts.get(e.category_id) ?? 0) + 1);
  return categories
    .map((c, i) => ({ c, i, n: counts.get(c.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.c);
}

export interface Suggestion {
  note: string;
  category_id: string | null;
  amount_minor: number;
  count: number;
}

/**
 * What the user usually logs around this time of day: stores logged at least twice within 90
 * minutes of now (wrapping midnight), most frequent first, with their most recent amount.
 */
export function timeOfDaySuggestions(past: PastExpense[], minuteNow: number, limit = 3, windowMin = 90): Suggestion[] {
  const groups = new Map<string, Suggestion>();
  for (const e of past) {
    if (!e.note) continue;
    const diff = Math.abs(e.minute_of_day - minuteNow);
    if (Math.min(diff, 1440 - diff) > windowMin) continue;
    const key = normalizeKey(e.note);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { note: e.note.trim(), category_id: e.category_id, amount_minor: e.amount_minor, count: 1 });
  }
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
