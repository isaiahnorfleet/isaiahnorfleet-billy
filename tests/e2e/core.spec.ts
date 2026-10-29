import { expect, test } from "@playwright/test";
import { addBill, db, expectNoHorizontalOverflow, newDevice, signIn, signInOnboarded, torontoToday, uniqueEmail } from "./helpers";

test("onboarding: confirm profile, add a first bill, land on the dashboard", async ({ page }) => {
  await signIn(page, uniqueEmail("onb"));
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.fill("#display_name", "Isaiah");
  await expect(page.locator("#time_zone")).toHaveValue("America/Toronto");
  await expect(page.locator("#currency")).toHaveValue("CAD");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill("#name", "Rent");
  await page.fill("#amount", "1450");
  await page.fill("#due_date", torontoToday(3));
  await page.getByRole("button", { name: "Add bill" }).click();
  await expect(page.getByText("How reminders work.")).toBeVisible();
  await page.getByRole("button", { name: "Go to my dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Hey Isaiah." })).toBeVisible();
  await expect(page.getByTestId("billy-message")).toContainText("Rent");
  await expect(page.getByTestId("billy-message")).toContainText("three days");
});

test("a bill persists across reload and is visible from a second device", async ({ page, browser }) => {
  const email = uniqueEmail("persist");
  await signInOnboarded(page, email);
  await addBill(page, { name: "Hydro", amount: "112.48", due: torontoToday(5), category: "utilities" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hydro" })).toBeVisible();
  await page.goto("/bills");
  await expect(page.getByTestId("bills-list-row").filter({ hasText: "Hydro" })).toContainText("$112.48");

  // Second device: a fresh browser context with no shared storage.
  const other = await newDevice(browser, page);
  await signIn(other, email);
  await other.goto("/bills");
  await expect(other.getByTestId("bills-list-row").filter({ hasText: "Hydro" })).toContainText("$112.48");
  await other.context().close();
});

test("mark paid updates dashboard and history; undo restores it", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("pay"));
  await addBill(page, { name: "Phone", amount: "79.99", due: torontoToday(0), category: "phone_internet" });
  await page.goto("/");
  const row = page.getByTestId("bill-row").filter({ hasText: "Phone" });
  await expect(row).toContainText("Due today");
  await row.getByRole("button", { name: "Mark Phone paid" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await expect(page.getByText("Handled.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Paid this month/ })).toContainText("$79.99");

  await page.goto("/history");
  await expect(page.getByTestId("payment-row").filter({ hasText: "Phone" })).toContainText("$79.99");

  // Correct an accidental "paid" from history.
  await page.getByRole("button", { name: "Actions for Phone payment" }).click();
  await page.getByRole("button", { name: /I didn't actually pay this/ }).click();
  await expect(page.getByText("No payments yet")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("bill-row").filter({ hasText: "Phone" })).toContainText("Due today");
});

test("undo from the toast right after marking paid", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("undo"));
  await addBill(page, { name: "Gym", amount: "45", due: torontoToday(1) });
  await page.goto("/");
  await page.getByRole("button", { name: "Mark Gym paid" }).click();
  await page.getByRole("button", { name: "Confirm payment" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Payment undone")).toBeVisible();
  const [row] = await db`select count(*)::int as n from payments p join bills b on b.id = p.bill_id where b.name = 'Gym' and p.voided_at is null`;
  expect(row.n).toBe(0);
});

test("overdue stays overdue and the original due date is kept after 'can't pay yet'", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("cantpay"));
  await addBill(page, { name: "Water", amount: "60", due: torontoToday(-10) });
  await page.goto("/");
  const row = page.getByTestId("bill-row").filter({ hasText: "Water" }).filter({ hasText: "Was due" });
  await expect(row).toContainText("Overdue");
  await row.getByRole("button", { name: "More actions for Water" }).click();
  await page.getByRole("button", { name: /Can't pay yet/ }).click();
  await page.locator("dialog[open]").getByLabel("Planned payment date").fill(torontoToday(4));
  await page.locator("dialog[open]").getByRole("button", { name: "Save plan" }).click();
  await expect(page.getByText("Plan saved")).toBeVisible();
  await expect(row).toContainText("Overdue");
  await expect(row).toContainText("Plan: pay");
});

test("validation errors are shown and nothing is saved", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("valid"));
  await page.goto("/bills/new");
  await page.fill("#name", "Bad");
  await page.fill("#amount", "12.345");
  await page.fill("#payment_url", "javascript:alert(1)");
  await page.getByRole("button", { name: "Add bill" }).click();
  await expect(page.getByText("Enter an amount like 79.99")).toBeVisible();
  await expect(page).toHaveURL(/\/bills\/new/);
});

test("one user cannot open another user's bill", async ({ page, browser }) => {
  await signInOnboarded(page, uniqueEmail("owner"));
  await addBill(page, { name: "Private bill", amount: "10", due: torontoToday(2) });
  const url = page.url().split("?")[0];
  const intruder = await newDevice(browser, page);
  await signInOnboarded(intruder, uniqueEmail("intruder"), "Mallory");
  // The page streams behind a loading screen, so the HTTP status is already sent; check what renders.
  await intruder.goto(url);
  await expect(intruder.getByText("This page could not be found.")).toBeVisible();
  await expect(intruder.getByText("Private bill")).toHaveCount(0);
  await intruder.goto("/bills");
  await expect(intruder.getByText("Private bill")).toHaveCount(0);
  await intruder.context().close();
});

test("calendar shows bills on their dates, including future recurring cycles", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("cal"));
  await addBill(page, { name: "Rent", amount: "1450", due: torontoToday(2), recurrence: "monthly" });
  await page.goto("/calendar");
  await expect(page.getByRole("link", { name: /1 bill/ }).first()).toBeVisible();
  // Three months ahead: still scheduled even though not stored yet.
  for (let i = 0; i < 3; i++) await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("link", { name: /Rent/ }).first()).toBeVisible();
  await expect(page.getByText("Scheduled").first()).toBeVisible();
});

test("sign out and back in keeps data", async ({ page }) => {
  const email = uniqueEmail("signout");
  await signInOnboarded(page, email);
  await addBill(page, { name: "Insurance", amount: "164.20", due: torontoToday(9), category: "insurance" });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).last().click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/bills");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, email);
  await page.goto("/bills");
  await expect(page.getByTestId("bills-list-row").filter({ hasText: "Insurance" })).toContainText("$164.20");
});

test("demo mode is clearly labelled and separate from real data", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("note")).toContainText("made-up sample bills");
  await expect(page.getByText("Rent (sample)")).toBeVisible();
});

test("mobile layouts have no horizontal overflow", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("overflow"));
  await addBill(page, { name: "A very long bill name for overflow testing purposes", amount: "123456.78", due: torontoToday(1) });
  for (const path of ["/", "/bills", "/bills/new", "/calendar", "/history", "/settings", "/demo"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
});
