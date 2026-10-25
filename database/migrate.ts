/**
 * Applies version-controlled SQL migrations from database/migrations.
 * Non-destructive: migrations only move forward and are tracked in
 * drizzle.__drizzle_migrations, so running it repeatedly is safe.
 *
 *   npm run db:migrate
 */
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

async function main() {
  const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./database/migrations" });
    console.info("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // Drizzle wraps database errors; the underlying cause holds the useful message.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
  const message = cause?.message ?? (err instanceof Error ? err.message : String(err));
  console.error("Migration failed:", message.length > 600 ? `${message.slice(0, 600)}…` : message);
  process.exit(1);
});
