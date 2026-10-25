import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("monitoring", () => {
  test("overview shows data-derived figures and labels synthetic data", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Connector health overview" })).toBeVisible();
    await expect(page.getByText("synthetic demonstration records")).toBeVisible();
    await expect(page.getByRole("heading", { name: /26 chargers across 12 stations/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  });

  test("station explorer searches, filters and shows empty results honestly", async ({ page }) => {
    await page.goto("/stations");
    await expect(page.getByText("12 stations")).toBeVisible();
    await expect(page.getByText(/no recorded coordinates/)).toBeVisible();
    await page.getByLabel("Search").fill("Katpadi");
    await expect(page.getByText("1 station", { exact: true })).toBeVisible();
    await page.getByLabel("Search").fill("");
    await page.getByLabel("Connector").selectOption("CHAdeMO");
    await expect(page).toHaveURL(/connector=CHAdeMO/);
    await expect(page.getByText(/^\d+ stations?$/)).toBeVisible();
    await page.getByLabel("Search").fill("zzz-no-such-station");
    await expect(page.getByText("No stations match these filters")).toBeVisible();
  });

  test("station selection opens a preview and the station page lists chargers", async ({ page }) => {
    await page.goto("/stations");
    await page.getByRole("button", { name: /Synthetic Site A/ }).click();
    await page.getByRole("link", { name: "View station and chargers" }).click();
    await expect(page.getByRole("heading", { name: /Synthetic Site A/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "SYN-01-C2" })).toBeVisible();
  });

  test("charger page explains its assessment with evidence", async ({ page }) => {
    await page.goto("/chargers?health=inspection_recommended");
    await page.getByRole("link", { name: "SYN-01-C2" }).click();
    await expect(page.getByRole("heading", { name: "Health assessment" })).toBeVisible();
    await expect(page.getByText(/Why “Inspection recommended”/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact resistance" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Contact resistance over time/ })).toBeVisible();
    await expect(page.getByText("simulated").first()).toBeVisible();
  });

  test("charger with too little history does not draw a trend", async ({ page }) => {
    await page.goto("/chargers?q=SYN-09-C2");
    await page.getByRole("link", { name: "SYN-09-C2" }).click();
    await expect(page.getByText(/Not enough history to draw a meaningful trend/)).toBeVisible();
    await expect(page.getByText("Insufficient data").first()).toBeVisible();
  });

  test("alerts expand to show their triggering evidence", async ({ page }) => {
    await page.goto("/alerts");
    const first = page.getByRole("button", { expanded: false }).filter({ hasText: /in contact resistance|in connector/ }).first();
    await first.click();
    await expect(page.getByRole("button", { expanded: true })).toBeVisible();
    await expect(page.getByText("Confidence:").first()).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Baseline median|Faults in/ }).first()).toBeVisible();
  });

  test("recommendations rank alternatives and state the rules", async ({ page }) => {
    await page.goto("/chargers?q=SYN-01-C2");
    await page.getByRole("link", { name: "SYN-01-C2" }).click();
    await page.getByRole("link", { name: "Find alternatives to this charger" }).click();
    await expect(page.getByText(/Same connector as the reference charger/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Synthetic Site/ }).first()).toBeVisible();
    await page.getByText("How results are ranked").click();
    await expect(page.getByText(/1st: health tier/)).toBeVisible();
    await expect(page.getByText(/do not guarantee/)).toBeVisible();
  });

  test("unknown records show the not-found page", async ({ page, request }) => {
    // The page streams, so its HTTP status is decided before the lookup; the API reports 404.
    await page.goto("/chargers/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Nothing here")).toBeVisible();
    const api = await request.get("/api/chargers/00000000-0000-4000-8000-000000000000");
    expect(api.status()).toBe(404);
  });
});

