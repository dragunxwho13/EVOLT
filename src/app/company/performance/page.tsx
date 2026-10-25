import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RateIntervals } from "@/components/charts/rate-intervals";
import { FilterForm } from "@/components/ui/filter-form";
import { EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton, buttonClass } from "@/components/ui/primitives";
import type { GroupRow } from "@/features/insights/performance";
import { getPerformance } from "@/features/insights/performance-service";
import { load } from "@/lib/http/load";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Performance" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const SORTS = {
  station: { label: "Station", value: (r: GroupRow) => r.label },
  sessions: { label: "Sessions", value: (r: GroupRow) => r.summary.sessions },
  energy: { label: "Energy", value: (r: GroupRow) => r.summary.energyKwh ?? -1 },
  loss: { label: "High-loss share", value: (r: GroupRow) => r.summary.highLoss.rate ?? -1 },
  stability: { label: "Poor stability", value: (r: GroupRow) => r.summary.poorStability.rate ?? -1 },
  inconsistent: { label: "Inconsistent records", value: (r: GroupRow) => r.summary.lossExceedsConsumed.count + r.summary.energyExceedsBattery.count },
} as const;
type SortKey = keyof typeof SORTS;

export default function PerformancePage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <PageHeader
        title="Station performance"
        description="How each station performed in the stored charging sessions, with sample sizes and uncertainty, so a difference is only called a difference when the data supports it."
      />
      <Suspense fallback={<PanelSkeleton rows={10} />}>
        <PerformanceContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function PerformanceContent({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await connection();
  const chargingMode = one(sp.chargingMode)?.slice(0, 60) || undefined;
  const area = one(sp.area)?.slice(0, 60) || undefined;
  const sortKey: SortKey = (Object.keys(SORTS) as SortKey[]).find((k) => k === one(sp.sort)) ?? "loss";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";

  const result = await load(() => getPerformance({ chargingMode, area }));
  if (!result.ok) return <ErrorState {...result.error} />;
  const p = result.data;

  const filterQs = new URLSearchParams();
  if (chargingMode) filterQs.set("chargingMode", chargingMode);
  if (area) filterQs.set("area", area);
  const csvHref = `/api/company/performance?${new URLSearchParams([...filterQs, ["format", "csv"]])}`;
  const sortHref = (k: SortKey) => {
    const s = new URLSearchParams(filterQs);
    s.set("sort", k);
    s.set("dir", k === sortKey && dir === "desc" ? "asc" : "desc");
    return `/company/performance?${s}`;
  };

  const rows = [...p.stations].sort((a, b) => {
    const va = SORTS[sortKey].value(a);
    const vb = SORTS[sortKey].value(b);
    const c = typeof va === "string" ? va.localeCompare(String(vb), undefined, { numeric: true }) : (va as number) - (vb as number);
    return dir === "asc" ? c : -c;
  });
  const byLoss = [...p.stations].filter((r) => r.summary.highLoss.rate !== null).sort((a, b) => b.summary.highLoss.rate! - a.summary.highLoss.rate!);

  return (
    <>
      <FilterForm
        action="/company/performance"
        selects={[
          { name: "chargingMode", label: "Charging type", value: chargingMode, options: p.filters.chargingModes.map((m) => ({ value: m, label: m })) },
          { name: "area", label: "Area type", value: area, options: p.filters.areas.map((a) => ({ value: a, label: a })) },
        ]}
      />

      {p.fleet.sessions === 0 ? (
        <EmptyState title="No sessions match" action={<Link className={buttonClass()} href="/company/data">Import sessions</Link>}>
          {chargingMode || area ? "Clear the filters to see all sessions." : "Import a charging-session file to see station performance."}
        </EmptyState>
      ) : (
        <div className="grid gap-5">
          <Panel title="What the data shows" description={`Historical data · ${formatDate(p.fleet.firstAt)} – ${formatDate(p.fleet.lastAt)} · ${p.fleet.sessions.toLocaleString("en-GB")} sessions${chargingMode || area ? " (filtered)" : ""}`}>
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              <li>{p.takeaways.stations}</li>
              <li>{p.takeaways.area}</li>
              <li>{p.takeaways.mode}</li>
              <li>{p.takeaways.dailyLoss}</li>
            </ul>
          </Panel>

          <Panel title="High-loss share by station" description="Share of each station's labelled sessions marked “High” loss, with its 95 % interval. Stations whose interval sits wholly to the right of the fleet line are clearly above it.">
            <RateIntervals caption="High-loss share by station" fleet={p.fleet.highLoss.rate} rows={byLoss.map((r) => ({ label: r.label, ...r.summary.highLoss }))} />
          </Panel>

          <Panel
            title="Station table"
            description="Select a column heading to sort. Energy is derived from charging power × time; time is assumed to be minutes."
            flush
            actions={
              <a href={csvHref} className={buttonClass("secondary", "sm")} download>
                Download CSV
              </a>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <caption className="sr-only">Station performance</caption>
                <thead className="border-b border-line text-left text-muted">
                  <tr>
                    {(
                      [
                        ["station", "Station", "left"],
                        ["sessions", "Sessions", "right"],
                        ["energy", "Energy (kWh)", "right"],
                      ] as const
                    ).map(([k, label, align]) => (
                      <SortTh key={k} href={sortHref(k)} active={sortKey === k} dir={dir} align={align}>
                        {label}
                      </SortTh>
                    ))}
                    <th className="px-3 py-2.5 text-right font-medium">Avg session</th>
                    <th className="px-3 py-2.5 text-right font-medium">Avg power</th>
                    <th className="px-3 py-2.5 text-right font-medium">Median loss</th>
                    <SortTh href={sortHref("loss")} active={sortKey === "loss"} dir={dir} align="right">
                      High-loss share
                    </SortTh>
                    <SortTh href={sortHref("stability")} active={sortKey === "stability"} dir={dir} align="right">
                      Poor stability
                    </SortTh>
                    <SortTh href={sortHref("inconsistent")} active={sortKey === "inconsistent"} dir={dir} align="right">
                      Inconsistent records
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const s = r.summary;
                    return (
                      <tr key={r.key} className="hover:bg-sunken">
                        <td className="px-4 py-2.5">
                          {r.href ? (
                            <Link href={r.href} className="font-medium text-signal hover:underline">
                              {r.label}
                            </Link>
                          ) : (
                            r.label
                          )}
                        </td>
                        <td className="num px-3 py-2.5 text-right">{s.sessions}</td>
                        <td className="num px-3 py-2.5 text-right">{s.energyKwh === null ? "—" : formatNumber(s.energyKwh, 0)}</td>
                        <td className="num px-3 py-2.5 text-right">{s.avgDurationMin === null ? "—" : `${formatNumber(s.avgDurationMin, 0)} min`}</td>
                        <td className="num px-3 py-2.5 text-right">{s.avgChargingPowerKw === null ? "—" : `${formatNumber(s.avgChargingPowerKw, 1)} kW`}</td>
                        <td className="num px-3 py-2.5 text-right">{s.medianPowerLossKw === null ? "—" : `${formatNumber(s.medianPowerLossKw, 2)} kW`}</td>
                        <td className="num px-3 py-2.5 text-right">
                          {s.highLoss.rate === null ? "—" : `${formatPercent(s.highLoss.rate)} (${s.highLoss.count}/${s.highLoss.of})`}
                        </td>
                        <td className="num px-3 py-2.5 text-right">
                          {s.poorStability.rate === null ? "—" : `${formatPercent(s.poorStability.rate)} (${s.poorStability.count}/${s.poorStability.of})`}
                        </td>
                        <td className="num px-4 py-2.5 text-right">{s.lossExceedsConsumed.count + s.energyExceedsBattery.count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="text-xs text-muted">
            Not calculated: utilisation, downtime, availability and failed-session rate — the data has no per-charger availability,
            downtime or session outcome, and the number of chargers per station changes between rows. Inconsistent records = sessions
            that lose more power than they consume plus sessions that deliver more energy than the battery holds.
          </p>
        </div>
      )}
    </>
  );
}

function SortTh({ href, active, dir, align, children }: { href: string; active: boolean; dir: "asc" | "desc"; align: "left" | "right"; children: React.ReactNode }) {
  return (
    <th className={`px-3 py-2.5 font-medium first:px-4 ${align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className={active ? "text-ink underline underline-offset-4" : "hover:text-ink"}>
        {children}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </Link>
    </th>
  );
}
