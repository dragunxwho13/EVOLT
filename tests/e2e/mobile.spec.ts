import { expect, test } from "@playwright/test";

test("company navigation opens, navigates and closes on a phone", async ({ page }) => {
  await page.goto("/company");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Health alerts" }).click();
  await expect(page).toHaveURL(/\/company\/alerts/);
  await expect(page.getByRole("heading", { name: "Health alerts", exact: true })).toBeVisible();
});

test("the driver finder works on a phone without horizontal scrolling", async ({ page }) => {
  await page.goto("/driver");
  await page.getByLabel("Or start from a city in the data").selectOption({ index: 1 });
  await expect(page.getByRole("heading", { name: /\d+ chargers? found|No charger matches/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
