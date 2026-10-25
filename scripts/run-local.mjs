#!/usr/bin/env node
/**
 * One-click local launcher for EVOLT (used by run-evolt.bat / run-evolt.sh).
 *
 * 1. Creates .env.local on first run if it is missing (editing is open; no token needed).
 * 2. Uses your own PostgreSQL if .env.local points at one; otherwise starts a private
 *    PostgreSQL 17 instance (npm package "embedded-postgres") stored in ./.evolt/postgres.
 * 3. Applies database migrations.
 * 4. Loads the clearly labelled demo stations the first time the database is empty, then the
 *    supplied charging-session dataset (imported once, through the normal import pipeline).
 * 5. Builds the app when the code has changed since the last build.
 * 6. Starts EVOLT and opens it in your browser. Press Ctrl+C to stop everything.
 *
 * Options:  --rebuild   force a fresh production build
 *           --no-seed   never load demo data
 *           --no-dataset  never load the supplied session dataset
 *           --no-open   do not open the browser
 *           --port N    preferred port (default 3000; the next free port is used if busy)
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const DATA_DIR = path.join(ROOT, ".evolt", "postgres");
const PG_PORT = 54329;
const PG_USER = "evolt";
const PG_DB = "evolt";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const portArg = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 3000;

const say = (msg) => console.log(`\x1b[36m[EVOLT]\x1b[0m ${msg}`);
const warn = (msg) => console.log(`\x1b[33m[EVOLT]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[EVOLT] ${msg}\x1b[0m`);
  process.exit(1);
};

/* ───────────── environment file ───────────── */

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) return parseEnv(readFileSync(ENV_FILE, "utf8"));
  const password = randomBytes(12).toString("hex");
  const env = {
    EVOLT_LOCAL_DB: "true",
    EVOLT_LOCAL_DB_PASSWORD: password,
    DATABASE_URL: `postgresql://${PG_USER}:${password}@127.0.0.1:${PG_PORT}/${PG_DB}`,
  };
  writeFileSync(
    ENV_FILE,
    [
      "# Created by run-evolt on first start. Keep this file private.",
      "# EVOLT_LOCAL_DB=true means run-evolt starts its own PostgreSQL in ./.evolt/postgres.",
      "# To use your own PostgreSQL instead, delete the EVOLT_LOCAL_DB* lines and set DATABASE_URL.",
      ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
      "",
    ].join("\n"),
  );
  say("Created .env.local for your local EVOLT.");
  return env;
}

/* ───────────── helpers ───────────── */

const nodeBin = process.execPath;
const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

function run(label, cliArgs, env) {
  say(label);
  const res = spawnSync(nodeBin, cliArgs, { cwd: ROOT, env, stdio: "inherit" });
  if (res.status !== 0) fail(`${label} failed (exit code ${res.status ?? "unknown"}).`);
}

const HOST = "127.0.0.1"; // only reachable from this computer

function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, HOST);
  });
}

async function freePort(start) {
  for (let p = start; p < start + 50; p++) if (await portIsFree(p)) return p;
  fail(`No free port found between ${start} and ${start + 49}.`);
}

