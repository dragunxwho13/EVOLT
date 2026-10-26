import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { MaintenanceAction } from "@/config/domain";
import { REPAIR_METRICS } from "@/config/domain";
import { getDb } from "@/lib/db/client";
import { chargers, healthObservations, maintenanceEvents, stations } from "@/lib/db/schema";
import { notFound, validationError } from "@/lib/errors";
import { verifyChargerRepairs } from "./charger-repairs";
import { summarizeRepairs, type RepairVerification } from "./repair-verification";
import { recomputeHealth } from "./service";

async function assertCharger(chargerId: string) {
  const [row] = await getDb().select({ id: chargers.id }).from(chargers).where(eq(chargers.id, chargerId));
  if (!row) throw notFound("Charger");
}

export async function listMaintenance(chargerId: string) {
  await assertCharger(chargerId);
  return getDb()
    .select()
    .from(maintenanceEvents)
    .where(eq(maintenanceEvents.chargerId, chargerId))
    .orderBy(desc(maintenanceEvents.performedAt));
}

/** Records work on a connector and re-runs the analysis (forecasts restart after maintenance). */
export async function recordMaintenance(
  chargerId: string,
  input: { performedAt: Date; action: MaintenanceAction; note?: string | null },
  now: Date = new Date(),
) {
  await assertCharger(chargerId);
  if (input.performedAt.getTime() > now.getTime() + 10 * 60_000) throw validationError("Maintenance cannot be recorded in the future.");
  if (input.performedAt.getUTCFullYear() < 2000) throw validationError("The date is before the year 2000.");
  const [created] = await getDb()
    .insert(maintenanceEvents)
    .values({ chargerId, performedAt: input.performedAt, action: input.action, note: input.note?.trim() || null })
    .returning();
  await recomputeHealth([chargerId], now);
  return created!;
}

/** Sets (or clears, with null) the operator's contact-resistance service limit and re-runs the analysis. */
export async function setServiceLimit(chargerId: string, limitMohm: number | null, now: Date = new Date()) {
  await assertCharger(chargerId);
  await getDb().update(chargers).set({ contactResistanceLimitMohm: limitMohm, updatedAt: now }).where(eq(chargers.id, chargerId));
  await recomputeHealth([chargerId], now);
  return { chargerId, contactResistanceLimitMohm: limitMohm };
}

export interface FleetRepairRow extends RepairVerification {
  chargerId: string;
  chargerCode: string;
  stationName: string;
  isDemo: boolean;
  note: string | null;
}

/** Every recorded maintenance event in the fleet with its verified outcome, plus success rates. */
export async function fleetRepairs() {
  const db = getDb();
  const events = await db
    .select({
      id: maintenanceEvents.id,
      chargerId: maintenanceEvents.chargerId,
      performedAt: maintenanceEvents.performedAt,
      action: maintenanceEvents.action,
      note: maintenanceEvents.note,
      chargerCode: chargers.code,
      stationName: stations.name,
      isDemo: stations.isSynthetic,
      summary: chargers.healthSummary,
    })
    .from(maintenanceEvents)
    .innerJoin(chargers, eq(chargers.id, maintenanceEvents.chargerId))
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .orderBy(desc(maintenanceEvents.performedAt));
  const chargerIds = [...new Set(events.map((e) => e.chargerId))];
  const obs = chargerIds.length
    ? await db
        .select({
          chargerId: healthObservations.chargerId,
          metric: healthObservations.metric,
          observedAt: healthObservations.observedAt,
          value: healthObservations.value,
          temperatureC: healthObservations.temperatureC,
        })
        .from(healthObservations)
        .where(and(inArray(healthObservations.chargerId, chargerIds), inArray(healthObservations.metric, [...REPAIR_METRICS])))
        .orderBy(asc(healthObservations.observedAt))
    : [];

  const rows: FleetRepairRow[] = [];
  const unverifiable: { chargerCode: string; reason: string }[] = [];
  for (const chargerId of chargerIds) {
    const evs = events.filter((e) => e.chargerId === chargerId);
    const first = evs[0]!;
    const verified = verifyChargerRepairs(
      first.summary,
      obs.filter((o) => o.chargerId === chargerId),
      evs.map((e) => ({ id: e.id, performedAt: e.performedAt, action: e.action })),
    );
    if (!verified.metric) {
      unverifiable.push({ chargerCode: first.chargerCode, reason: verified.reason ?? "No baseline." });
      continue;
    }
    for (const r of verified.results) {
      const ev = evs.find((e) => e.id === r.eventId)!;
      rows.push({ ...r, chargerId, chargerCode: ev.chargerCode, stationName: ev.stationName, isDemo: ev.isDemo, note: ev.note });
    }
  }
  rows.sort((a, b) => b.performedAt.localeCompare(a.performedAt));
  return { rows, summary: summarizeRepairs(rows), unverifiable, totalEvents: events.length };
}
