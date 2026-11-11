import { beforeEach, describe, expect, it } from "vitest";
import { withUser } from "@/lib/db/client";
import { createBill } from "@/lib/data/bills";
import { recordPayment } from "@/lib/data/payments";
import { materializeOccurrences } from "@/lib/data/occurrences";
import {
  addExpense,
  addStarterCategories,
  deleteCategory,
  listBillsForMonth,
  listCategories,
  listExpenses,
  getAutoLimits,
  listGoals,
  saveGoal,
  setAutoLimits,
  saveCategory,
  saveIncomeSource,
  STARTER_CATEGORIES,
} from "@/lib/data/budget";
import { billInput, createUser, resetDb } from "./helpers";

const today = "2026-11-11";

describe("budget data", () => {
  let alice: { id: string }, bob: { id: string };

  beforeEach(async () => {
    await resetDb();
    alice = await createUser({ email: "alice@example.test" });
    bob = await createUser({ email: "bob@example.test" });
  });

  it("keeps income, categories and spending private to their owner", async () => {
    const catId = await withUser(alice.id, async (tx) => {
      await saveIncomeSource(tx, alice.id, null, { name: "Paycheque", amount_minor: 200000, currency: "CAD", recurrence: "biweekly", anchor_date: "2026-11-06" });
      await saveCategory(tx, alice.id, null, { name: "Groceries", limit_minor: 50000 });
      const [c] = await listCategories(tx, alice.id);
      await addExpense(tx, alice.id, { category_id: c.id, amount_minor: 1234, currency: "CAD", spent_on: today, note: null });
      return c.id;
    });
    await withUser(bob.id, async (tx) => {
      expect(await tx`select * from income_sources`).toHaveLength(0);
      expect(await tx`select * from budget_categories`).toHaveLength(0);
      expect(await tx`select * from expenses`).toHaveLength(0);
      expect(await tx`update budget_categories set monthly_limit_minor = 1 where id = ${catId} returning id`).toHaveLength(0);
      expect(await tx`delete from expenses returning id`).toHaveLength(0);
    });
    // Bob cannot file his spending under Alice's category.
    await expect(
      withUser(bob.id, (tx) => addExpense(tx, bob.id, { category_id: catId, amount_minor: 100, currency: "CAD", spent_on: today, note: null })),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses duplicate category names and keeps spending when a category is removed", async () => {
    await withUser(alice.id, async (tx) => {
      expect(await saveCategory(tx, alice.id, null, { name: "Groceries", limit_minor: null })).toBe(true);
      expect(await saveCategory(tx, alice.id, null, { name: " groceries ", limit_minor: 100 })).toBe(false);
      await addStarterCategories(tx, alice.id); // includes Groceries: no duplicate, no error
      const cats = await listCategories(tx, alice.id);
      expect(cats).toHaveLength(STARTER_CATEGORIES.length);
      const groceries = cats.find((c) => c.name === "Groceries")!;
      await addExpense(tx, alice.id, { category_id: groceries.id, amount_minor: 4500, currency: "CAD", spent_on: today, note: "Costco" });
      await deleteCategory(tx, alice.id, groceries.id);
      const [e] = await listExpenses(tx, alice.id, "2026-11-01", "2026-11-30");
      expect(e).toMatchObject({ category_id: null, amount_minor: 4500, note: "Costco" });
    });
  });

  it("counts each bill cycle due in the month once, at the paid amount when paid", async () => {
    await withUser(alice.id, async (tx) => {
      const rent = await createBill(tx, alice.id, billInput({ name: "Rent", amount_minor: 145000, due_date: "2026-11-01" }), today);
      await createBill(tx, alice.id, billInput({ name: "Hydro", amount_minor: 11248, due_date: "2026-11-15" }), today);
      await materializeOccurrences(tx, alice.id, today);
      const [occ] = await tx<{ id: string }[]>`select id from bill_occurrences where bill_id = ${rent} and due_date = '2026-11-01'`;
      await recordPayment(tx, alice.id, { occurrenceId: occ.id, amountMinor: 140000, paidOn: "2026-11-01", note: null });

      const nov = await listBillsForMonth(tx, alice.id, "2026-11-01");
      expect(nov.map((b) => [b.amount_minor, b.paid]).sort()).toEqual([[11248, false], [140000, true]].sort());
      // A month past the stored horizon is projected from the schedule.
      const may = await listBillsForMonth(tx, alice.id, "2027-05-01");
      expect(may.map((b) => b.due_date).sort()).toEqual(["2027-05-01", "2027-05-15"]);
    });
  });

  it("keeps goals and the auto-limit setting private, with projection fields", async () => {
    await withUser(alice.id, async (tx) => {
      const goal = { name: "Savings", amount_minor: null, percent_bp: 1000, target_minor: 1000000, balance_minor: 25000, annual_return_bp: 0 };
      expect(await saveGoal(tx, alice.id, null, goal)).toBe(true);
      expect(await saveGoal(tx, alice.id, null, { ...goal, name: "savings" })).toBe(false);
      expect(await getAutoLimits(tx, alice.id)).toBe(false);
      await setAutoLimits(tx, alice.id, true);
      await setAutoLimits(tx, alice.id, true); // upsert
      expect(await getAutoLimits(tx, alice.id)).toBe(true);
      expect(await listGoals(tx, alice.id)).toEqual([expect.objectContaining({ name: "Savings", percent_bp: 1000, target_minor: 1000000, balance_minor: 25000 })]);
    });
    await withUser(bob.id, async (tx) => {
      expect(await tx`select * from budget_goals`).toHaveLength(0);
      expect(await tx`select * from budget_settings`).toHaveLength(0);
      expect(await getAutoLimits(tx, alice.id)).toBe(false);
    });
  });

  it("refuses a goal that is both a fixed amount and a percentage", async () => {
    await expect(
      withUser(alice.id, (tx) => tx`insert into budget_goals (user_id, name, amount_minor, percent_bp) values (${alice.id}, 'Both', 100, 100)`),
    ).rejects.toThrow(/check constraint/);
  });
});
