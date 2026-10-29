import { beforeEach, describe, expect, it } from "vitest";
import { withUser } from "@/lib/db/client";
import { createBill, deleteBill, listBills, setBillArchived, updateBill } from "@/lib/data/bills";
import { listOccurrencesForBill, materializeOccurrences } from "@/lib/data/occurrences";
import { correctPayment, editOccurrence, listPayments, recordPayment, voidPayment } from "@/lib/data/payments";
import { billInput, createUser, resetDb } from "./helpers";

let user: { id: string };
const as = <T,>(fn: Parameters<typeof withUser<T>>[1]) => withUser<T>(user.id, fn);

beforeEach(async () => {
  await resetDb();
  user = await createUser();
});

describe("bills persist and generate occurrences", () => {
  it("a created bill is stored in the database and survives a fresh read", async () => {
    const id = await as((tx) => createBill(tx, user.id, billInput({ name: "Rent", amount_minor: 145000, due_date: "2026-11-01" }), "2026-10-29"));
    const bills = await as((tx) => listBills(tx, user.id, "2026-10-29"));
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({ id, name: "Rent", amount_minor: 145000, next_due_date: "2026-11-01" });
  });

  it("monthly bill on the 31st keeps its anchor through February", async () => {
    const id = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2027-01-31" }), "2027-01-01"));
    await as((tx) => materializeOccurrences(tx, user.id, "2027-03-20"));
    const dates = (await as((tx) => listOccurrencesForBill(tx, user.id, id))).map((o) => o.due_date).reverse();
    expect(dates.slice(0, 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("an unpaid occurrence stays overdue after the next cycle is created", async () => {
    const id = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-09-15" }), "2026-09-01"));
    await as((tx) => materializeOccurrences(tx, user.id, "2026-10-29"));
    const occs = await as((tx) => listOccurrencesForBill(tx, user.id, id));
    const sept = occs.find((o) => o.due_date === "2026-09-15")!;
    expect(sept.status).toBe("open");
    const list = await as((tx) => listBills(tx, user.id, "2026-10-29"));
    expect(list[0].overdue_count).toBe(2); // Sep 15 and Oct 15
    expect(list[0].oldest_overdue_date).toBe("2026-09-15");
    expect(list[0].next_due_date).toBe("2026-11-15");
  });

  it("materialization is idempotent", async () => {
    await as((tx) => createBill(tx, user.id, billInput(), "2026-10-29"));
    const again = await as((tx) => materializeOccurrences(tx, user.id, "2026-10-29"));
    expect(again).toBe(0);
  });

  it("one-time bills far in the future still get their single occurrence", async () => {
    const id = await as((tx) => createBill(tx, user.id, billInput({ recurrence: "once", due_date: "2027-06-01" }), "2026-10-29"));
    const occs = await as((tx) => listOccurrencesForBill(tx, user.id, id));
    expect(occs.map((o) => o.due_date)).toEqual(["2027-06-01"]);
  });
});

describe("payments", () => {
  async function setup() {
    const billId = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-09-15" }), "2026-09-01"));
    await as((tx) => materializeOccurrences(tx, user.id, "2026-10-29"));
    const occs = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    return { billId, occs };
  }

  it("marking one occurrence paid leaves other unpaid occurrences and the schedule intact", async () => {
    const { billId, occs } = await setup();
    const oct = occs.find((o) => o.due_date === "2026-10-15")!;
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: oct.id, amountMinor: 11248, paidOn: "2026-10-29", note: "online" }));
    const after = await as((tx) => listOccurrencesForBill(tx, user.id, billId));
    expect(after.find((o) => o.due_date === "2026-09-15")!.status).toBe("open");
    expect(after.find((o) => o.due_date === "2026-10-15")!.status).toBe("paid");
    expect(after.find((o) => o.due_date === "2026-11-15")!.status).toBe("open");
    const history = await as((tx) => listPayments(tx, user.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ amount_minor: 11248, paid_on: "2026-10-29", bill_name: "Hydro", note: "online" });
  });

  it("cannot pay the same occurrence twice", async () => {
    const { occs } = await setup();
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: occs[0].id, amountMinor: 1, paidOn: "2026-10-29", note: null }));
    await expect(as((tx) => recordPayment(tx, user.id, { occurrenceId: occs[0].id, amountMinor: 1, paidOn: "2026-10-29", note: null }))).rejects.toThrow(/already/);
  });

  it("undo voids the payment, keeps it in history, and the occurrence is overdue again", async () => {
    const { occs } = await setup();
    const sept = occs[0];
    const { paymentId } = await as((tx) => recordPayment(tx, user.id, { occurrenceId: sept.id, amountMinor: 11248, paidOn: "2026-10-29", note: null }));
    await as((tx) => voidPayment(tx, user.id, paymentId, "undo"));
    const list = await as((tx) => listBills(tx, user.id, "2026-10-29"));
    expect(list[0].overdue_count).toBe(2);
    expect(await as((tx) => listPayments(tx, user.id))).toHaveLength(0);
    const all = await as((tx) => listPayments(tx, user.id, { includeVoided: true }));
    expect(all).toHaveLength(1);
    expect(all[0].void_reason).toBe("undo");
    // and it can be paid again afterwards
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: sept.id, amountMinor: 11248, paidOn: "2026-10-30", note: null }));
  });

  it("correcting a payment replaces the amount without losing the original record", async () => {
    const { occs } = await setup();
    const { paymentId } = await as((tx) => recordPayment(tx, user.id, { occurrenceId: occs[0].id, amountMinor: 100, paidOn: "2026-10-29", note: null }));
    await as((tx) => correctPayment(tx, user.id, paymentId, { amountMinor: 11248, paidOn: "2026-10-28", note: null }));
    const active = await as((tx) => listPayments(tx, user.id));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ amount_minor: 11248, paid_on: "2026-10-28" });
    expect(await as((tx) => listPayments(tx, user.id, { includeVoided: true }))).toHaveLength(2);
  });
});

