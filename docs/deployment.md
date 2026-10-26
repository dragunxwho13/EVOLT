# Deploying EVOLT to Vercel

[← Back to README](../README.md)

EVOLT is a standard Next.js 16 application. It needs one PostgreSQL database and two
secrets. With the `vercel-build` command (step 2) a deploy prepares the database itself; without
a database the build still succeeds and the app reports `not_configured`.

## Current live deployment

| Setting | Value |
|---|---|
| URL | https://evolt-ev.vercel.app (also `evolt-nine.vercel.app`) |
| Vercel project | `evolt` — framework Next.js, Node 22.x, functions in `sin1` (Singapore) |
| Build command | `npm run vercel-build` |
| Database | Neon PostgreSQL (Free plan, Singapore), added from the Vercel Marketplace; it sets `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and related variables |
| Edit mode | `EVOLT_EDIT_MODE=token`, `EVOLT_ADMIN_TOKEN` stored as a sensitive variable |
| Deployment protection | Vercel authentication on preview deployments only; production is public |

The project is not linked to a Git repository yet, so pushes do not deploy on their own;
deployments are created from a branch and commit. To deploy on every push, link the repository
under **Project → Settings → Git**.

## 1. Create the database

Use one managed PostgreSQL provider that works from Vercel's serverless functions.

**Neon (recommended)** — create a project, then copy the **pooled** connection string
(host contains `-pooler`), e.g.
`postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`.
You can also add Neon from the Vercel Marketplace, which sets `DATABASE_URL` for you.

**Supabase** — Project settings → Database → Connection string → *Transaction pooler*
(port 6543), with `?sslmode=require`.

Keep separate databases (or Neon branches) for production and preview deployments, so
preview tests never touch production data.

## 2. Apply migrations (automatic on Vercel)

Set the project's build command to `npm run vercel-build` (`scripts/vercel-build.mjs`). When a
database is connected it applies the migrations and loads the demo stations, the Arduino bench
log and the session dataset before `next build`; every step is idempotent, so redeploys never
duplicate data. It uses `DATABASE_URL_UNPOOLED` (set by Neon) for these steps when present.
Without a database the build still succeeds.

To do it by hand instead (with the plain `npm run build` command): migrations are plain,
forward-only SQL in `database/migrations`. Run them from your machine against each database
before (or right after) its first deployment, and again whenever a new migration file is added:

```bash
DATABASE_URL="postgresql://…" npm run db:migrate
```

`next build` itself never alters a database; only the `vercel-build` wrapper does, before it.

## 3. Load the demo stations and the supplied dataset (by hand only)

`vercel-build` already does this. Without it:

```bash
DATABASE_URL="postgresql://…" npm run db:seed           # 13 labelled demo stations
DATABASE_URL="postgresql://…" npm run db:seed:dataset   # the session dataset + model training
```

The demo seed only creates records flagged as demo records and refuses to overwrite other
records with the same codes. `npm run db:seed:reset` removes demo records first. Do not
seed a production database that holds real data unless you want the demo records mixed in —
they are clearly labelled but still visible.

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "EVOLT: initial version"
git branch -M main
git remote add origin git@github.com:<you>/evolt.git
git push -u origin main
```

`.env.local` and `.env.test.local` are git-ignored; only `.env.example` is committed.

## 5. Create the Vercel project

1. Vercel dashboard → **Add New… → Project** → import the GitHub repository.
2. Framework preset: **Next.js** (detected). Build command `npm run vercel-build`, output default.
3. **Environment variables** (Settings → Environment Variables):

   | Name | Production | Preview | Notes |
   |---|---|---|---|
   | `DATABASE_URL` | prod DB URL | preview DB URL | required (set for you by the Neon integration) |
   | `DATABASE_URL_UNPOOLED` | direct DB URL | direct DB URL | optional; used for migrations at build time |
   | `EVOLT_EDIT_MODE` | `token` | `token` | **set `token` on any public deployment** (unset also means token unless `EVOLT_LOCAL_DB=true`) |
   | `EVOLT_ADMIN_TOKEN` | long random string | different random string | required in token mode; ≥ 16 chars |
   | `EVOLT_MAX_UPLOAD_BYTES` | optional | optional | default 2 MiB, max 4 MiB |

   Generate a token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Deploy. Every push to `main` deploys production; every other branch/PR gets a preview.

Function region: pick the Vercel region closest to the database (Project → Settings →
Functions) to keep query latency low.

## 6. Verify the deployment

1. `GET https://<your-app>/api/health` → `{"status":"ok","database":"ok","writesEnabled":true,"editMode":"token"}`.
   `database: "not_migrated"` means step 2 was skipped; `"unreachable"` means the URL or
   network access is wrong; `"not_configured"` means `DATABASE_URL` is missing.
2. Open `/` and both experiences: `/driver` and `/company`.
3. Open `/company/settings`, unlock editing with the admin token, then on `/company/data` click
   the "EV grid sessions" example and import it; `/company/model` should show the results.
4. Open a charger with history and confirm the evidence charts render.

## Operational notes

- Uploads are processed in the request; Vercel limits request bodies to about 4.5 MB, hence
  the 4 MiB ceiling.
- Re-running the analysis for all chargers (`POST /api/analytics/recompute`) is done charger by
  charger in separate transactions. For very large fleets, run it from a scheduled job rather
  than the UI, and raise the function's max duration if needed.
- Hosted connection strings usually carry `sslmode=require`; EVOLT passes it to `pg` as
  `verify-full` (what `pg` already does), which keeps full certificate checks and avoids its
  deprecation warning.
- GET endpoints ignore query parameters they do not know (tracking or share tokens), so shared
  links work; request bodies are still validated strictly.
- The admin session cookie is httpOnly, `SameSite=Strict`, `Secure` in production and expires
  after 8 hours. Rotating `EVOLT_ADMIN_TOKEN` invalidates all sessions.
