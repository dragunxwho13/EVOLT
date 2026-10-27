import { execFileSync } from "node:child_process";
import { Pool } from "pg";

/** Wipes the disposable e2e database, applies migrations and loads synthetic seed data. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set.");
  if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must differ from DATABASE_URL.");
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("npx", ["tsx", "database/migrate.ts"], { env, stdio: "inherit" });
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "truncate table bookings, bench_readings, insight_reviews, model_runs, charging_sessions, alert_events, alerts, sensor_readings, health_observations, chargers, stations, dataset_imports, vehicle_profiles restart identity cascade",
    );
  } finally {
    await pool.end();
  }
  execFileSync("npx", ["tsx", "--conditions=react-server", "database/seed/seed.ts"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "--conditions=react-server", "database/seed/bench.ts"], { env, stdio: "inherit" });
}
