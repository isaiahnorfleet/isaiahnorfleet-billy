import type { Tx } from "@/lib/db/client";
import { addDays, maxDate, type LocalDate } from "@/lib/domain/dates";
import { MATERIALIZE_HORIZON_DAYS, occurrencesBetween, type Recurrence } from "@/lib/domain/recurrence";

interface BillForGeneration {
  id: string;
  user_id: string;
  amount_minor: number;
  currency: string;
  recurrence: Recurrence;
  anchor_date: LocalDate;
  track_from: LocalDate;
  last_scheduled: LocalDate | null;
}

/**
 * Create occurrence rows for a user's active bills from where generation last stopped up to
 * today + horizon. Idempotent: (bill_id, scheduled_date) is unique and inserts use ON CONFLICT.
 * Existing occurrences (paid, overdue, overridden) are never modified here.
 * Also always creates the next occurrence even if it is beyond the horizon (e.g. yearly bills).
 */
export async function materializeOccurrences(tx: Tx, userId: string, today: LocalDate): Promise<number> {
  const bills = await tx<BillForGeneration[]>`
    select b.id, b.user_id, b.amount_minor, b.currency, b.recurrence, b.anchor_date, b.track_from,
           (select max(o.scheduled_date) from bill_occurrences o where o.bill_id = b.id) as last_scheduled
    from bills b
    where b.user_id = ${userId} and b.status = 'active'`;
  const horizon = addDays(today, MATERIALIZE_HORIZON_DAYS);
  const rows: { user_id: string; bill_id: string; scheduled_date: string; due_date: string; amount_minor: number; currency: string }[] = [];
  for (const bill of bills) {
    const start = bill.last_scheduled ? maxDate(bill.track_from, addDays(bill.last_scheduled, 1)) : maxDate(bill.track_from, bill.anchor_date);
    let dates =
      bill.recurrence === "once"
        ? !bill.last_scheduled && bill.anchor_date >= bill.track_from
          ? [bill.anchor_date]
          : []
        : occurrencesBetween(bill.anchor_date, bill.recurrence, start, horizon, 200);
    if (dates.length === 0 && bill.recurrence !== "once" &&(!bill.last_scheduled || bill.last_scheduled < today)) {
      // Ensure the next cycle exists so the bill always shows its next due date.
      dates = occurrencesBetween(bill.anchor_date, bill.recurrence, start, addDays(horizon, 400), 1);
    }
    for (const d of dates) {
      rows.push({ user_id: bill.user_id, bill_id: bill.id, scheduled_date: d, due_date: d, amount_minor: bill.amount_minor, currency: bill.currency });
    }
  }
  if (rows.length === 0) return 0;
  const inserted = await tx`
    insert into bill_occurrences ${tx(rows, "user_id", "bill_id", "scheduled_date", "due_date", "amount_minor", "currency")}
    on conflict (bill_id, scheduled_date) do nothing
    returning id`;
  return inserted.length;
}

export interface OccurrenceRow {
  id: string;
  bill_id: string;
  bill_name: string;
  category: string;
  recurrence: Recurrence;
  autopay: boolean;
  autopay_account: string | null;
  payment_url: string | null;
  due_date: LocalDate;
  scheduled_date: LocalDate;
  amount_minor: number;
  currency: string;
  status: "open" | "paid" | "skipped";
  planned_payment_date: LocalDate | null;
  note: string | null;
  snoozed_until: Date | null;
  amount_overridden: boolean;
  due_overridden: boolean;
  payment_id: string | null;
  paid_on: LocalDate | null;
  paid_amount_minor: number | null;
}

const OCCURRENCE_SELECT = (tx: Tx) => tx`
  select o.id, o.bill_id, b.name as bill_name, b.category, b.recurrence, b.autopay, b.autopay_account, b.payment_url,
         o.due_date, o.scheduled_date, o.amount_minor, o.currency, o.status, o.planned_payment_date, o.note,
         o.snoozed_until, o.amount_overridden, o.due_overridden,
         p.id as payment_id, p.paid_on, p.amount_minor as paid_amount_minor
  from bill_occurrences o
  join bills b on b.id = o.bill_id
  left join payments p on p.occurrence_id = o.id and p.voided_at is null`;

/** Open occurrences of active bills that are overdue or due up to `until`, plus anything paid this month. */
export async function listOccurrencesForDashboard(tx: Tx, userId: string, monthStart: LocalDate, until: LocalDate): Promise<OccurrenceRow[]> {
  return tx<OccurrenceRow[]>`
    ${OCCURRENCE_SELECT(tx)}
    where o.user_id = ${userId} and b.status = 'active'
      and ((o.status = 'open' and o.due_date <= ${until}) or (o.due_date between ${monthStart} and ${until}))
    order by o.due_date, b.name`;
}

export async function listOccurrencesInRange(tx: Tx, userId: string, from: LocalDate, to: LocalDate): Promise<OccurrenceRow[]> {
  return tx<OccurrenceRow[]>`
    ${OCCURRENCE_SELECT(tx)}
    where o.user_id = ${userId} and o.due_date between ${from} and ${to}
      and (b.status = 'active' or o.status = 'paid')
    order by o.due_date, b.name`;
}

export async function listOccurrencesForBill(tx: Tx, userId: string, billId: string): Promise<OccurrenceRow[]> {
  return tx<OccurrenceRow[]>`
    ${OCCURRENCE_SELECT(tx)}
    where o.user_id = ${userId} and o.bill_id = ${billId}
    order by o.due_date desc`;
}

export async function getOccurrence(tx: Tx, userId: string, occurrenceId: string): Promise<OccurrenceRow | null> {
  const rows = await tx<OccurrenceRow[]>`
    ${OCCURRENCE_SELECT(tx)}
    where o.user_id = ${userId} and o.id = ${occurrenceId}`;
  return rows[0] ?? null;
}
