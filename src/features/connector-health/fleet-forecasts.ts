import "server-only";
import { eq } from "drizzle-orm";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { METRICS, type MetricKey } from "@/config/domain";
import { getDb } from "@/lib/db/client";
import { chargers, stations } from "@/lib/db/schema";
import type { ServiceForecast } from "@/types/analysis";

export interface FleetForecastRow {
  chargerId: string;
  chargerCode: string;
  stationName: string;
  isDemo: boolean;
  metric: MetricKey;
  historical: boolean;
  forecast: ServiceForecast;
}

const ORDER: Record<ServiceForecast["status"], number> = { already_above: 0, projected: 1, not_rising: 2, insufficient_data: 3 };

/** Every stored service-limit forecast, soonest first. Read from the stored health summaries. */
export async function fleetForecasts(now: Date = new Date()): Promise<{ rows: FleetForecastRow[]; chargers: number; dueSoon: number }> {
  const rows = await getDb()
    .select({ id: chargers.id, code: chargers.code, stationName: stations.name, isDemo: stations.isSynthetic, summary: chargers.healthSummary })
    .from(chargers)
    .innerJoin(stations, eq(stations.id, chargers.stationId));
  const out: FleetForecastRow[] = [];
  for (const c of rows) {
    for (const m of c.summary?.metrics ?? []) {
      if (!m.forecast || !METRICS[m.metric].forecast) continue;
      out.push({
        chargerId: c.id,
        chargerCode: c.code,
        stationName: c.stationName,
        isDemo: c.isDemo,
        metric: m.metric,
        historical: Boolean(c.summary?.historical),
        forecast: m.forecast,
      });
    }
  }
  out.sort((a, b) => {
    const s = ORDER[a.forecast.status] - ORDER[b.forecast.status];
    if (s) return s;
    const da = a.forecast.earliestDate ?? "9999";
    const db = b.forecast.earliestDate ?? "9999";
    return da.localeCompare(db) || a.chargerCode.localeCompare(b.chargerCode);
  });
  const horizon = now.getTime() + ANALYSIS_PARAMS.forecastActionDays * 86_400_000;
  const dueSoon = out.filter((r) => r.forecast.status === "projected" && r.forecast.earliestDate && new Date(r.forecast.earliestDate).getTime() <= horizon).length;
  return { rows: out, chargers: rows.length, dueSoon };
}