async function canConnect(connectionString) {
  const { default: pgLib } = await import("pg");
  const client = new pgLib.Client({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

function withDatabase(connectionString, dbName) {
  const u = new URL(connectionString);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function withClient(connectionString, fn) {
  const { default: pgLib } = await import("pg");
  const client = new pgLib.Client({ connectionString, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

const CREATE_DB_SQL = `CREATE DATABASE "${PG_DB}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`;

/**
 * Makes sure the private database exists and is UTF-8. Earlier EVOLT versions could
 * create it in the Windows code page; such a database cannot hold "mΩ", so the demo
 * seed failed half-way. If it holds nothing but demo records it is rebuilt.
 */
async function ensureUtf8Database(appUrl) {
  const adminUrl = withDatabase(appUrl, "postgres");
  const encoding = await withClient(adminUrl, async (c) => {
    const { rows } = await c.query("select pg_encoding_to_char(encoding) as enc from pg_database where datname = $1", [PG_DB]);
    return rows[0]?.enc ?? null;
  });
  if (encoding === "UTF8") return;
  if (encoding === null) {
    await withClient(adminUrl, (c) => c.query(CREATE_DB_SQL));
    return;
  }
  const hasRealData = await withClient(appUrl, async (c) => {
    const { rows } = await c.query(`select
        case when to_regclass('public.stations') is null then 0
             else (select count(*)::int from stations where not is_synthetic) end as real_stations,
        case when to_regclass('public.health_observations') is null then 0
             else (select count(*)::int from health_observations where provenance <> 'simulated') end as real_obs`);
    return rows[0].real_stations > 0 || rows[0].real_obs > 0;
  });
  if (hasRealData) {
    throw new Error(
      `The local database uses the ${encoding} encoding and already contains your own data, so it was not rebuilt automatically.\n` +
        "  Export anything you need, stop EVOLT, delete the .evolt folder, and start again.",
    );
  }
  say(`Rebuilding the local database with UTF-8 (it was created as ${encoding}, which caused the "mΩ" error)...`);
  await withClient(adminUrl, async (c) => {
    await c.query(`DROP DATABASE "${PG_DB}"`);
    await c.query(CREATE_DB_SQL);
  });
}

/** Any database EVOLT uses must be UTF-8, including one you configured yourself. */
async function assertUtf8(appUrl) {
  let enc;
  try {
    enc = await withClient(appUrl, async (c) => (await c.query("show server_encoding")).rows[0].server_encoding);
  } catch (err) {
    fail(`Could not connect to the database in DATABASE_URL: ${err instanceof Error ? err.message : err}`);
  }
  if (enc !== "UTF8") {
    fail(
      `The database uses the ${enc} encoding; EVOLT needs UTF-8. Create it with:\n` +
        `  CREATE DATABASE evolt ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;`,
    );
  }
}

/** Stops a database left running by an earlier session (e.g. the window was closed). */
function pgCtlStop() {
  const platform = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const bin = path.join(ROOT, "node_modules", "@embedded-postgres", `${platform}-${process.arch}`, "native", "bin",
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
  if (!existsSync(bin)) return false;
  return spawnSync(bin, ["stop", "-D", DATA_DIR, "-m", "fast", "-w"], { stdio: "ignore" }).status === 0;
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

function buildIsStale() {
  const buildId = path.join(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;
  const built = statSync(buildId).mtimeMs;
  const sources = Math.max(
    newestMtime(path.join(ROOT, "src")),
    newestMtime(path.join(ROOT, "public")),
    ...["package.json", "next.config.ts", ".env.local"].map((f) =>
      existsSync(path.join(ROOT, f)) ? statSync(path.join(ROOT, f)).mtimeMs : 0,
    ),
  );
  return sources > built;
}

function openBrowser(url) {
  const opts = { stdio: "ignore", detached: true };
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], opts).unref();
  else if (process.platform === "darwin") spawn("open", [url], opts).unref();
  else spawn("xdg-open", [url], opts).on("error", () => {}).unref();
}

async function waitForHealth(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/* ───────────── main ───────────── */

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) fail(`Node.js 20.9 or newer is required (found ${process.versions.node}).`);
  if (!existsSync(nextCli) || !existsSync(tsxCli)) fail("Dependencies are missing. Run `npm install` first.");

  const fileEnv = ensureEnvFile();
  const env = { ...process.env, ...fileEnv };
  if (!env.DATABASE_URL) fail("DATABASE_URL is missing from .env.local.");
  if (env.EVOLT_EDIT_MODE === "token" && (!env.EVOLT_ADMIN_TOKEN || env.EVOLT_ADMIN_TOKEN.length < 16)) {
    warn("EVOLT_EDIT_MODE=token but EVOLT_ADMIN_TOKEN is missing or too short: editing and imports will be disabled.");
  }

  let pg = null;
  if (env.EVOLT_LOCAL_DB === "true") {
    let EmbeddedPostgres;
    try {
      ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
    } catch {
      fail("The bundled PostgreSQL package is not installed. Run `npm install` and try again.");
    }
    const firstTime = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
    const db = new EmbeddedPostgres({
      databaseDir: DATA_DIR,
      user: PG_USER,
      password: env.EVOLT_LOCAL_DB_PASSWORD ?? "evolt",
      port: PG_PORT,
      persistent: true,
      // Always UTF-8: on Windows, initdb otherwise inherits the system code page
      // (e.g. WIN1252), which cannot store characters such as "Ω" in "mΩ".
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      // PostgreSQL refuses to run as root; this only matters on Linux containers.
      createPostgresUser: typeof process.getuid === "function" && process.getuid() === 0,
      onLog: () => {},
      onError: () => {},
    });
    if (!(await portIsFree(PG_PORT))) {
      // Most likely our own database, left running when the window was closed.
      if (!firstTime && (await canConnect(env.DATABASE_URL))) {
        say("Reusing the EVOLT database that was still running from last time.");
        pg = { stop: async () => void pgCtlStop() };
      } else {
        fail(`Port ${PG_PORT} is used by another program. Close it, or set your own DATABASE_URL in .env.local.`);
      }
    }
    try {
      if (!pg) {
        if (firstTime) {
          say("Setting up a private PostgreSQL database (first run only)...");
          await db.initialise();
        }
        say(`Starting PostgreSQL on port ${PG_PORT}...`);
        await db.start();
        pg = db;
      }
    } catch (err) {
      fail(
        `PostgreSQL could not start: ${err instanceof Error ? err.message : err}\n` +
          `  If another copy of EVOLT is running, close it first. Port ${PG_PORT} must be free.`,
      );
    }
    try {
      await ensureUtf8Database(env.DATABASE_URL);
    } catch (err) {
      await pg.stop().catch(() => {});
      fail(err instanceof Error ? err.message : String(err));
    }
  } else {
    say("Using the PostgreSQL database configured in .env.local.");
  }
  await assertUtf8(env.DATABASE_URL);

  const stopDb = async () => {
    if (pg) {
      try {
        await pg.stop();
      } catch {
        // already stopped
      }
      pg = null;
    }
  };

  try {
    run("Applying database migrations...", [tsxCli, "database/migrate.ts"], env);

    if (!flag("--no-seed")) {
      const state = await withClient(env.DATABASE_URL, async (c) => {
        const { rows } = await c.query(`select
            (select count(*)::int from stations where not is_synthetic) as real_stations,
            (select count(*)::int from health_observations) as observations`);
        return rows[0];
      });
      // Seed when there is no data of your own and no observations yet. The seed is
      // idempotent, so this also completes a seed that stopped half-way.
      if (state.real_stations === 0 && state.observations === 0) {
        run(
          "Loading the demo stations...",
          [tsxCli, "--conditions=react-server", "database/seed/seed.ts"],
          env,
        );
      }
    }
    if (!flag("--no-dataset")) {
      // The supplied session dataset is the main data source; loaded once, models kept current.
      run("Checking the charging-session dataset...", [tsxCli, "--conditions=react-server", "database/seed/dataset.ts"], env);
    }

    if (flag("--rebuild") || buildIsStale()) {
      run("Building EVOLT (takes a minute the first time)...", [nextCli, "build"], env);
    } else {
      say("Build is up to date.");
    }
  } catch (err) {
    await stopDb();
    fail(err instanceof Error ? err.message : String(err));
  }

  const port = await freePort(portArg);
  const url = `http://${HOST}:${port}`;
  say(`Starting EVOLT on ${url} ...`);
  const server = spawn(nodeBin, [nextCli, "start", "-H", HOST, "-p", String(port)], { cwd: ROOT, env, stdio: "inherit" });

  let stopping = false;
  const shutdown = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    say("Stopping EVOLT...");
    if (server.exitCode === null) server.kill();
    await stopDb();
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  server.on("exit", (code) => {
    if (!stopping) {
      warn(`The web server stopped (exit code ${code}).`);
      shutdown(code ?? 1);
    }
  });

  if (await waitForHealth(url, 60_000)) {
    console.log("");
    say(`EVOLT is running at ${url}`);
    say(`  Driver view:        ${url}/driver`);
    say(`  Company workspace:  ${url}/company`);
    if (env.EVOLT_EDIT_MODE === "token") say("Editing needs the admin token from .env.local (Settings → Unlock editing).");
    else say("Editing is open: import data and manage alerts directly, no token needed.");
    say("Keep this window open. Press Ctrl+C (or close the window) to stop.");
    console.log("");
    if (!flag("--no-open")) openBrowser(url);
  } else {
    warn(`EVOLT did not report healthy within 60 seconds. Check the messages above, then open ${url}/api/health.`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
