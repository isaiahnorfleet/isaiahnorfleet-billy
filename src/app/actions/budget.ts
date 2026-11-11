"use server";

import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db/client";
import { requireUserForAction } from "@/lib/auth/session";
import {
  addExpense,
  addStarterCategories,
  deleteCategory,
  deleteExpense,
  deleteGoal,
  deleteIncomeSource,
  saveGoal,
  setAutoLimits,
  saveCategory,
  saveIncomeSource,
  updateExpense,
} from "@/lib/data/budget";
import { todayIn } from "@/lib/domain/dates";
import { categoryInput, expenseInput, fieldErrors, goalInput, incomeInput } from "@/lib/validation";
import { failure, type ActionResult } from "./result";

const UUID = /^[0-9a-f-]{36}$/i;
const optionalId = (id: string | null | undefined) => (id && UUID.test(id) ? id : null);

function done(): ActionResult {
  revalidatePath("/budget");
  return { ok: true };
}

export async function saveIncomeAction(input: { id?: string | null; name: string; amount: string; recurrence: string; anchor_date: string }): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = incomeInput.safeParse({ ...input, currency: profile.currency });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    await withUser(user.id, (tx) => saveIncomeSource(tx, user.id, optionalId(input.id), parsed.data));
    return done();
  } catch (err) {
    console.error("saveIncome failed", (err as Error).message);
    return failure("Couldn't save the income. Try again.");
  }
}

export async function deleteIncomeAction(id: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    if (!UUID.test(id)) return failure("Income not found.");
    await withUser(user.id, (tx) => deleteIncomeSource(tx, user.id, id));
    return done();
  } catch {
    return failure("Couldn't remove the income. Try again.");
  }
}

export async function saveCategoryAction(input: { id?: string | null; name: string; limit: string }): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = categoryInput.safeParse({ ...input, currency: profile.currency });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    const ok = await withUser(user.id, (tx) => saveCategory(tx, user.id, optionalId(input.id), parsed.data));
    if (!ok) return failure("You already have a category with that name.", { name: "Pick a different name" });
    return done();
  } catch (err) {
    console.error("saveCategory failed", (err as Error).message);
    return failure("Couldn't save the category. Try again.");
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    if (!UUID.test(id)) return failure("Category not found.");
    await withUser(user.id, (tx) => deleteCategory(tx, user.id, id));
    return done();
  } catch {
    return failure("Couldn't remove the category. Try again.");
  }
}

export async function addStarterCategoriesAction(): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    await withUser(user.id, (tx) => addStarterCategories(tx, user.id));
    return done();
  } catch {
    return failure("Couldn't add the categories. Try again.");
  }
}

export async function saveExpenseAction(input: { id?: string | null; amount: string; category_id: string | null; spent_on: string; note: string }): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = expenseInput.safeParse({ ...input, category_id: optionalId(input.category_id), currency: profile.currency });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    if (parsed.data.spent_on > todayIn(profile.time_zone)) return failure("That date is in the future.", { spent_on: "Pick today or an earlier date" });
    const id = optionalId(input.id);
    const ok = await withUser(user.id, async (tx) => {
      if (id) return updateExpense(tx, user.id, id, parsed.data);
      await addExpense(tx, user.id, parsed.data);
      return true;
    });
    if (!ok) return failure("That entry no longer exists.");
    return done();
  } catch (err) {
    console.error("saveExpense failed", (err as Error).message);
    return failure("Couldn't save the spending. Try again.");
  }
}

export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    if (!UUID.test(id)) return failure("Entry not found.");
    await withUser(user.id, (tx) => deleteExpense(tx, user.id, id));
    return done();
  } catch {
    return failure("Couldn't remove the entry. Try again.");
  }
}

export async function saveGoalAction(input: {
  id?: string | null;
  name: string;
  mode: "amount" | "percent";
  value: string;
  target: string;
  balance: string;
  annual_return: string;
}): Promise<ActionResult> {
  try {
    const { user, profile } = await requireUserForAction();
    const parsed = goalInput.safeParse({ ...input, currency: profile.currency });
    if (!parsed.success) return failure("Please fix the highlighted fields.", fieldErrors(parsed.error));
    const ok = await withUser(user.id, (tx) => saveGoal(tx, user.id, optionalId(input.id), parsed.data));
    if (!ok) return failure("You already have a goal with that name.", { name: "Pick a different name" });
    return done();
  } catch (err) {
    console.error("saveGoal failed", (err as Error).message);
    return failure("Couldn't save the goal. Try again.");
  }
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    if (!UUID.test(id)) return failure("Goal not found.");
    await withUser(user.id, (tx) => deleteGoal(tx, user.id, id));
    return done();
  } catch {
    return failure("Couldn't remove the goal. Try again.");
  }
}

export async function setAutoLimitsAction(on: boolean): Promise<ActionResult> {
  try {
    const { user } = await requireUserForAction();
    await withUser(user.id, (tx) => setAutoLimits(tx, user.id, on === true));
    return done();
  } catch {
    return failure("Couldn't change that setting. Try again.");
  }
}
