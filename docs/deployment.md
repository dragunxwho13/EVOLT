# Deploying EVOLT to Vercel

EVOLT is a standard Next.js 16 application. It needs one PostgreSQL database and two
secrets. The build never touches the database, so builds succeed without credentials.

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

## 2. Apply migrations

Migrations are plain, forward-only SQL in `database/migrations`. Run them from your machine
against each database before (or right after) its first deployment, and again whenever a new
migration file is added:

```bash
DATABASE_URL="postgresql://…" npm run db:migrate
```

They are deliberately **not** run during `next build`: a build should never alter a database.

## 3. (Optional) Load the synthetic demonstration data

```bash
DATABASE_URL="postgresql://…" npm run db:seed
```

The seed only creates records flagged as synthetic and refuses to overwrite non-synthetic
records with the same codes. `npm run db:seed:reset` removes synthetic records first. Do not
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
2. Framework preset: **Next.js** (detected). Build command `npm run build`, output default.
3. **Environment variables** (Settings → Environment Variables):

   | Name | Production | Preview | Notes |
   |---|---|---|---|
   | `DATABASE_URL` | prod DB URL | preview DB URL | required |
   | `EVOLT_EDIT_MODE` | `token` | `token` | **set to `token` on public deployments** (default `open` lets anyone edit) |
   | `EVOLT_ADMIN_TOKEN` | long random string | different random string | required in token mode; ≥ 16 chars |
   | `EVOLT_MAX_UPLOAD_BYTES` | optional | optional | default 2 MiB, max 4 MiB |
   | `NEXT_PUBLIC_MAP_TILE_URL` | optional | optional | tile provider for production traffic |
   | `NEXT_PUBLIC_MAP_ATTRIBUTION` | optional | optional | required attribution for that provider |

   Generate a token with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Deploy. Every push to `main` deploys production; every other branch/PR gets a preview.

Function region: pick the Vercel region closest to the database (Project → Settings →
Functions) to keep query latency low.

## 6. Verify the deployment

1. `GET https://<your-app>/api/health` → `{"status":"ok","database":"ok","writesEnabled":true,"editMode":"token"}`.
   `database: "not_migrated"` means step 2 was skipped; `"unreachable"` means the URL or
   network access is wrong; `"not_configured"` means `DATABASE_URL` is missing.
2. Open `/dashboard` — figures should match your data (or the synthetic seed).
3. Open `/settings`, unlock editing with the admin token, then on `/data` click the
   "EV grid sessions" example and import it; `/model` should show the trained results.
4. Open a charger with history and confirm the evidence charts render.

## Map tiles

The default tile URL points at OpenStreetMap's community tile servers, which are suitable for
light, non-commercial use only (see their tile usage policy). For sustained traffic, configure
a commercial or self-hosted provider with `NEXT_PUBLIC_MAP_TILE_URL` and its attribution.

## Operational notes

- Uploads are processed in the request; Vercel limits request bodies to about 4.5 MB, hence
  the 4 MiB ceiling.
- Re-running the analysis for all chargers (`POST /api/analytics/recompute`) is done charger by
  charger in separate transactions. For very large fleets, run it from a scheduled job rather
  than the UI, and raise the function's max duration if needed.
- The admin session cookie is httpOnly, `SameSite=Strict`, `Secure` in production and expires
  after 8 hours. Rotating `EVOLT_ADMIN_TOKEN` invalidates all sessions.
