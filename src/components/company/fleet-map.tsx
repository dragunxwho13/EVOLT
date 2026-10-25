"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CONNECTOR_LABELS, HEALTH_LABELS, HEALTH_STATUSES, type HealthStatus } from "@/config/domain";
import { EvoltMap, type MapPoint } from "@/components/map/evolt-map";
import { DemoTag, HealthBadge, HealthGlyph, OperationalBadge } from "@/components/ui/status";
import type { StationListItem } from "@/features/station-discovery/service";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

const ORDER: HealthStatus[] = ["inspection_recommended", "monitor", "insufficient_data", "normal"];
const TEXT: Record<HealthStatus, string> = {
  inspection_recommended: "text-inspect",
  monitor: "text-watch",
  normal: "text-ok",
  insufficient_data: "text-unknown",
};

export interface FleetMapProps {
  stations: StationListItem[];
  /** Open action items per station id (dataset rules + health alerts). */
  actionCounts: Record<string, number>;
  /** Compact mode for the overview: no side list or filters. */
  compact?: boolean;
}

/** Operator map: where attention is needed, with each station's chargers one click away. */
export function FleetMap({ stations, actionCounts, compact = false }: FleetMapProps) {
  const located = stations.filter((s) => s.latitude !== null && s.longitude !== null);
  const [shown, setShown] = useState<Set<HealthStatus>>(new Set(HEALTH_STATUSES));
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<HealthStatus, number> = { inspection_recommended: 0, monitor: 0, normal: 0, insufficient_data: 0 };
    for (const s of located) c[s.worstHealth]++;
    return c;
  }, [located]);

  const points: MapPoint[] = located
    .filter((s) => shown.has(s.worstHealth))
    .map((s) => {
      const actions = actionCounts[s.id] ?? 0;
      return {
        id: s.id,
        name: s.name,
        lat: s.latitude!,
        lng: s.longitude!,
        variant: s.worstHealth,
        title: `${s.name} — ${HEALTH_LABELS[s.worstHealth]}, ${s.chargerCount} chargers${actions ? `, ${actions} open action items` : ""}`,
      };
    });

  const attention = located
    .filter((s) => s.worstHealth === "inspection_recommended" || s.worstHealth === "monitor")
    .sort((a, b) => ORDER.indexOf(a.worstHealth) - ORDER.indexOf(b.worstHealth) || (actionCounts[b.id] ?? 0) - (actionCounts[a.id] ?? 0));

  const map = (
    <EvoltMap
      ariaLabel="Map of the charging network by connector health"
      className={compact ? "h-[340px]" : "h-[520px]"}
      points={points}
      selectedId={selected}
      onSelect={setSelected}
      fitKey="fleet"
      legend={ORDER.map((h) => ({ variant: h, label: HEALTH_LABELS[h] }))}
      renderPopup={(p) => <FleetPopup station={located.find((s) => s.id === p.id)!} actions={actionCounts[p.id] ?? 0} />}
    />
  );

  if (compact) return map;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show stations by worst charger health">
          {ORDER.map((h) => {
            const on = shown.has(h);
            return (
              <button
                key={h}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setShown((cur) => {
                    const next = new Set(cur);
                    if (next.has(h)) next.delete(h);
                    else next.add(h);
                    return next;
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  on ? "border-ink/40 bg-surface text-ink" : "border-line bg-sunken text-faint line-through",
                )}
              >
                <HealthGlyph status={h} className={TEXT[h]} />
                {HEALTH_LABELS[h]} <span className="num text-muted">{counts[h]}</span>
              </button>
            );
          })}
        </div>
        {map}
        {stations.length > located.length && (
          <p className="mt-2 text-xs text-muted">
            {stations.length - located.length} station{stations.length - located.length === 1 ? " has" : "s have"} no recorded coordinates and
            cannot be mapped (most come from the session dataset, which records only an area type). They are listed on the Performance page.
          </p>
        )}
      </div>
      <aside aria-labelledby="attention-list" className="rounded-lg border border-line bg-surface">
        <h2 id="attention-list" className="border-b border-line px-4 py-3 text-[0.95rem] font-semibold">
          Stations needing attention
        </h2>
        {attention.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No mapped station has a charger flagged for monitoring or inspection.</p>
        ) : (
          <ul className="divide-y divide-line">
            {attention.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={cn("flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-sunken", selected === s.id && "bg-sunken")}
                >
                  <HealthGlyph status={s.worstHealth} className={cn("mt-1", TEXT[s.worstHealth])} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{s.name}</span>
                    <span className="block text-xs text-muted">
                      {s.healthCounts.inspection_recommended} inspect · {s.healthCounts.monitor} monitor
                      {actionCounts[s.id] ? ` · ${actionCounts[s.id]} open action item${actionCounts[s.id] === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function FleetPopup({ station, actions }: { station: StationListItem; actions: number }) {
  return (
    <div>
      <p className="pr-8 font-semibold leading-snug">{station.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {station.city && <span>{station.city}</span>}
        <span className="num">{station.code}</span>
        {station.isSynthetic && <DemoTag />}
      </p>
      <p className="mt-2 text-sm">
        {station.chargerCount} charger{station.chargerCount === 1 ? "" : "s"} · {station.availableCount} reported available
        {actions > 0 && (
          <>
            {" · "}
            <Link href="/company/actions" className="font-medium text-signal hover:underline">
              {actions} open action item{actions === 1 ? "" : "s"}
            </Link>
          </>
        )}
      </p>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {station.chargers.map((c) => (
          <li key={c.id} className="py-2">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/company/chargers/${c.id}`} className="num text-sm font-medium text-signal hover:underline">
                {c.code}
              </Link>
              <OperationalBadge status={c.operationalStatus} />
            </div>
            <p className="text-xs text-muted">
              {CONNECTOR_LABELS[c.connectorType]}
              {c.ratedPowerKw !== null ? ` · ${formatNumber(c.ratedPowerKw, 0)} kW` : ""}
              {c.activeAlerts ? ` · ${c.activeAlerts} open alert${c.activeAlerts === 1 ? "" : "s"}` : ""}
            </p>
            <div className="mt-1">
              <HealthBadge status={c.healthStatus} short />
            </div>
          </li>
        ))}
      </ul>
      <Link href={`/company/stations/${station.id}`} className="mt-3 inline-block text-sm font-medium text-signal underline-offset-4 hover:underline">
        Station details and session history →
      </Link>
    </div>
  );
}
