import { expect, test } from "@playwright/test";
import { signInOnboarded, uniqueEmail } from "./helpers";

test("set a password in Settings, then sign in with it", async ({ page }) => {
  const email = uniqueEmail("pw");
  await signInOnboarded(page, email);

  await page.goto("/settings");
  await page.fill("#new-password", "short");
  await page.fill("#confirm-password", "short");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 8" })).toBeVisible();

  await page.fill("#new-password", "billy-pass-123");
  await page.fill("#confirm-password", "billy-pass-124");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();

  await page.fill("#confirm-password", "billy-pass-123");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).last().click();
  await page.waitForURL(/\/sign-in/);

  await page.getByRole("button", { name: "Sign in with a password instead" }).click();
  await page.fill("#email", email);
  await page.fill("#password", "wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match")).toBeVisible();

  await page.fill("#password", "billy-pass-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => u.pathname === "/");
});

test("an account without a password can't sign in with one", async ({ page }) => {
  const email = uniqueEmail("nopw");
  await signInOnboarded(page, email);
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a password instead" }).click();
  await page.fill("#email", email);
  await page.fill("#password", "anything-at-all");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email and password don't match")).toBeVisible();
});
