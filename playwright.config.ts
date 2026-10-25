import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

const PORT = Number(process.env.E2E_PORT ?? 3200);
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
if (!E2E_DATABASE_URL) {
  throw new Error("E2E_DATABASE_URL is not set. End-to-end tests need a disposable database (see README).");
}

/**
 * End-to-end tests run against a production build (`npm run build` first) backed by
 * a disposable database that global-setup wipes, migrates and seeds with demo data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // The web server starts before global-setup migrates the database, so wait on a static page.
    url: `http://localhost:${PORT}/icon.svg`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      EVOLT_EDIT_MODE: "open",
    },
  },
});
