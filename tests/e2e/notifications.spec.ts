import { expect, test } from "@playwright/test";
import { E2E_CRON_SECRET } from "../../playwright.config";
import { addBill, db, signInOnboarded, torontoToday, uniqueEmail } from "./helpers";

test("the scheduler endpoint rejects requests without the secret", async ({ request }) => {
  expect((await request.post("/api/cron/reminders")).status()).toBe(401);
  expect((await request.post("/api/cron/reminders", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
});

test("a scheduled test reminder is delivered by the scheduler, and failures show in Settings", async ({ page, request }) => {
  const email = uniqueEmail("notify");
  await signInOnboarded(page, email);
  // Simulate two devices: one healthy, one whose push service is failing.
  const [user] = await db`select id from auth.users where email = ${email}`;
  await db`insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label) values
    (${user.id}, ${`https://push.example.test/ok-${user.id}`}, 'k', 'a', 'Test iPhone'),
    (${user.id}, ${`https://push.example.test/fail-${user.id}`}, 'k', 'a', 'Broken laptop')`;

  await page.goto("/settings");
  await page.getByRole("button", { name: "Schedule a test in 2 minutes" }).click();
  await expect(page.getByText(/Test scheduled for/)).toBeVisible();
  // Use the test clock: pull the reminder's time to now instead of waiting.
  await db`update reminders set send_at = now() - interval '1 second' where user_id = ${user.id} and kind = 'test'`;
  const res = await request.post("/api/cron/reminders", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.summary.sentNotifications).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.getByText("Accepted by provider").first()).toBeVisible();
  await expect(page.getByText(/recent delivery problem/)).toBeVisible();
  await expect(page.getByText("Push service unavailable").first()).toBeVisible();
});

test("a real bill reminder is sent by the scheduler and stops after payment", async ({ page, request }) => {
  const email = uniqueEmail("billrem");
  await signInOnboarded(page, email);
  const [user] = await db`select id from auth.users where email = ${email}`;
  await db`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (${user.id}, ${`https://push.example.test/ok2-${user.id}`}, 'k', 'a')`;
  await db`update notification_preferences set quiet_hours_enabled = false where user_id = ${user.id}`;
  await addBill(page, { name: "Hydro", amount: "112.48", due: torontoToday(0) });
  await db`update bill_occurrences set created_at = now() - interval '2 days' where user_id = ${user.id}`;
  // Reminder hour = the current Toronto hour, so the due-day reminder is due now.
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  await db`update notification_preferences set reminder_hour = ${hour} where user_id = ${user.id}`;
  const cron = () => request.post("/api/cron/reminders", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  await cron();
  const sent = await db`select r.kind::text, r.status::text from reminders r where r.user_id = ${user.id} and r.kind = 'due'`;
  expect(sent).toEqual([{ kind: "due", status: "sent" }]);

  // Pay it; a pending snooze reminder must be canceled.
  await page.goto("/");
  await page.getByRole("button", { name: "More actions for Hydro" }).click();
  await page.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByText("Snoozed")).toBeVisible();
  await page.getByRole("button", { name: "Mark Hydro paid" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByText("Handled.").first()).toBeVisible();
  const pending = await db`select count(*)::int as n from reminders where user_id = ${user.id} and status = 'pending'`;
  expect(pending[0].n).toBe(0);
});

test("denied notification permission does not break the app", async ({ page, isMobile }) => {
  test.skip(isMobile, "iPhone Safari shows install steps first; covered by the next test");
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(function Notification() {}, { permission: "denied", requestPermission: async () => "denied" }),
    });
  });
  await signInOnboarded(page, uniqueEmail("denied"));
  await page.goto("/settings");
  await expect(page.getByTestId("push-denied")).toBeVisible();
  await addBill(page, { name: "Still works", amount: "5", due: torontoToday(3) });
});

test("iPhone Safari outside the Home Screen gets install steps instead of a broken prompt", async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  await signInOnboarded(page, uniqueEmail("ios"));
  await page.goto("/settings");
  await expect(page.getByTestId("ios-install-steps")).toBeVisible();
  await ctx.close();
});
