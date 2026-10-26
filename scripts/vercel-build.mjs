/**
 * Build command for Vercel (`node scripts/vercel-build.mjs`).
 *
 * When a database is connected, it is brought up to date before the app is built:
 * forward-only migrations, the labelled demo stations, the Arduino bench log and the supplied
 * session dataset (with model training). Every step is idempotent, so redeploys are safe and
 * never duplicate or overwrite records. Without a database the build still succeeds and the
 * app explains that DATABASE_URL is missing.
 *
 * Migrations and seeds use the direct (unpooled) connection when the provider offers one
 * (Neon sets DATABASE_URL_UNPOOLED); the running app uses DATABASE_URL.
 */
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const run = (label, cmd, env = {}) => {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
};

if (url) {
  const env = { DATABASE_URL: url };
  run("Applying database migrations", "npx tsx database/migrate.ts", env);
  run("Loading demo stations (idempotent)", "npx tsx --conditions=react-server database/seed/seed.ts", env);
  run("Loading the Arduino bench log and the session dataset (idempotent)", "npx tsx --conditions=react-server database/seed/dataset.ts", env);
} else {
  console.warn("\n⚠ DATABASE_URL is not set: skipping database setup. Connect a PostgreSQL database and redeploy.");
}
run("Building the app", "npx next build");
