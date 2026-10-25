import { ArrowRight, BarChart3, MapPinned } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "@/components/layout/wordmark";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { chargers, chargingSessions, stations } from "@/lib/db/schema";
import { count, max, min, sql } from "drizzle-orm";
import { formatDate } from "@/lib/utils/format";

/** Shared entry: one clear choice between the driver app and the company workspace. */
export default function EntryPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10">
        <Wordmark />
      </header>
      <section className="mb-10 max-w-2xl">
        <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.02em] sm:text-[2.5rem]">EV charging intelligence with the evidence shown.</h1>
        <p className="mt-3 text-[1.05rem] text-muted">
          EVOLT helps drivers choose a charger they can rely on, and helps charging companies see which chargers and stations need
          attention first — with the records, rules and uncertainty behind every recommendation.
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <Link
          href="/driver"
          className="group flex flex-col rounded-xl border border-line bg-surface p-6 transition-[border-color,box-shadow] hover:border-ink/40 hover:shadow-lift"
        >
          <MapPinned className="h-7 w-7 text-signal" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold">I’m a driver</h2>
          <p className="mt-2 text-sm text-muted">
            Find compatible chargers near you, compare power, availability and health evidence side by side, and see why one is
            recommended over another.
          </p>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            Find a charger <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
        <Link
          href="/company"
          className="group flex flex-col rounded-xl border border-line bg-surface p-6 transition-[border-color,box-shadow] hover:border-ink/40 hover:shadow-lift"
        >
          <BarChart3 className="h-7 w-7 text-signal" aria-hidden />
          <h2 className="mt-4 text-xl font-semibold">I work for a charging company</h2>
          <p className="mt-2 text-sm text-muted">
            See prioritised action items with their evidence, connector health across the fleet, station performance, and the
            learned model — then record what you decided.
          </p>
          <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            Open the company workspace <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </Link>
      </div>

      <Suspense fallback={<p className="mt-10 h-5 text-sm text-faint" />}>
        <DataStatus />
      </Suspense>

      <footer className="mt-auto pt-12 text-xs leading-relaxed text-faint">
        Demo access: choosing a view is not a sign-in. Health categories describe recorded evidence and are not safety
        certifications. Distances are straight-line; EVOLT uses no external map or routing service.
      </footer>
    </main>
  );
}

async function loadStatus() {
  const db = getDb();
  const [[s], [c], [sess]] = await Promise.all([
    db.select({ total: count(), demo: sql<number>`count(*) filter (where ${stations.isSynthetic})::int` }).from(stations),
    db.select({ total: count() }).from(chargers),
    db.select({ n: count(), first: min(chargingSessions.startedAt), last: max(chargingSessions.startedAt) }).from(chargingSessions),
  ]);
  return { stations: s!.total, demo: s!.demo, chargers: c!.total, sessions: sess?.n ?? 0, first: sess?.first ?? null, last: sess?.last ?? null };
}

async function DataStatus() {
  await connection();
  if (!isDatabaseConfigured()) return <p className="mt-10 text-sm text-inspect">No database is configured. Set DATABASE_URL and restart.</p>;
  const status = await loadStatus().catch(() => null);
  if (!status) return <p className="mt-10 text-sm text-inspect">The database could not be reached. Open Settings in the company workspace for details.</p>;
  return (
    <p className="mt-10 text-sm text-muted">
      Loaded: {status.stations} stations ({status.demo} demo), {status.chargers} chargers
      {status.sessions > 0 ? `, ${status.sessions.toLocaleString("en-GB")} historical charging sessions (${formatDate(status.first)} – ${formatDate(status.last)})` : ""}.
    </p>
  );
}
