import { beforeEach, describe, expect, it } from "vitest";
import { sql, withUser } from "@/lib/db/client";
import { createBill, setBillArchived, updateBill } from "@/lib/data/bills";
import { listOccurrencesForBill } from "@/lib/data/occurrences";
import { recordPayment, voidPayment } from "@/lib/data/payments";
import { getPreferences, scheduleTestReminder, snoozeOccurrence, updatePreferences } from "@/lib/data/notifications";
import { runReminderCycle } from "@/lib/reminders/engine";
import { fakeSenders } from "@/lib/reminders/senders";
import { addPushSubscription, billInput, createUser, resetDb } from "./helpers";

let user: { id: string; email: string };
let senders: ReturnType<typeof fakeSenders>;

// A controllable test clock. Toronto is UTC-4 until Nov 1 2026, then UTC-5.
const at = (iso: string) => new Date(iso);
const cycle = (now: Date) =>
  runReminderCycle({ sql: sql(), senders, now, appUrl: "https://billy.test", pushReady: true, emailReady: true });

async function reminders() {
  return sql()<{ kind: string; channel: string; status: string; slot_date: string; send_at: Date; skip_reason: string | null }[]>`
    select kind::text, channel::text, status::text, slot_date, send_at, skip_reason from reminders order by send_at, channel`;
}

async function billDueNov10() {
  // Created on Nov 1 so all reminders are in the future.
  const billId = await withUser(user.id, (tx) => createBill(tx, user.id, billInput({ due_date: "2026-11-10" }), "2026-11-01"));
  await sql()`update bill_occurrences set created_at = '2026-11-01T12:00:00Z'`;
  const [occ] = (await withUser(user.id, (tx) => listOccurrencesForBill(tx, user.id, billId))).reverse();
  return { billId, occId: occ.id };
}

beforeEach(async () => {
  await resetDb();
  user = await createUser({ email: "isaiah@example.test", lockScreenDetails: true });
  await addPushSubscription(user.id);
  senders = fakeSenders();
});

