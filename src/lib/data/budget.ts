import type { Tx } from "@/lib/db/client";
import type { LocalDate } from "@/lib/domain/dates";
import { endOfMonth } from "@/lib/domain/dates";
import { occurrencesBetween, type Recurrence } from "@/lib/domain/recurrence";
import type { BudgetBillInput } from "@/lib/domain/budget";
import type { CategoryInput, ExpenseInput, IncomeInput } from "@/lib/validation";

export interface IncomeSourceRow {
  id: string;
  name: string;
  amount_minor: number;
  currency: string;
  recurrence: Recurrence;
  anchor_date: LocalDate;
}

export interface BudgetCategoryRow {
  id: string;
  name: string;
  monthly_limit_minor: number | null;
  sort_order: number;
}

export interface ExpenseRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  amount_minor: number;
  currency: string;
  spent_on: LocalDate;
  note: string | null;
}

export const STARTER_CATEGORIES = ["Groceries", "Eating out", "Gas & transit", "Shopping", "Fun", "Personal care"];

export async function listIncomeSources(tx: Tx, userId: string): Promise<IncomeSourceRow[]> {
  return tx<IncomeSourceRow[]>`
    select id, name, amount_minor, currency, recurrence, anchor_date from income_sources
    where user_id = ${userId} order by amount_minor desc, name`;
}

export async function listCategories(tx: Tx, userId: string): Promise<BudgetCategoryRow[]> {
  return tx<BudgetCategoryRow[]>`
    select id, name, monthly_limit_minor, sort_order from budget_categories
    where user_id = ${userId} order by sort_order, lower(name)`;
}

export async function listExpenses(tx: Tx, userId: string, from: LocalDate, to: LocalDate): Promise<ExpenseRow[]> {
  return tx<ExpenseRow[]>`
    select e.id, e.category_id, c.name as category_name, e.amount_minor, e.currency, e.spent_on, e.note
    from expenses e left join budget_categories c on c.id = e.category_id
    where e.user_id = ${userId} and e.spent_on between ${from} and ${to}
    order by e.spent_on desc, e.created_at desc`;
}

/**
 * Every bill due in the month: stored occurrences (paid ones at the amount actually paid), plus
 * cycles projected from each active bill's schedule that aren't stored yet. Skipped cycles don't count.
 */
export async function listBillsForMonth(tx: Tx, userId: string, month: LocalDate): Promise<BudgetBillInput[]> {
  const monthEnd = endOfMonth(month);
  const rows = await tx<{ bill_id: string; scheduled_date: LocalDate; due_date: LocalDate; amount_minor: number; currency: string; status: string; paid_amount_minor: number | null }[]>`
    select o.bill_id, o.scheduled_date, o.due_date, o.amount_minor, o.currency, o.status,
      (select p.amount_minor from payments p where p.occurrence_id = o.id and p.voided_at is null limit 1) as paid_amount_minor
    from bill_occurrences o join bills b on b.id = o.bill_id
    where o.user_id = ${userId} and o.due_date between ${month} and ${monthEnd}
      and o.status <> 'skipped' and (b.status = 'active' or o.status = 'paid')`;
  const out: BudgetBillInput[] = rows.map((r) => ({
    amount_minor: r.status === "paid" ? (r.paid_amount_minor ?? r.amount_minor) : r.amount_minor,
    currency: r.currency,
    due_date: r.due_date,
    paid: r.status === "paid",
  }));
  // Anything already stored for a bill (even moved to another month or skipped) blocks a projection.
  const stored = await tx<{ bill_id: string; scheduled_date: LocalDate }[]>`
    select bill_id, scheduled_date from bill_occurrences
    where user_id = ${userId} and scheduled_date between ${month} and ${monthEnd}`;
  const taken = new Set(stored.map((r) => `${r.bill_id}:${r.scheduled_date}`));
  const bills = await tx<{ id: string; amount_minor: number; currency: string; recurrence: Recurrence; anchor_date: LocalDate; track_from: LocalDate }[]>`
    select id, amount_minor, currency, recurrence, anchor_date, track_from from bills where user_id = ${userId} and status = 'active'`;
  for (const b of bills) {
    const from = month < b.track_from ? b.track_from : month;
    for (const d of occurrencesBetween(b.anchor_date, b.recurrence, from, monthEnd, 40)) {
      if (taken.has(`${b.id}:${d}`)) continue;
      out.push({ amount_minor: b.amount_minor, currency: b.currency, due_date: d, paid: false });
    }
  }
  return out;
}

