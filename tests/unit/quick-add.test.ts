import { describe, expect, it } from "vitest";
import { buildMemory, categoryForNote, normalizeKey, parseEntry, sortCategoriesByUse, timeOfDaySuggestions, type PastExpense } from "@/lib/domain/quick-add";

const cats = [
  { id: "g", name: "Groceries" },
  { id: "e", name: "Eating out" },
  { id: "t", name: "Gas & transit" },
  { id: "s", name: "Shopping" },
  { id: "f", name: "Fun" },
  { id: "p", name: "Personal care" },
];
const today = "2026-11-15"; // a Sunday
const empty = buildMemory([]);
const parse = (text: string, memory = empty) => parseEntry(text, { categories: cats, memory, today, currency: "CAD" });
const past = (note: string | null, category_id: string | null, amount_minor = 1000, minute_of_day = 600): PastExpense => ({ note, category_id, amount_minor, minute_of_day });

describe("parseEntry", () => {
  it("reads amount, category and store in the example order", () => {
    expect(parse("23.50 groceries Metro")).toEqual({ amount_minor: 2350, category_id: "g", category_source: "typed", note: "Metro", spent_on: today });
  });

  it("accepts any order and money spellings", () => {
    expect(parse("Metro groceries $23.50").amount_minor).toBe(2350);
    expect(parse("Metro groceries $23.50").note).toBe("Metro");
    expect(parse("23,50 groceries").amount_minor).toBe(2350);
    expect(parse("12$ fun").amount_minor).toBe(1200);
    expect(parse("1,250 shopping couch").amount_minor).toBe(125000);
  });

  it("matches category words, plurals and prefixes", () => {
    expect(parse("60 gas Esso").category_id).toBe("t");
    expect(parse("60 gas Esso").note).toBe("Esso");
    expect(parse("40 eating out with Sam").category_id).toBe("e");
    expect(parse("40 eating out with Sam").note).toBe("with Sam");
    expect(parse("8 grocery").category_id).toBe("g");
    expect(parse("8 groc").category_id).toBe("g");
    expect(parse("8 groc").note).toBeNull();
  });

  it("reads day words without going into the future", () => {
    expect(parse("12 coffee yesterday").spent_on).toBe("2026-11-14");
    expect(parse("12 coffee friday").spent_on).toBe("2026-11-13");
    expect(parse("12 coffee sunday").spent_on).toBe(today);
    expect(parse("12 coffee fri").note).toBe("coffee");
  });

  it("guesses known stores when no category is typed", () => {
    expect(parse("4.25 Tim Hortons")).toMatchObject({ category_id: "e", category_source: "store", note: "Tim Hortons" });
    expect(parse("Shoppers 14")).toMatchObject({ category_id: "p", category_source: "store" });
    expect(parse("80 Petro-Canada")).toMatchObject({ category_id: "t" });
    expect(parse("30 uber eats")).toMatchObject({ category_id: "e" });
    expect(parse("30 Bob's place")).toMatchObject({ category_id: null, category_source: null, note: "Bob's place" });
  });

  it("prefers what the user picked for that store last time", () => {
    const memory = buildMemory([past("Costco", "s"), past("Costco", "g")]);
    expect(parse("120 Costco", memory)).toMatchObject({ category_id: "s", category_source: "remembered" });
    // A typed category still wins.
    expect(parse("120 groceries Costco", memory).category_id).toBe("g");
  });

  it("has no amount when none was typed", () => {
    expect(parse("groceries").amount_minor).toBeNull();
    expect(parse("").amount_minor).toBeNull();
    expect(parse("0 fun").amount_minor).toBeNull();
  });
});

describe("categoryForNote", () => {
  it("remembers by store prefix and ignores deleted categories", () => {
    const memory = buildMemory([past("Metro", "g"), past("Old place", "gone")]);
    expect(categoryForNote("metro on queen", cats, memory)).toEqual({ id: "g", source: "remembered" });
    expect(categoryForNote("Old place", cats, memory)).toBeNull();
    expect(categoryForNote("  ", cats, memory)).toBeNull();
  });

  it("only uses store hints for categories the user has", () => {
    expect(categoryForNote("Esso", [{ id: "x", name: "Car" }], empty)).toBeNull();
  });
});

describe("smart defaults", () => {
  it("normalizes store names", () => {
    expect(normalizeKey("  Tim Horton’s! ")).toBe("tim hortons");
    expect(normalizeKey("Café Olé")).toBe("cafe ole");
  });

  it("orders categories by use, keeping the user's order on ties", () => {
    const sorted = sortCategoriesByUse(cats, [past("a", "f"), past("b", "f"), past("c", "t")]);
    expect(sorted.map((c) => c.id)).toEqual(["f", "t", "g", "e", "s", "p"]);
  });

  it("suggests stores logged twice or more around this time, wrapping midnight", () => {
    const history = [
      past("Tim Hortons", "e", 245, 8 * 60),
      past("tim hortons", "e", 225, 8 * 60 + 30),
      past("Metro", "g", 5000, 18 * 60),
      past("Metro", "g", 4000, 18 * 60),
      past("Late snack", "e", 600, 23 * 60 + 50),
      past("Late snack", "e", 600, 10),
      past("Once", "f", 100, 8 * 60),
    ];
    expect(timeOfDaySuggestions(history, 8 * 60 + 15)).toEqual([{ note: "Tim Hortons", category_id: "e", amount_minor: 245, count: 2 }]);
    expect(timeOfDaySuggestions(history, 0).map((s) => s.note)).toEqual(["Late snack"]);
    expect(timeOfDaySuggestions(history, 13 * 60)).toEqual([]);
  });
});
