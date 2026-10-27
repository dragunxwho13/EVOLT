import { execFileSync } from "node:child_process";

/**
 * Reloads the labelled demo stations. The company workflow ends by removing demo data, so
 * specs that run after it and need the demo stations call this first. The seed only creates
 * missing demo records, so running it again is safe.
 */
export function ensureDemoStations() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set.");
  execFileSync("npx", ["tsx", "--conditions=react-server", "database/seed/seed.ts"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
}
