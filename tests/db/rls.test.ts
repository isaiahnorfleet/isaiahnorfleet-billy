import { beforeEach, describe, expect, it } from "vitest";
import { withUser } from "@/lib/db/client";
import { createBill, listBills } from "@/lib/data/bills";
import { recordPayment } from "@/lib/data/payments";
import { billInput, createUser, resetDb } from "./helpers";

const today = "2026-10-29";

describe("row-level security (enforced by Postgres, not the UI)", () => {
  let alice: { id: string }, bob: { id: string }, aliceBill: string, aliceOcc: string;

  beforeEach(async () => {
    await resetDb();
    alice = await createUser({ email: "alice@example.test" });
    bob = await createUser({ email: "bob@example.test" });
    aliceBill = await withUser(alice.id, (tx) => createBill(tx, alice.id, billInput(), today));
    aliceOcc = await withUser(alice.id, async (tx) => (await tx`select id from bill_occurrences where bill_id = ${aliceBill} limit 1`)[0].id);
  });

  it("another user cannot read bills, occurrences, payments, or preferences, even by id", async () => {
    await withUser(alice.id, (tx) => recordPayment(tx, alice.id, { occurrenceId: aliceOcc, amountMinor: 11248, paidOn: today, note: null }));
    await withUser(bob.id, async (tx) => {
      expect(await tx`select * from bills`).toHaveLength(0);
      expect(await tx`select * from bills where id = ${aliceBill}`).toHaveLength(0);
      expect(await tx`select * from bill_occurrences`).toHaveLength(0);
      expect(await tx`select * from payments`).toHaveLength(0);
      expect(await tx`select * from notification_preferences`).toHaveLength(1); // only Bob's own
      expect(await tx`select * from profiles`).toHaveLength(1);
      // Even passing Alice's id to the app's own query returns nothing.
      expect(await listBills(tx, alice.id, today)).toHaveLength(0);
    });
  });

  it("another user cannot change or delete someone else's bill", async () => {
    await withUser(bob.id, async (tx) => {
      const upd = await tx`update bills set amount_minor = 1 where id = ${aliceBill} returning id`;
      const del = await tx`delete from bills where id = ${aliceBill} returning id`;
      expect(upd).toHaveLength(0);
      expect(del).toHaveLength(0);
    });
    const [row] = await withUser(alice.id, (tx) => tx`select amount_minor from bills where id = ${aliceBill}`);
    expect(row.amount_minor).toBe(11248);
  });

  it("cannot insert rows owned by another user", async () => {
    await expect(
      withUser(bob.id, (tx) => tx`insert into bills (user_id, name, amount_minor, recurrence, anchor_date, track_from)
                                  values (${alice.id}, 'x', 1, 'monthly', '2026-11-01', '2026-11-01')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot attach a payment or occurrence to someone else's bill", async () => {
    await expect(
      withUser(bob.id, (tx) => tx`insert into payments (user_id, bill_id, occurrence_id, amount_minor, currency, paid_on)
                                  values (${bob.id}, ${aliceBill}, ${aliceOcc}, 1, 'CAD', ${today})`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      withUser(bob.id, (tx) => tx`insert into bill_occurrences (user_id, bill_id, scheduled_date, due_date, amount_minor, currency)
                                  values (${bob.id}, ${aliceBill}, '2027-01-01', '2027-01-01', 1, 'CAD')`),
    ).rejects.toThrow(/row-level security/);
  });

  it("users cannot re-point a payment to another occurrence (column-level grants)", async () => {
    const { paymentId } = await withUser(alice.id, (tx) => recordPayment(tx, alice.id, { occurrenceId: aliceOcc, amountMinor: 1, paidOn: today, note: null }));
    await expect(withUser(alice.id, (tx) => tx`update payments set occurrence_id = ${aliceOcc} where id = ${paymentId}`)).rejects.toThrow(/permission denied/);
    await expect(withUser(alice.id, (tx) => tx`delete from payments where id = ${paymentId}`)).rejects.toThrow(/permission denied/);
  });

  it("scheduler-only tables are not readable by users", async () => {
    await expect(withUser(alice.id, (tx) => tx`select * from job_runs`)).rejects.toThrow(/permission denied/);
    await expect(withUser(alice.id, (tx) => tx`select * from rate_limits`)).rejects.toThrow(/permission denied/);
  });

  it("users can only create snooze/test reminders, not arbitrary ones", async () => {
    await expect(
      withUser(alice.id, (tx) => tx`insert into reminders (user_id, occurrence_id, kind, channel, slot_date, send_at, dedupe_key)
                                    values (${alice.id}, ${aliceOcc}, 'due', 'push', ${today}, now(), 'x')`),
    ).rejects.toThrow(/row-level security/);
  });
});
