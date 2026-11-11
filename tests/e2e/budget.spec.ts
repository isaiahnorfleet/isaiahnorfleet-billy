import { expect, test } from "@playwright/test";
import { addBill, expectNoHorizontalOverflow, signInOnboarded, torontoToday, uniqueEmail } from "./helpers";

test("budget: income minus bills minus spending gives left to spend, and Billy reacts", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("budget"));
  const today = torontoToday(0);
  // A one-time bill dated today always lands in the current month.
  await addBill(page, { name: "Rent", amount: "1000", due: today, recurrence: "once" });

  await page.goto("/budget");
  await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Income: one-time so the month's total is exact whatever today's date is.
  await page.getByRole("button", { name: "Income", exact: true }).click();
  const income = page.getByRole("dialog", { name: "Add income" });
  await income.getByLabel("Name").fill("Paycheque");
  await income.getByLabel("Amount each time (after tax)").fill("3000");
  await income.getByLabel("How often").selectOption("once");
  await income.getByLabel("Date").fill(today);
  await income.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByTestId("left-to-spend")).toHaveText("$2,000.00");

  // Starter categories, then give Groceries a limit.
  await page.getByRole("button", { name: "Use starter categories" }).click();
  await page.getByTestId("budget-category").filter({ hasText: "Groceries" }).getByRole("button").click();
  const cat = page.getByRole("dialog", { name: "Edit Groceries" });
  await cat.getByLabel("Monthly limit").fill("100");
  await cat.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("budget-category").filter({ hasText: "Groceries" })).toContainText("$100.00 left");

  // Log spending over the Groceries limit.
  await page.getByRole("button", { name: "Log spending" }).click();
  const log = page.getByRole("dialog", { name: "Log spending" });
  await log.getByLabel("Amount").fill("150");
  await log.getByRole("button", { name: "Groceries" }).click();
  await log.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByTestId("left-to-spend")).toHaveText("$1,850.00");
  await expect(page.getByTestId("budget-category").filter({ hasText: "Groceries" })).toContainText("$50.00 over");
  await expect(page.getByTestId("billy-message")).toContainText("Groceries");

  // Edit, then remove the entry.
  await page.getByTestId("expense-row").click();
  const edit = page.getByRole("dialog", { name: "Edit spending" });
  await edit.getByRole("button", { name: "Remove this entry" }).click();
  await edit.getByRole("button", { name: "Yes, remove" }).click();
  await expect(page.getByTestId("left-to-spend")).toHaveText("$2,000.00");

  // Persists across reload.
  await page.reload();
  await expect(page.getByTestId("left-to-spend")).toHaveText("$2,000.00");
});

test("budget plan: goals come out first, Billy sets limits, and goals show a projection", async ({ page }) => {
  await signInOnboarded(page, uniqueEmail("plan"));
  const today = torontoToday(0);
  await page.goto("/budget");
  await page.getByRole("button", { name: "Income", exact: true }).click();
  const income = page.getByRole("dialog", { name: "Add income" });
  await income.getByLabel("Name").fill("Bonus");
  await income.getByLabel("Amount each time (after tax)").fill("3000");
  await income.getByLabel("How often").selectOption("once");
  await income.getByLabel("Date").fill(today);
  await income.getByRole("button", { name: "Add income" }).click();
  await expect(page.getByTestId("spending-money")).toHaveText("$3,000.00");

  // Savings: 10% of income, with a target.
  await page.getByRole("button", { name: "Savings", exact: true }).click();
  const goal = page.getByRole("dialog", { name: "Add savings" });
  await goal.getByLabel("Percent of income").fill("10");
  await goal.getByRole("button", { name: "Add a target and see when you'll reach it" }).click();
  await goal.getByLabel("Target").fill("1000");
  await goal.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByTestId("spending-money")).toHaveText("$2,700.00");
  await expect(page.getByTestId("left-to-spend")).toHaveText("$2,700.00");
  const proj = page.getByTestId("goal-projection").filter({ hasText: "Savings" });
  await expect(proj).toContainText("you'll reach $1,000.00 by");
  await expect(proj.getByRole("img")).toBeVisible();

  // Let Billy set limits across the starter categories.
  await page.getByRole("button", { name: "Use starter categories" }).click();
  await expect(page.getByTestId("budget-category")).toHaveCount(6);
  await page.getByText("Let Billy set my category limits").click();
  await expect(page.getByText("Billy split $2,700.00 of your spending money across your categories.")).toBeVisible();
  await expect(page.getByTestId("budget-category").filter({ hasText: "Groceries" })).toContainText("left");
  await expectNoHorizontalOverflow(page);
});
