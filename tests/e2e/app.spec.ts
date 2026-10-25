import path from "node:path";
import { expect, test } from "@playwright/test";

// Tests run in order against one disposable database seeded with the demo stations.

test.describe("entry and role switching", () => {
  test("the entry page offers a driver and a company experience", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /EV charging intelligence/ })).toBeVisible();
    await page.getByRole("link", { name: /I’m a driver/ }).click();
    await expect(page).toHaveURL(/\/driver$/);
    await expect(page.getByRole("heading", { name: "Find a charger" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Company workspace" })).toHaveCount(0);
    await page.getByRole("link", { name: "Company workspace" }).click();
    await expect(page).toHaveURL(/\/company$/);
    await expect(page.getByRole("heading", { name: "Company overview" })).toBeVisible();
    await page.getByRole("link", { name: "Switch to driver view" }).click();
    await expect(page).toHaveURL(/\/driver$/);
  });

  test("old addresses redirect to the new experiences", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/company$/);
    await page.goto("/stations");
    await expect(page).toHaveURL(/\/driver$/);
  });
});

test.describe("driver workflow", () => {
  test("finds, filters, explains and compares chargers from a starting city", async ({ page }) => {
    await page.goto("/driver");
    await expect(page.getByText("Start by sharing a location.")).toBeVisible();
    await page.getByLabel("Or start from a city in the data").selectOption("Chennai");
    await expect(page.getByRole("heading", { name: /\d+ chargers? found/ })).toBeVisible();
    const first = page.locator("ol > li").first();
    await expect(first.getByText(/^Top match: it /)).toBeVisible();
    await expect(first.getByText("Demo", { exact: true })).toBeVisible();
    await expect(page.getByText(/No connector selected, so compatibility/)).toBeVisible();

    // Hard constraint: connector.
    await page.getByLabel("Your connector").selectOption("CHAdeMO");
    await expect(page.getByRole("heading", { name: /\d+ chargers? found/ })).toBeVisible();
    for (const connector of await page.locator("ol > li dl dd").filter({ hasText: /CCS|Type 2|CHAdeMO|GB\/T/ }).allInnerTexts()) {
      expect(connector).toBe("CHAdeMO");
    }
    await expect(page.locator("ol > li").first().getByText(/matches your CHAdeMO connector/)).toBeVisible();
    await expect(page).toHaveURL(/connector=CHAdeMO/);

    // The ranking rules distinguish requirements from preferences.
    await page.getByText("How chargers are chosen and ordered").click();
    await expect(page.getByText("Must meet (hard requirements)")).toBeVisible();
    await expect(page.getByText(/Price and opening hours are not used/)).toBeVisible();

    // Compare two results.
    await page.getByLabel("Your connector").selectOption("");
    await expect(page.locator("ol > li").nth(1)).toBeVisible();
    await page.locator("ol > li").nth(0).getByRole("checkbox").check();
    await page.locator("ol > li").nth(1).getByRole("checkbox").check();
    await page.getByRole("link", { name: "Compare 2 chargers" }).click();
    await expect(page.getByRole("heading", { name: "Compare chargers" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Distance" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Health evidence" })).toBeVisible();
    await expect(page.getByText(/Price and opening hours are not compared/)).toBeVisible();
  });

  test("uses the browser location when permission is granted", async ({ browser }) => {
    const context = await browser.newContext({ geolocation: { latitude: 12.97, longitude: 79.15 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    await page.goto("/driver");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText(/Searching from Your location/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /\d+ chargers? found/ })).toBeVisible();
    await expect(page.locator("ol > li").first()).toContainText(/Katpadi|Vellore/);
    await context.close();
  });

  test("explains a denied location and validates typed coordinates", async ({ browser }) => {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await page.goto("/driver");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /permission was denied|could not be determined/ })).toBeVisible();
    await page.getByRole("button", { name: "Enter coordinates" }).click();
    await page.getByLabel("Latitude").fill("200");
    await page.getByLabel("Longitude").fill("80");
    await page.getByRole("button", { name: "Use these coordinates" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Latitude must be between/ })).toBeVisible();
    // Far from every station: an honest empty result with a way forward.
    await page.getByLabel("Latitude").fill("28.6139");
    await page.getByLabel("Longitude").fill("77.2090");
    await page.getByRole("button", { name: "Use these coordinates" }).click();
    await expect(page.getByText(/No charger matches within 25 km/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Search within 50 km" })).toBeVisible();
    await context.close();
  });

  test("a station page shows chargers, availability wording and no fake directions", async ({ page }) => {
    await page.goto("/driver?lat=13.0067&lng=80.2206&from=Guindy");
    await page.locator("ol > li").first().getByRole("link", { name: "Station details" }).click();
    await expect(page.getByRole("heading", { name: /Chargers here/ })).toBeVisible();
    await expect(page.getByText(/This is a demo station/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy coordinates" })).toBeVisible();
    await expect(page.getByText(/does not provide maps or directions/)).toBeVisible();
  });
});

test.describe("company workflow", () => {
  test("the overview leads with prioritised, evidence-backed action items", async ({ page }) => {
    await page.goto("/company");
    await expect(page.getByRole("heading", { name: "Needs attention first" })).toBeVisible();
    await expect(page.getByText("High priority").first()).toBeVisible();
    await expect(page.getByText("Why it matters:").first()).toBeVisible();
    await expect(page.getByText("Next step:").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Connector health · 26 chargers at 12 stations/ })).toBeVisible();
  });

  test("an action item can be acknowledged from the action list and the decision persists", async ({ page }) => {
    await page.goto("/company/actions?priority=high");
    const item = page.locator("ol > li").first();
    await item.getByText("Evidence & status ▾").click();
    await expect(item.getByText("What is happening")).toBeVisible();
    await expect(item.getByText("Rule that triggered it")).toBeVisible();
    await item.getByLabel(/Note/).fill("Inspection booked");
    await item.getByRole("button", { name: "Acknowledge" }).click();
    await expect(item.getByRole("status")).toContainText("Acknowledged.");
    await page.reload();
    await expect(page.locator("ol > li").first().getByText("Acknowledged", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/does not verify that a charger was repaired/)).toBeVisible();
  });

  test("charger evidence explains the assessment", async ({ page }) => {
    await page.goto("/company/chargers?health=inspection_recommended");
    await page.getByRole("link", { name: "DEMO-01-C2" }).click();
    await expect(page.getByRole("heading", { name: "Health assessment" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Contact resistance over time/ })).toBeVisible();
    await expect(page.getByText("Demo / sample data").first()).toBeVisible();
    await page.getByRole("link", { name: "Where drivers can go instead" }).click();
    await expect(page).toHaveURL(/\/driver\?fromCharger=/);
    await expect(page.getByText(/Alternatives to DEMO-01-C2/)).toBeVisible();
  });

  test("health alerts expand to show their triggering evidence", async ({ page }) => {
    await page.goto("/company/alerts");
    await page.getByRole("button", { expanded: false }).filter({ hasText: /in contact resistance|in connector/ }).first().click();
    await expect(page.getByText("Confidence:").first()).toBeVisible();
  });

  test("unknown records show the not-found page", async ({ page, request }) => {
    await page.goto("/company/chargers/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Nothing here")).toBeVisible();
    expect((await request.get("/api/chargers/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  });
});

test.describe("data import, analytics and model", () => {
  test("rejects an unsupported file type before upload", async ({ page }) => {
    await page.goto("/company/data");
    await page.waitForLoadState("networkidle");
    await page.locator("#import-file").setInputFiles({ name: "data.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Choose a .csv or .json file.");
  });

  test("auto-detects and imports a registry, then readings with rejected rows, then blocks a duplicate file", async ({ page }) => {
    await page.goto("/company/data");
    await page.waitForLoadState("networkidle");
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/registry-example.csv"));
    await expect(page.getByRole("heading", { name: "Detected: Stations and chargers" })).toBeVisible();
    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
    await page.getByRole("button", { name: "Import another file" }).click();
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/observations-example.csv"));
    await expect(page.getByRole("heading", { name: "Detected: Health readings" })).toBeVisible();
    await expect(page.getByText(/Unknown charger "EX-99-Z"/)).toBeVisible();
    await page.getByRole("button", { name: "Import 42 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
    await page.getByRole("button", { name: "Import another file" }).click();
    await page.locator("#import-file").setInputFiles(path.resolve("public/samples/observations-example.csv"));
    await expect(page.getByText(/already imported/)).toBeVisible();
  });

  test("imports the session dataset, then performance, action items and the model use it", async ({ page }) => {
    await page.goto("/company/data");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /EV grid sessions/ }).click();
    await expect(page.getByRole("heading", { name: "Detected: Charging sessions" })).toBeVisible();
    await expect(page.getByText(/more power lost than consumed/)).toBeVisible();
    await page.getByLabel("Where the data comes from").selectOption("simulated");
    await page.getByRole("button", { name: "Import 1,000 rows" }).click();
    await expect(page.getByText("Import complete")).toBeVisible({ timeout: 30_000 });

    await page.goto("/company/performance");
    await expect(page.getByRole("heading", { name: "Station performance" })).toBeVisible();
    await expect(page.getByText(/None is clearly above the fleet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", /format=csv/);
    await page.getByLabel("Charging type").selectOption("Fast");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText(/352 sessions \(filtered\)/)).toBeVisible();

    await page.goto("/company/actions?category=data_quality");
    const battery = page.locator("li", { hasText: "deliver more energy than the vehicle's battery can hold" }).first();
    await battery.getByText("Evidence & status ▾").click();
    await expect(battery.getByText(/302 of 1000 sessions exceed/)).toBeVisible();
    await battery.getByRole("button", { name: "Mark reviewed" }).click();
    await page.waitForLoadState("networkidle");
    await page.reload();
    await expect(page.locator("li", { hasText: "deliver more energy than the vehicle's battery can hold" }).first().getByText("Reviewed", { exact: true }).first()).toBeVisible();

    await page.goto("/company/model");
    await expect(page.getByRole("heading", { name: /^Yes — 9\d\.\d% correct on unseen sessions/ })).toBeVisible();
    await expect(page.getByText(/anticipated without measuring power loss/)).toBeVisible();
    await page.getByLabel("Power loss").fill("4.2");
    await page.getByRole("button", { name: "Classify" }).click();
    await expect(page.getByText("Predicted category")).toBeVisible();
    await expect(page.locator("#classify").getByText("High", { exact: true })).toBeVisible();
    await expect(page.getByText(/A prediction, not a measurement/)).toBeVisible();
  });

  test("no page labels data as synthetic or simulated", async ({ page }) => {
    for (const url of ["/", "/driver?lat=13.08&lng=80.27", "/company", "/company/actions", "/company/performance", "/company/chargers", "/company/model", "/company/method", "/company/data", "/company/settings"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      expect(await page.locator("body").innerText(), url).not.toMatch(/synthetic|simulated/i);
    }
  });

  test("demo data can be removed, leaving imported data", async ({ page }) => {
    await page.goto("/company/data");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await page.getByRole("button", { name: /Yes, remove 12 demo stations/ }).click();
    await expect(page.getByText(/Removed 12 demo stations/)).toBeVisible();
    await page.goto("/company");
    await expect(page.getByText(/demo stations, labelled/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Connector health · \d+ chargers/ })).toBeVisible();
  });
});

test.describe("regressions", () => {
  test("moving between company pages never crashes", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/company");
    for (const link of ["Data import", "Overview", "Performance", "Overview", "Settings", "Overview"]) {
      await page.getByRole("link", { name: link, exact: true }).first().click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("This page could not be displayed")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test("editing is open locally: settings explains it and no token is asked for", async ({ page }) => {
    await page.goto("/company/settings");
    await expect(page.getByText("Editing is open — no token needed.")).toBeVisible();
    await expect(page.getByLabel("Admin token")).toHaveCount(0);
  });
});