describe("scheduled reminders", () => {
  it("sends 3-day, 1-day and due-day reminders at 9:00 local time while the app is closed", async () => {
    await billDueNov10();
    // Nov 7, 08:55 EST: not yet time.
    let s = await cycle(at("2026-11-07T13:55:00Z"));
    expect(s.planned).toBeGreaterThan(0);
    expect(senders.sent).toHaveLength(0);
    // Nov 7, 09:00 EST: the 3-days-before reminder goes out.
    s = await cycle(at("2026-11-07T14:00:00Z"));
    expect(s.sentNotifications).toBe(1);
    expect(senders.sent[0].title).toBe("Hydro due in 3 days · $112.48");
    await cycle(at("2026-11-09T14:01:00Z"));
    await cycle(at("2026-11-10T14:02:00Z"));
    expect(senders.sent.map((m) => m.title)).toEqual([
      "Hydro due in 3 days · $112.48",
      "Hydro due tomorrow · $112.48",
      "Hydro is due today · $112.48",
    ]);
    const deliveries = await sql()`select status::text from notification_deliveries`;
    expect(deliveries.every((d) => d.status === "accepted")).toBe(true);
  });

  it("repeated and overlapping runs never create duplicate reminders or notifications", async () => {
    await billDueNov10();
    const now = at("2026-11-07T14:00:00Z");
    await Promise.all([cycle(now), cycle(now), cycle(now)]);
    await cycle(now);
    expect(senders.sent).toHaveLength(1);
    const keys = await sql()`select dedupe_key, count(*)::int as n from reminders group by dedupe_key having count(*) > 1`;
    expect(keys).toHaveLength(0);
  });

  it("stops pending reminders once the occurrence is paid, and restores them on undo", async () => {
    const { occId } = await billDueNov10();
    await cycle(at("2026-11-08T20:00:00Z")); // plans the Nov 9 reminder
    const { paymentId } = await withUser(user.id, (tx) => recordPayment(tx, user.id, { occurrenceId: occId, amountMinor: 11248, paidOn: "2026-11-08", note: null }));
    expect((await reminders()).filter((r) => r.status === "pending")).toHaveLength(0);
    await cycle(at("2026-11-09T14:00:00Z"));
    await cycle(at("2026-11-10T14:00:00Z"));
    expect(senders.sent).toHaveLength(0);

    await withUser(user.id, (tx) => voidPayment(tx, user.id, paymentId, "undo", at("2026-11-10T14:04:00Z")));
    await cycle(at("2026-11-10T14:05:00Z"));
    expect(senders.sent.map((m) => m.title)).toEqual(["Hydro is due today · $112.48"]);
  });

  it("snoozing moves the next reminder and leaves the due date unchanged", async () => {
    const { occId, billId } = await billDueNov10();
    await withUser(user.id, (tx) => snoozeOccurrence(tx, user.id, occId, at("2026-11-11T15:00:00Z"), ["push"]));
    await cycle(at("2026-11-10T14:00:00Z")); // due-day reminder suppressed by the snooze
    expect(senders.sent).toHaveLength(0);
    await cycle(at("2026-11-11T15:00:00Z"));
    expect(senders.sent).toHaveLength(1);
    expect(senders.sent[0].title).toContain("overdue");
    const occ = (await withUser(user.id, (tx) => listOccurrencesForBill(tx, user.id, billId))).find((o) => o.id === occId)!;
    expect(occ.due_date).toBe("2026-11-10");
    expect(occ.scheduled_date).toBe("2026-11-10");
  });

  it("overdue follow-ups are daily and bounded", async () => {
    await withUser(user.id, async (tx) => {
      const p = await getPreferences(tx, user.id);
      await updatePreferences(tx, user.id, { ...p, default_offsets: [], overdue_followup_days: 2 });
    });
    await billDueNov10();
    for (let day = 11; day <= 15; day++) await cycle(at(`2026-11-${day}T14:00:00Z`));
    expect(senders.sent.map((m) => m.title)).toEqual(["Hydro is overdue · $112.48", "Hydro is overdue · $112.48"]);
  });

  it("respects quiet hours by deferring to the end of quiet hours", async () => {
    await withUser(user.id, async (tx) => {
      const p = await getPreferences(tx, user.id);
      await updatePreferences(tx, user.id, { ...p, reminder_hour: 6, quiet_start: "22:00", quiet_end: "07:30" });
    });
    await billDueNov10();
    await cycle(at("2026-11-10T11:00:00Z")); // 06:00 EST, inside quiet hours
    expect(senders.sent).toHaveLength(0);
    await cycle(at("2026-11-10T12:30:00Z")); // 07:30 EST
    expect(senders.sent).toHaveLength(1);
  });

  it("archiving the bill cancels its pending reminders", async () => {
    const { billId } = await billDueNov10();
    await cycle(at("2026-11-09T20:00:00Z")); // sends the 1-day reminder, plans the due-day one
    expect(senders.sent).toHaveLength(1);
    await withUser(user.id, (tx) => setBillArchived(tx, user.id, billId, true, "2026-11-09"));
    await cycle(at("2026-11-10T14:00:00Z"));
    expect(senders.sent).toHaveLength(1);
  });

  it("a changed due date cancels old reminders and plans new ones", async () => {
    const { billId } = await billDueNov10();
    await cycle(at("2026-11-09T20:00:00Z")); // sends the 1-day reminder, plans the due-day one
    await withUser(user.id, (tx) => updateBill(tx, user.id, billId, billInput({ due_date: "2026-11-12" }), "2026-11-09"));
    senders.sent.length = 0;
    await cycle(at("2026-11-10T14:00:00Z"));
    expect(senders.sent).toHaveLength(0);
    await cycle(at("2026-11-11T14:00:00Z"));
    expect(senders.sent.map((m) => m.title)).toEqual(["Hydro due tomorrow · $112.48"]);
  });

  it("groups bills due together into one notification and applies the daily cap", async () => {
    await withUser(user.id, async (tx) => {
      const p = await getPreferences(tx, user.id);
      await updatePreferences(tx, user.id, { ...p, max_per_day: 1, default_offsets: [0], overdue_followups: false });
    });
    await withUser(user.id, (tx) => createBill(tx, user.id, billInput({ name: "Rent", due_date: "2026-11-10" }), "2026-11-01"));
    await withUser(user.id, (tx) => createBill(tx, user.id, billInput({ name: "Phone", due_date: "2026-11-10" }), "2026-11-01"));
    await withUser(user.id, (tx) => createBill(tx, user.id, billInput({ name: "Gym", due_date: "2026-11-10", reminder_offsets: [0] }), "2026-11-01"));
    await sql()`update bill_occurrences set created_at = '2026-11-01T12:00:00Z'`;
    await cycle(at("2026-11-10T14:00:00Z"));
    expect(senders.sent).toHaveLength(1);
    expect(senders.sent[0].title).toBe("3 bills coming up");
  });

  it("time zones: the same bill reminds at 9:00 in the user's own zone", async () => {
    await sql()`update profiles set time_zone = 'America/Vancouver'`;
    await billDueNov10();
    await cycle(at("2026-11-10T14:00:00Z")); // 06:00 PST
    expect(senders.sent).toHaveLength(0);
    await cycle(at("2026-11-10T17:00:00Z")); // 09:00 PST
    expect(senders.sent).toHaveLength(1);
  });
});

