import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { beforeAll, vi } from "vitest";

loadEnvConfig(process.cwd());

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("TEST_DATABASE_URL is not set. Integration tests need a disposable PostgreSQL database (see README).");
}
if (url === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: the integration suite truncates every table.");
}
// Route handlers and services use DATABASE_URL; point them at the disposable database.
process.env.DATABASE_URL = url;
process.env.EVOLT_ADMIN_TOKEN = "integration-test-admin-token-000";
// The suite exercises token protection; open mode is tested explicitly where needed.
process.env.EVOLT_EDIT_MODE = "token";

// Outside the Next.js runtime there is no request scope, so connection() is a no-op here.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => undefined };
});

beforeAll(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./database/migrations" });
    await drizzle(pool).execute(
      sql`truncate table model_runs, charging_sessions, alert_events, alerts, sensor_readings, health_observations, chargers, stations, dataset_imports, vehicle_profiles restart identity cascade`,
    );
  } finally {
    await pool.end();
  }
});