describe("editing", () => {
  it("editing one occurrence does not change the bill or other occurrences", async () => {
    const billId = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-11-15" }), "2026-10-29"));
    const [first] = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    await as((tx) => editOccurrence(tx, user.id, { occurrenceId: first.id, amountMinor: 20000, dueDate: "2026-11-20", note: "higher this month" }));
    await as((tx) => materializeOccurrences(tx, user.id, "2026-11-25"));
    const occs = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    expect(occs[0]).toMatchObject({ due_date: "2026-11-20", scheduled_date: "2026-11-15", amount_minor: 20000, amount_overridden: true });
    expect(occs[1]).toMatchObject({ due_date: "2026-12-15", amount_minor: 11248 });
  });

  it("a new amount applies to upcoming unpaid occurrences only; overdue and paid keep theirs", async () => {
    const billId = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-09-15" }), "2026-09-01"));
    await as((tx) => materializeOccurrences(tx, user.id, "2026-10-29"));
    const occs = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: occs[0].id, amountMinor: 11248, paidOn: "2026-09-15", note: null }));
    await as((tx) => updateBill(tx, user.id, billId, billInput({ amount: "130.00", amount_minor: 13000, due_date: "2026-11-15" }), "2026-10-29"));
    const after = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    expect(after.find((o) => o.due_date === "2026-09-15")!.amount_minor).toBe(11248); // paid
    expect(after.find((o) => o.due_date === "2026-10-15")!.amount_minor).toBe(11248); // overdue
    expect(after.find((o) => o.due_date === "2026-11-15")!.amount_minor).toBe(13000);
    expect((await as((tx) => listPayments(tx, user.id)))[0].amount_minor).toBe(11248);
  });

  it("a schedule change replaces future unpaid occurrences and preserves overdue/paid history", async () => {
    const billId = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-09-15" }), "2026-09-01"));
    await as((tx) => materializeOccurrences(tx, user.id, "2026-10-29"));
    await as((tx) => updateBill(tx, user.id, billId, billInput({ due_date: "2026-11-30" }), "2026-10-29"));
    const after = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).map((o) => o.due_date).sort();
    expect(after).toContain("2026-09-15");
    expect(after).toContain("2026-10-15");
    expect(after).not.toContain("2026-11-15");
    expect(after).toContain("2026-11-30");
  });

  it("archiving hides a bill from active lists but keeps payment history; delete removes it", async () => {
    const billId = await as((tx) => createBill(tx, user.id, billInput({ due_date: "2026-10-15" }), "2026-10-01"));
    const [occ] = (await as((tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
    await as((tx) => recordPayment(tx, user.id, { occurrenceId: occ.id, amountMinor: 1, paidOn: "2026-10-15", note: null }));
    await as((tx) => setBillArchived(tx, user.id, billId, true, "2026-10-29"));
    expect((await as((tx) => listBills(tx, user.id, "2026-10-29")))[0].status).toBe("archived");
    expect(await as((tx) => listPayments(tx, user.id))).toHaveLength(1);
    await as((tx) => deleteBill(tx, user.id, billId));
    expect(await as((tx) => listBills(tx, user.id, "2026-10-29"))).toHaveLength(0);
  });
});