describe("lock-screen privacy", () => {
  it("by default, push notifications do not show bill names or amounts", async () => {
    await sql()`update notification_preferences set lock_screen_details = false`;
    await billDueNov10();
    await cycle(at("2026-11-07T14:00:00Z"));
    expect(senders.sent[0].title).toBe("Billy");
    expect(senders.sent[0].body).not.toMatch(/Hydro|112/);
  });
});

describe("delivery failures are recorded and visible", () => {
  it("an expired push subscription is deactivated and recorded", async () => {
    await sql()`delete from push_subscriptions`;
    await addPushSubscription(user.id, "https://push.example.test/gone-device");
    await billDueNov10();
    await cycle(at("2026-11-07T14:00:00Z"));
    const [sub] = await sql()`select disabled_at, last_error from push_subscriptions`;
    expect(sub.disabled_at).not.toBeNull();
    const [d] = await sql()`select status::text, http_status from notification_deliveries`;
    expect(d).toMatchObject({ status: "expired", http_status: 410 });
    expect((await reminders()).find((r) => r.slot_date === "2026-11-07")!.status).toBe("pending"); // retry later
  });

  it("provider outages are retried with backoff and then marked failed", async () => {
    await sql()`delete from push_subscriptions`;
    await addPushSubscription(user.id, "https://push.example.test/fail-device");
    await billDueNov10();
    let t = at("2026-11-07T14:00:00Z").getTime();
    for (let i = 0; i < 6; i++) {
      await cycle(new Date(t));
      t += 20 * 60_000;
    }
    const r = (await reminders()).find((x) => x.slot_date === "2026-11-07")!;
    expect(r.status).toBe("failed");
    const failures = await sql()`select count(*)::int as n from notification_deliveries where status = 'failed'`;
    expect(failures[0].n).toBe(3);
  });

  it("one working device is enough for the reminder to count as accepted", async () => {
    await addPushSubscription(user.id, "https://push.example.test/fail-device");
    await billDueNov10();
    await cycle(at("2026-11-07T14:00:00Z"));
    expect((await reminders()).find((x) => x.slot_date === "2026-11-07")!.status).toBe("sent");
  });

  it("email failures are recorded separately from push", async () => {
    await withUser(user.id, async (tx) => {
      const p = await getPreferences(tx, user.id);
      await updatePreferences(tx, user.id, { ...p, email_enabled: true, email_address: "fail@example.test" });
    });
    await billDueNov10();
    await cycle(at("2026-11-07T14:00:00Z"));
    const rows = await sql()`select channel::text, status::text from notification_deliveries order by channel desc`;
    expect(rows).toEqual([{ channel: "push", status: "accepted" }, { channel: "email", status: "failed" }]);
  });

  it("an unconfigured channel fails visibly instead of pretending", async () => {
    await withUser(user.id, (tx) => scheduleTestReminder(tx, user.id, at("2026-11-07T14:00:00Z"), ["push"], "America/Toronto"));
    await runReminderCycle({ sql: sql(), senders, now: at("2026-11-07T14:01:00Z"), appUrl: "https://billy.test", pushReady: false, emailReady: false });
    const [d] = await sql()`select status::text, error from notification_deliveries`;
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/not configured/);
  });
});

describe("test reminders go through the real scheduler", () => {
  it("a scheduled test reminder is delivered by the next cycle after its time", async () => {
    await withUser(user.id, (tx) => scheduleTestReminder(tx, user.id, at("2026-11-07T14:02:00Z"), ["push"], "America/Toronto"));
    await cycle(at("2026-11-07T14:00:00Z"));
    expect(senders.sent).toHaveLength(0);
    await cycle(at("2026-11-07T14:05:00Z"));
    expect(senders.sent.map((m) => m.title)).toEqual(["Billy test reminder"]);
  });
});
