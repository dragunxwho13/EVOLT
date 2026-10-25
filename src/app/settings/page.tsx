import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ANALYSIS_VERSION } from "@/config/analysis";
import { MAP_TILE_URL } from "@/config/map";
import { AdminSession } from "@/components/settings/admin-session";
import { KeyValues, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { describeError } from "@/lib/errors";
import { ADMIN_COOKIE, editMode, hasAdminSession, isAdminConfigured } from "@/lib/security/admin";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Editing access, configuration status and the limits of what EVOLT can tell you." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Editing access" description="Who may import data, change alert status and re-run the analysis.">
          <Suspense fallback={<div className="skeleton h-20" />}>
            <SessionLoader />
          </Suspense>
        </Panel>
        <Suspense fallback={<PanelSkeleton rows={4} />}>
          <ConfigStatus />
        </Suspense>
        <Panel title="What EVOLT is — and is not" className="lg:col-span-2">
          <ul className="grid gap-x-8 gap-y-2 text-sm text-muted md:grid-cols-2">
            <li>A research prototype that summarises connector-health evidence you provide. It is not a certified safety system.</li>
            <li>It does not measure connectors. Health categories describe patterns in the recorded data only.</li>
            <li>An anomaly is a reason to inspect, not proof of degradation; missing data is never treated as healthy.</li>
            <li>Distances are straight-line. Driving distance, travel time and price are not estimated.</li>
            <li>Development records are labelled everywhere they appear and use generated observations.</li>
            <li>Optional bench-sensor readings are supporting context and never change a charger&apos;s health status.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

async function SessionLoader() {
  const store = await cookies();
  await connection();
  if (editMode() === "open") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-ok">Editing is open — no token needed.</p>
        <p className="text-muted">
          Anyone who can open this app can import data and change alerts. That is right for your own computer or a demo.
          Requests sent from other websites are still refused.
        </p>
        <p className="text-muted">
          Publishing EVOLT on the internet? Set <code className="num text-ink">EVOLT_EDIT_MODE=token</code> and{" "}
          <code className="num text-ink">EVOLT_ADMIN_TOKEN</code> so only people with the token can make changes.
        </p>
      </div>
    );
  }
  return <AdminSession configured={isAdminConfigured()} authenticated={hasAdminSession(store.get(ADMIN_COOKIE)?.value)} />;
}

async function ConfigStatus() {
  await connection(); // request-time: configuration may differ per deployment
  let database = "Not configured — set DATABASE_URL";
  let ok = false;
  if (isDatabaseConfigured()) {
    try {
      const r = await getDb().execute(sql`select to_regclass('public.chargers') is not null as migrated`);
      ok = Boolean((r.rows[0] as { migrated?: boolean } | undefined)?.migrated);
      database = ok ? "Connected and migrated" : "Connected, but migrations have not been applied — run npm run db:migrate";
    } catch (err) {
      database = describeError(err).message;
    }
  }
  let tileHost = "custom";
  try {
    tileHost = new URL(MAP_TILE_URL.replace(/\{[a-z]\}/g, "x")).host;
  } catch {
    // keep "custom"
  }
  return (
    <Panel title="Configuration">
      <KeyValues
        items={[
          ["Database", <span key="d" className={ok ? "text-ok" : "text-inspect"}>{database}</span>],
          [
            "Editing",
            editMode() === "open" ? (
              "Open (no token required)"
            ) : isAdminConfigured() ? (
              "Token required — admin token configured"
            ) : (
              <span key="e" className="text-watch">
                Disabled — token mode but no admin token set
              </span>
            ),
          ],
          ["Map tiles", tileHost],
          ["Analysis version", ANALYSIS_VERSION],
          ["Health endpoint", <code key="h" className="num">/api/health</code>],
        ]}
      />
    </Panel>
  );
}
