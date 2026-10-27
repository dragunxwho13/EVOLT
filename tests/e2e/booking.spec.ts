import { expect, test, type APIRequestContext } from "@playwright/test";
import { ensureDemoStations } from "./demo-data";

// The e2e server runs in open edit mode, but bookings never use the admin session:
// the integration suite checks they also work in token mode without one.

async function stationId(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.get("/api/stations?limit=100");
  const items = (await res.json()).data.items as { id: string; code: string }[];
  return items.find((s) => s.code === code)!.id;
}

test.describe("driver slot and queue booking", () => {
  test.beforeAll(() => ensureDemoStations());

  test("books a chosen slot, shows it in My bookings, and cancels it", async ({ page, request }) => {
    const id = await stationId(request, "DEMO-02");
    await page.goto(`/driver/stations/${id}`);
    await page.getByRole("link", { name: "Book a slot" }).first().click();
    await expect(page).toHaveURL(/\/driver\/book\//);
    await expect(page.getByRole("heading", { name: /^Book DEMO-02-C/ })).toBeVisible();

    // Estimate the length from the battery, then go back to a fixed length.
    await page.getByRole("radio", { name: "Estimate from my battery" }).click();
    await page.getByLabel("Battery size (kWh)").fill("40");
    await expect(page.getByTestId("charge-estimate")).toContainText(/About \d+ min to add 24 kWh/);
    await page.getByRole("radio", { name: "I know how long" }).click();
    await page.getByLabel("Charging time").selectOption("45");

    // Tomorrow 10:00 IST.
    await page.getByRole("radio", { name: /Pick a time/ }).click();
    await page.getByRole("tab").nth(1).click();
    await page.getByRole("button", { name: "10:00", exact: true }).click();
    await expect(page.getByText(/10:00–10:45 IST/).first()).toBeVisible();
    await page.getByLabel("Name for the booking").fill("E2E driver");
    await page.getByRole("button", { name: "Book this slot" }).click();

    const code = (await page.getByTestId("booking-code").textContent())!.trim();
    expect(code).toMatch(/^EV-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    await expect(page.getByText("It is also saved in this browser.", { exact: false })).toBeVisible();

    // The same start is no longer offered, and neither is one inside the 10-minute gap.
    // The confirmation replaces the form on the same address; reload to book again.
    await page.reload();
    await page.getByLabel("Charging time").selectOption("45");
    await page.getByRole("radio", { name: /Pick a time/ }).click();
    await page.getByRole("tab").nth(1).click();
    await expect(page.getByRole("button", { name: "10:00", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "10:45", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "11:00", exact: true })).toBeVisible();

    await page.getByRole("navigation", { name: "Driver" }).getByRole("link", { name: "My bookings" }).click();
    const card = page.locator("section", { hasText: code });
    await expect(card.getByText("Upcoming")).toBeVisible();
    await card.getByRole("button", { name: "Cancel booking" }).click();
    await expect(card.getByText("Cancelled")).toBeVisible();
    await expect(card.getByText("Nothing left to cancel.")).toBeVisible();
  });

  test("joins the queue behind an existing booking", async ({ page, request }) => {
    const id = await stationId(request, "DEMO-07");
    await page.goto(`/driver/stations/${id}`);
    const book = page.getByRole("link", { name: "Book a slot" }).first();
    const href = (await book.getAttribute("href"))!;

    await page.goto(href);
    await page.getByLabel("Name for the booking").fill("First in line");
    await page.getByRole("button", { name: "Join the queue" }).click();
    await expect(page.getByText("No one is booked ahead of you.")).toBeVisible();

    await page.goto(href);
    await expect(page.getByText(/1 booked session ahead/)).toBeVisible();
    await page.getByLabel("Name for the booking").fill("Second in line");
    await page.getByRole("button", { name: "Join the queue" }).click();
    await expect(page.getByText("1 booked session is ahead of you.")).toBeVisible();
  });

  test("finds a booking by its code on another device", async ({ page, browser, request }) => {
    const id = await stationId(request, "DEMO-08");
    await page.goto(`/driver/stations/${id}`);
    await page.getByRole("link", { name: "Book a slot" }).first().click();
    await page.getByLabel("Name for the booking").fill("Phone user");
    await page.getByRole("button", { name: "Join the queue" }).click();
    const code = (await page.getByTestId("booking-code").textContent())!.trim();

    const other = await browser.newPage();
    await other.goto("/driver/bookings");
    await expect(other.getByText("No bookings saved in this browser")).toBeVisible();
    await other.getByLabel("Booking code").fill(code.toLowerCase().replace(/-/g, " "));
    await other.getByRole("button", { name: "Look up" }).click();
    await expect(other.locator("section", { hasText: code }).getByText("Upcoming")).toBeVisible();
    await other.getByLabel("Booking code").fill("EV-22222-22222");
    await other.getByRole("button", { name: "Look up" }).click();
    await expect(other.getByText("No booking has this code.")).toBeVisible();
    await other.close();
  });

  test("plans and books several vehicles across a station's chargers", async ({ page, request }) => {
    const id = await stationId(request, "DEMO-01");
    await page.goto(`/driver/stations/${id}`);
    await page.getByRole("link", { name: "Book several vehicles" }).click();
    await expect(page.getByRole("heading", { name: "Book several vehicles" })).toBeVisible();
    await page.getByRole("button", { name: "Add vehicle" }).click();
    await page.getByLabel("Name for the booking").fill("Depot");
    await page.getByRole("button", { name: "Plan the schedule" }).click();

    const table = page.getByRole("table", { name: "Proposed schedule" });
    await expect(table.getByRole("row")).toHaveCount(4); // header + 3 vehicles
    // The charger with an inspection recommended is left out, and says why.
    await expect(page.getByText(/Not used: .*DEMO-01-C2/)).toBeVisible();
    await page.getByRole("button", { name: "Book all 3 vehicles" }).click();
    await expect(page.getByTestId("booking-code")).toBeVisible();
    await expect(page.getByRole("status").getByRole("listitem")).toHaveCount(3);
  });

  test("an offline or inspection-flagged charger does not offer booking", async ({ page, request }) => {
    const id = await stationId(request, "DEMO-01");
    await page.goto(`/driver/stations/${id}`);
    await expect(page.getByText("Not taking bookings")).toBeVisible();
  });
});
