import { METRICS, type MetricKey } from "@/config/domain";

const DAY_MS = 86_400_000;

/** Round to a sensible number of significant digits for display. */
export function formatNumber(value: number, maxFractionDigits?: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = maxFractionDigits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
}

export function formatMetricValue(metric: MetricKey, value: number): string {
  const unit = METRICS[metric].unit;
  return unit === "count" ? `${formatNumber(value, 0)}` : `${formatNumber(value)} ${unit}`;
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Deterministic (UTC) formatting so server and client render identical text. */
export function formatDateTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? "—" : `${dateTimeFmt.format(d)} UTC`;
}

export function formatDate(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** "3 days ago" style age. `now` must be supplied explicitly to keep rendering deterministic. */
export function formatAge(input: Date | string | null | undefined, now: Date): string {
  if (!input) return "never";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = now.getTime() - d.getTime();
  if (diff < 0) return "in the future";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} months ago`;
}

export function formatDistanceKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${formatNumber(km, km < 10 ? 1 : 0)} km`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
