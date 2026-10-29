import { expect, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DB } from "../../playwright.config";

export const db = postgres(E2E_DB, { onnotice: () => {}, max: 2, idle_timeout: 2 });

export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.fill("#code", "123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  await page.waitForLoadState("networkidle");
}

/** Sign in and finish onboarding quickly (skipping the first bill). */
export async function signInOnboarded(page: Page, email: string, name = "Isaiah") {
  await signIn(page, email);
  if (page.url().includes("/onboarding")) {
    await page.getByRole("button", { name: "Let's go" }).click();
    await page.fill("#display_name", name);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Go to my dashboard" }).click();
    await page.waitForURL((u) => u.pathname === "/");
  }
}

export async function addBill(page: Page, bill: { name: string; amount: string; due: string; recurrence?: string; category?: string }) {
  await page.goto("/bills/new");
  await page.fill("#name", bill.name);
  await page.fill("#amount", bill.amount);
  if (bill.category) await page.selectOption("#category", bill.category);
  if (bill.recurrence) await page.selectOption("#recurrence", bill.recurrence);
  await page.fill("#due_date", bill.due);
  await page.getByRole("button", { name: "Add bill" }).click();
  await page.waitForURL(/\/bills\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByRole("heading", { name: bill.name })).toBeVisible();
}

export function torontoToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function newDevice(browser: Browser, page: Page) {
  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  return ctx.newPage();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}
