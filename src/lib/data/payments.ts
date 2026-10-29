import type { Tx } from "@/lib/db/client";
import type { LocalDate } from "@/lib/domain/dates";

export class PaymentError extends Error {}

/**
 * Record that the user paid one occurrence. Billy does not move money; this is a record.
 * Atomically: inserts the payment, marks the occurrence paid, and cancels its pending reminders.
 * Other occurrences of the bill (including older unpaid ones) and the schedule are untouched.
 */
export async function recordPayment(
  tx: Tx,
  userId: string,
  input: { occurrenceId: string; amountMinor: number; paidOn: LocalDate; note: string | null },
): Promise<{ paymentId: string; billName: string }> {
  const [occ] = await tx<{ id: string; bill_id: string; status: string; currency: string; bill_name: string }[]>`
    select o.id, o.bill_id, o.status, o.currency, b.name as bill_name
    from bill_occurrences o join bills b on b.id = o.bill_id
    where o.id = ${input.occurrenceId} and o.user_id = ${userId}
    for update of o`;
  if (!occ) throw new PaymentError("That bill could not be found.");
  if (occ.status === "paid") throw new PaymentError("This one is already marked paid.");
  const [payment] = await tx<{ id: string }[]>`
    insert into payments (user_id, bill_id, occurrence_id, amount_minor, currency, paid_on, note)
    values (${userId}, ${occ.bill_id}, ${occ.id}, ${input.amountMinor}, ${occ.currency}, ${input.paidOn}, ${input.note})
    returning id`;
  await tx`update bill_occurrences set status = 'paid', snoozed_until = null where id = ${occ.id}`;
  await tx`
    update reminders set status = 'canceled', skip_reason = 'paid'
    where occurrence_id = ${occ.id} and status = 'pending'`;
  return { paymentId: payment.id, billName: occ.bill_name };
}

/**
 * Undo / correct an accidental "paid". The payment row is kept (voided) for history; the
 * occurrence becomes open again with its original due date, so it is overdue again if it was.
 * Future reminders that were canceled because of the payment are restored.
 */
export async function voidPayment(tx: Tx, userId: string, paymentId: string, reason: string, now: Date = new Date()): Promise<{ occurrenceId: string }> {
  const [p] = await tx<{ id: string; occurrence_id: string; voided_at: Date | null }[]>`
    select id, occurrence_id, voided_at from payments where id = ${paymentId} and user_id = ${userId} for update`;
  if (!p) throw new PaymentError("That payment could not be found.");
  if (p.voided_at) return { occurrenceId: p.occurrence_id };
  await tx`update payments set voided_at = now(), void_reason = ${reason} where id = ${p.id}`;
  await tx`update bill_occurrences set status = 'open' where id = ${p.occurrence_id} and status = 'paid'`;
  await tx`
    update reminders set status = 'pending', skip_reason = null
    where occurrence_id = ${p.occurrence_id} and status = 'canceled' and skip_reason = 'paid' and send_at > ${now}`;
  return { occurrenceId: p.occurrence_id };
}

/** Correct a payment's amount or date: void the old record and create a corrected one. */
export async function correctPayment(
  tx: Tx,
  userId: string,
  paymentId: string,
  input: { amountMinor: number; paidOn: LocalDate; note: string | null },
): Promise<{ paymentId: string }> {
  const { occurrenceId } = await voidPayment(tx, userId, paymentId, "corrected");
  const { paymentId: newId } = await recordPayment(tx, userId, { occurrenceId, ...input });
  return { paymentId: newId };
}

export interface PaymentHistoryRow {
  id: string;
  bill_id: string;
  bill_name: string;
  category: string;
  occurrence_id: string;
  due_date: LocalDate;
  amount_minor: number;
  currency: string;
  paid_on: LocalDate;
  note: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
}

export async function listPayments(
  tx: Tx,
  userId: string,
  filters: { q?: string; billId?: string; from?: LocalDate; to?: LocalDate; includeVoided?: boolean } = {},
): Promise<PaymentHistoryRow[]> {
  const q = filters.q ? `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return tx<PaymentHistoryRow[]>`
    select p.id, p.bill_id, b.name as bill_name, b.category, p.occurrence_id, o.due_date, p.amount_minor, p.currency,
           p.paid_on, p.note, p.voided_at, p.void_reason, p.created_at
    from payments p
    join bills b on b.id = p.bill_id
    join bill_occurrences o on o.id = p.occurrence_id
    where p.user_id = ${userId}
      ${filters.includeVoided ? tx`` : tx`and p.voided_at is null`}
      ${filters.billId ? tx`and p.bill_id = ${filters.billId}` : tx``}
      ${filters.from ? tx`and p.paid_on >= ${filters.from}` : tx``}
      ${filters.to ? tx`and p.paid_on <= ${filters.to}` : tx``}
      ${q ? tx`and (b.name ilike ${q} or p.note ilike ${q})` : tx``}
    order by p.paid_on desc, p.created_at desc
    limit 500`;
}

/** Edit one occurrence only (amount and/or due date). The bill's schedule is unchanged. */
export async function editOccurrence(
  tx: Tx,
  userId: string,
  input: { occurrenceId: string; amountMinor: number; dueDate: LocalDate; note: string | null },
): Promise<void> {
  const [occ] = await tx<{ amount_minor: number; due_date: string; scheduled_date: string }[]>`
    select amount_minor, due_date, scheduled_date from bill_occurrences where id = ${input.occurrenceId} and user_id = ${userId} for update`;
  if (!occ) throw new PaymentError("That bill could not be found.");
  const amountChanged = occ.amount_minor !== input.amountMinor;
  const dueChanged = occ.due_date !== input.dueDate;
  await tx`
    update bill_occurrences set
      amount_minor = ${input.amountMinor},
      due_date = ${input.dueDate},
      note = ${input.note},
      amount_overridden = amount_overridden or ${amountChanged},
      due_overridden = ${input.dueDate !== occ.scheduled_date}
    where id = ${input.occurrenceId}`;
  if (dueChanged) {
    // Pending reminders were for the old date; the scheduler re-plans for the new one.
    await tx`update reminders set status = 'canceled', skip_reason = 'due_date_changed'
             where occurrence_id = ${input.occurrenceId} and status = 'pending'`;
  }
}

export async function setOccurrenceSkipped(tx: Tx, userId: string, occurrenceId: string, skipped: boolean): Promise<void> {
  const rows = await tx`
    update bill_occurrences set status = ${skipped ? "skipped" : "open"}
    where id = ${occurrenceId} and user_id = ${userId} and status = ${skipped ? "open" : "skipped"}
    returning id`;
  if (rows.length && skipped) {
    await tx`update reminders set status = 'canceled', skip_reason = 'skipped' where occurrence_id = ${occurrenceId} and status = 'pending'`;
  }
}
