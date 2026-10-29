import type { Tx } from "@/lib/db/client";
import type { LocalDate } from "@/lib/domain/dates";
import type { Recurrence } from "@/lib/domain/recurrence";
import type { BillInput } from "@/lib/validation";
import { materializeOccurrences } from "./occurrences";

export interface BillRow {
  id: string;
  name: string;
  amount_minor: number;
  currency: string;
  category: string;
  recurrence: Recurrence;
  anchor_date: LocalDate;
  track_from: LocalDate;
  autopay: boolean;
  payment_url: string | null;
  notes: string | null;
  reminders_enabled: boolean;
  reminder_offsets: number[] | null;
  status: "active" | "archived";
  created_at: Date;
}

export interface BillListRow extends BillRow {
  next_occurrence_id: string | null;
  next_due_date: LocalDate | null;
  next_amount_minor: number | null;
  overdue_count: number;
  oldest_overdue_id: string | null;
  oldest_overdue_date: LocalDate | null;
  last_paid_on: LocalDate | null;
}

export async function createBill(tx: Tx, userId: string, input: BillInput, today: LocalDate): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into bills (user_id, name, amount_minor, currency, category, recurrence, anchor_date, track_from,
                       autopay, payment_url, notes, reminders_enabled, reminder_offsets)
    values (${userId}, ${input.name}, ${input.amount_minor}, ${input.currency}, ${input.category}, ${input.recurrence},
            ${input.due_date}, ${input.due_date}, ${input.autopay}, ${input.payment_url}, ${input.notes},
            ${input.reminders_enabled}, ${input.reminder_offsets})
    returning id`;
  await materializeOccurrences(tx, userId, today);
  return row.id;
}

export async function getBill(tx: Tx, userId: string, billId: string): Promise<BillRow | null> {
  const rows = await tx<BillRow[]>`select * from bills where id = ${billId} and user_id = ${userId}`;
  return rows[0] ?? null;
}

export async function listBills(tx: Tx, userId: string, today: LocalDate): Promise<BillListRow[]> {
  return tx<BillListRow[]>`
    select b.*,
      n.id as next_occurrence_id, n.due_date as next_due_date, n.amount_minor as next_amount_minor,
      coalesce(od.cnt, 0)::int as overdue_count, od.oldest_id as oldest_overdue_id, od.oldest_date as oldest_overdue_date,
      lp.paid_on as last_paid_on
    from bills b
    left join lateral (
      select o.id, o.due_date, o.amount_minor from bill_occurrences o
      where o.bill_id = b.id and o.status = 'open' and o.due_date >= ${today}
      order by o.due_date limit 1
    ) n on true
    left join lateral (
      select count(*) as cnt, (array_agg(o.id order by o.due_date))[1] as oldest_id, min(o.due_date) as oldest_date
      from bill_occurrences o where o.bill_id = b.id and o.status = 'open' and o.due_date < ${today}
    ) od on true
    left join lateral (
      select max(p.paid_on) as paid_on from payments p where p.bill_id = b.id and p.voided_at is null
    ) lp on true
    where b.user_id = ${userId}
    order by b.status, coalesce(od.oldest_date, n.due_date) nulls last, b.name`;
}

export type AmountScope = "future" | "none";

/**
 * Update a bill's definition.
 * - Name, category, notes, link, autopay and reminder settings apply to the bill everywhere.
 * - A new amount applies to open occurrences due today or later that were not individually edited.
 *   Overdue and paid occurrences keep the amount they had.
 * - A new schedule (due date or recurrence) replaces open occurrences due today or later.
 *   Overdue, paid and individually edited occurrences are preserved.
 */
export async function updateBill(tx: Tx, userId: string, billId: string, input: BillInput, today: LocalDate): Promise<void> {
  const current = await getBill(tx, userId, billId);
  if (!current) throw new Error("Bill not found");
  const scheduleChanged = current.recurrence !== input.recurrence || current.anchor_date !== input.due_date;
  const nextDue = await tx<{ due_date: string }[]>`
    select scheduled_date as due_date from bill_occurrences
    where bill_id = ${billId} and status = 'open' and scheduled_date >= ${today} order by scheduled_date limit 1`;
  // Editing a field without touching the date shows the next due date; treat that as unchanged.
  const effectiveScheduleChange = scheduleChanged && !(current.recurrence === input.recurrence && nextDue[0]?.due_date === input.due_date);

  await tx`
    update bills set name = ${input.name}, amount_minor = ${input.amount_minor}, currency = ${input.currency},
      category = ${input.category}, autopay = ${input.autopay}, payment_url = ${input.payment_url}, notes = ${input.notes},
      reminders_enabled = ${input.reminders_enabled}, reminder_offsets = ${input.reminder_offsets}
    where id = ${billId} and user_id = ${userId}`;

  if (current.amount_minor !== input.amount_minor || current.currency !== input.currency) {
    await tx`
      update bill_occurrences set amount_minor = ${input.amount_minor}, currency = ${input.currency}
      where bill_id = ${billId} and status = 'open' and due_date >= ${today} and not amount_overridden`;
  }

  if (effectiveScheduleChange) {
    await tx`
      delete from bill_occurrences
      where bill_id = ${billId} and status = 'open' and due_date >= ${today} and not due_overridden and not amount_overridden
        and not exists (select 1 from payments p where p.occurrence_id = bill_occurrences.id)`;
    await tx`
      update bills set recurrence = ${input.recurrence}, anchor_date = ${input.due_date}, track_from = ${input.due_date}
      where id = ${billId} and user_id = ${userId}`;
  }
  await materializeOccurrences(tx, userId, today);
}

export async function setBillArchived(tx: Tx, userId: string, billId: string, archived: boolean, today: LocalDate): Promise<void> {
  await tx`
    update bills set status = ${archived ? "archived" : "active"}, archived_at = ${archived ? new Date() : null}
    where id = ${billId} and user_id = ${userId}`;
  if (archived) {
    await tx`
      update reminders set status = 'canceled', skip_reason = 'bill_archived'
      where user_id = ${userId} and status = 'pending'
        and occurrence_id in (select id from bill_occurrences where bill_id = ${billId})`;
  } else {
    await materializeOccurrences(tx, userId, today);
  }
}

/** Permanently delete a bill with its occurrences, payment records and reminders. */
export async function deleteBill(tx: Tx, userId: string, billId: string): Promise<boolean> {
  const rows = await tx`delete from bills where id = ${billId} and user_id = ${userId} returning id`;
  return rows.length > 0;
}
