import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { configurationError } from "@/lib/errors";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

type GlobalWithDb = typeof globalThis & { __evoltPool?: Pool; __evoltDb?: Database };
const g = globalThis as GlobalWithDb;

export function createDatabase(connectionString: string, max = 5): { db: Database; pool: Pool } {
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Lazily creates one pool per server instance (reused across hot reloads in dev).
 * Throws a configuration error — never falls back to fake data — when unset.
 */
export function getDb(): Database {
  if (g.__evoltDb) return g.__evoltDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw configurationError(
      "DATABASE_URL is not set. Add a PostgreSQL connection string to .env.local (local) or the Vercel project settings, then run `npm run db:migrate`.",
    );
  }
  const { db, pool } = createDatabase(url);
  g.__evoltPool = pool;
  g.__evoltDb = db;
  return db;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