test.describe("regressions from user screenshots", () => {
  test("returning to the overview after visiting other pages does not crash the map", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dashboard");
    for (const link of ["Data import", "Overview", "Station map", "Overview", "Settings", "Overview"]) {
      await page.getByRole("link", { name: link, exact: true }).first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("This page could not be displayed")).toHaveCount(0);
    }
    expect(errors.filter((e) => /Map container|appendChild/.test(e))).toEqual([]);
  });

  test("editing is open: settings explains it and no token is asked for", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Editing is open — no token needed.")).toBeVisible();
    await expect(page.getByLabel("Admin token")).toHaveCount(0);
  });
});

test.describe("data import", () => {
  test("rejects an unsupported file type before upload", async ({ page }) => {
    await page.goto("/data");
    await page.waitForLoadState("networkidle"); // let the import form hydrate before choosing a file
    await page.locator("#import-file").setInputFiles({ name: "data.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Choose a .csv or .json file.");
  });

  test("auto-detects and imports a registry, then readings with rejected rows, then blocks a duplicate file", async ({ page }) => {
    await page.goto("/data");
    await page.waitForLoadState("networkidle");
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/registry-example.csv"));
    await expect(page.getByRole("heading", { name: "Detected: Stations and chargers" })).toBeVisible();
    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible();

    await page.getByRole("button", { name: "Import another file" }).click();
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/observations-example.csv"));
    await expect(page.getByRole("heading", { name: "Detected: Health readings" })).toBeVisible();
    await expect(page.getByText(/Row problems/)).toBeVisible();
    await expect(page.getByText(/Unknown charger "EX-99-Z"/)).toBeVisible();
    await page.getByRole("button", { name: "Import 42 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
    await expect(page.getByRole("cell", { name: "observations-example.csv" })).toBeVisible();

    await page.getByRole("button", { name: "Import another file" }).click();
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/observations-example.csv"));
    await expect(page.getByText(/already imported/)).toBeVisible();
  });

  test("imports the EV grid session dataset, trains models and shows honest results", async ({ page }) => {
    await page.goto("/data");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /EV grid sessions/ }).click();
    await expect(page.getByRole("heading", { name: "Detected: Charging sessions" })).toBeVisible();
    await expect(page.getByText(/more power lost than consumed/)).toBeVisible();
    await page.getByLabel("Where the data comes from").selectOption("simulated");
    await page.getByRole("button", { name: "Import 1,000 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Reduced power loss category:.*accuracy on unseen sessions/)).toBeVisible();
    await page.getByRole("link", { name: "See model results" }).click();
    await expect(page.getByRole("heading", { name: /Predictable — 9\d\.\d% correct on unseen sessions/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not predictable from this data" })).toBeVisible();
    await expect(page.getByText(/power loss ≤ 1\.88 → Low/)).toBeVisible();

    await page.goto("/chargers?q=ST-07-FAST");
    await page.getByRole("link", { name: "ST-07-FAST" }).click();
    await expect(page.getByText(/Historical · data to/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learned reduced power loss category" })).toBeVisible();
  });

  test("acknowledging an alert works without unlocking and persists", async ({ page }) => {
    await page.goto("/alerts?severity=inspection_recommended");
    await page.getByRole("button", { expanded: false }).filter({ hasText: /in contact resistance|in connector/ }).first().click();
    await page.getByRole("link", { name: "Open full alert and change status" }).first().click();
    await page.getByLabel(/Note/).fill("Scheduled inspection");
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByRole("status")).toContainText("Acknowledged.");
    await page.reload();
    await expect(page.getByText("open → acknowledged")).toBeVisible();
    await expect(page.getByText("Scheduled inspection")).toBeVisible();
  });

  test("demo data can be removed, leaving imported data", async ({ page }) => {
    await page.goto("/data");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await page.getByRole("button", { name: /Yes, remove 12 demo stations/ }).click();
    await expect(page.getByText(/Removed 12 demo stations/)).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByText("synthetic demonstration records")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /chargers across/ })).toBeVisible();
  });
});
