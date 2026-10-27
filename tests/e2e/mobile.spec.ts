import { expect, test } from "@playwright/test";
import { ensureDemoStations } from "./demo-data";

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

test("booking a slot works on a phone without horizontal scrolling", async ({ page, request }) => {
  ensureDemoStations();
  const res = await request.get("/api/stations?limit=100");
  const station = ((await res.json()).data.items as { id: string; code: string }[]).find((s) => s.code === "DEMO-11")!;
  await page.goto(`/driver/stations/${station.id}`);
  await page.getByRole("link", { name: "Book a slot" }).first().click();
  await page.getByRole("radio", { name: /Pick a time/ }).click();
  await expect(page.getByRole("group", { name: "Free start times" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByLabel("Name for the booking").fill("Mobile driver");
  await page.getByRole("radio", { name: /Join the queue/ }).click();
  await page.getByRole("button", { name: "Join the queue" }).click();
  await expect(page.getByTestId("booking-code")).toBeVisible();
});