export async function saveIncomeSource(tx: Tx, userId: string, id: string | null, input: IncomeInput): Promise<void> {
  if (id) {
    const res = await tx`
      update income_sources set name = ${input.name}, amount_minor = ${input.amount_minor}, currency = ${input.currency},
        recurrence = ${input.recurrence}, anchor_date = ${input.anchor_date}
      where id = ${id} and user_id = ${userId}`;
    if (res.count === 0) throw new Error("Income not found");
    return;
  }
  await tx`
    insert into income_sources (user_id, name, amount_minor, currency, recurrence, anchor_date)
    values (${userId}, ${input.name}, ${input.amount_minor}, ${input.currency}, ${input.recurrence}, ${input.anchor_date})`;
}

export async function deleteIncomeSource(tx: Tx, userId: string, id: string): Promise<boolean> {
  const res = await tx`delete from income_sources where id = ${id} and user_id = ${userId}`;
  return res.count > 0;
}

/** Returns false when another category already has that name. */
export async function saveCategory(tx: Tx, userId: string, id: string | null, input: CategoryInput): Promise<boolean> {
  const dupe = await tx`
    select 1 from budget_categories
    where user_id = ${userId} and lower(btrim(name)) = lower(btrim(${input.name})) and (${id}::uuid is null or id <> ${id}::uuid)`;
  if (dupe.length > 0) return false;
  if (id) {
    const res = await tx`update budget_categories set name = ${input.name}, monthly_limit_minor = ${input.limit_minor} where id = ${id} and user_id = ${userId}`;
    if (res.count === 0) throw new Error("Category not found");
    return true;
  }
  await tx`
    insert into budget_categories (user_id, name, monthly_limit_minor, sort_order)
    values (${userId}, ${input.name}, ${input.limit_minor},
            coalesce((select max(sort_order) + 1 from budget_categories where user_id = ${userId}), 0))`;
  return true;
}

export async function deleteCategory(tx: Tx, userId: string, id: string): Promise<boolean> {
  const res = await tx`delete from budget_categories where id = ${id} and user_id = ${userId}`;
  return res.count > 0;
}

export async function addStarterCategories(tx: Tx, userId: string): Promise<void> {
  for (const [i, name] of STARTER_CATEGORIES.entries()) {
    await tx`
      insert into budget_categories (user_id, name, sort_order) values (${userId}, ${name}, ${i})
      on conflict (user_id, lower(btrim(name))) do nothing`;
  }
}

export async function addExpense(tx: Tx, userId: string, input: ExpenseInput): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into expenses (user_id, category_id, amount_minor, currency, spent_on, note)
    values (${userId}, ${input.category_id}, ${input.amount_minor}, ${input.currency}, ${input.spent_on}, ${input.note})
    returning id`;
  return row.id;
}

export async function updateExpense(tx: Tx, userId: string, id: string, input: ExpenseInput): Promise<boolean> {
  const res = await tx`
    update expenses set category_id = ${input.category_id}, amount_minor = ${input.amount_minor}, currency = ${input.currency},
      spent_on = ${input.spent_on}, note = ${input.note}
    where id = ${id} and user_id = ${userId}`;
  return res.count > 0;
}

export async function deleteExpense(tx: Tx, userId: string, id: string): Promise<boolean> {
  const res = await tx`delete from expenses where id = ${id} and user_id = ${userId}`;
  return res.count > 0;
}
