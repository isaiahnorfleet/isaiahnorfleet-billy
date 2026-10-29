import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { addBill, db, signInOnboarded, torontoToday, uniqueEmail } from "./helpers";

// @axe-core/playwright bundles its own playwright-core types; the runtime objects are identical.
const axe = (page: Page) => new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa"]);

test.afterAll(async () => {
  await db.end();
});

test("main screens have no serious accessibility violations", async ({ page }) => {
  await page.goto("/sign-in");
  let results = await axe(page).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await signInOnboarded(page, uniqueEmail("a11y"));
  await addBill(page, { name: "Rent", amount: "1450", due: torontoToday(-2) });
  for (const path of ["/", "/bills", "/bills/new", "/calendar", "/history", "/settings"]) {
    await page.goto(path);
    results = await axe(page).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
});

test("keyboard: skip link, visible focus, and dialogs operable without a mouse", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow checked on desktop");
  await signInOnboarded(page, uniqueEmail("kbd"));
  await addBill(page, { name: "Phone", amount: "79.99", due: torontoToday(1) });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Skip to content")).toBeFocused();
  await page.keyboard.press("Enter");
  const markPaid = page.getByRole("button", { name: "Mark Phone paid" });
  await markPaid.focus();
  const outline = await markPaid.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("reduced motion disables Billy's animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo");
  const duration = await page.locator(".billy .billy-body").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
