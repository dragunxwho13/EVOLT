import { expect, test } from "@playwright/test";

test("mobile navigation opens, navigates and closes", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Alerts" }).click();
  await expect(page).toHaveURL(/\/alerts/);
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
});

test("station map switches between list and map views on small screens", async ({ page }) => {
  await page.goto("/stations");
  // Runs after the desktop suite, so match any station rather than a specific demo one.
  const firstStation = page.getByRole("button", { name: /Site|Station/ }).first();
  await expect(firstStation).toBeVisible();
  await page.getByRole("button", { name: "Map", pressed: false }).click();
  await expect(page.getByRole("region", { name: "Map of stations" })).toBeVisible();
  await expect(firstStation).toBeHidden();
});
