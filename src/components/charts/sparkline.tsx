/** Tiny trend line for insight cards. Decorative: the card states the figures in text. */
export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const w = 120;
  const h = 32;
  const sx = (i: number) => (i / Math.max(values.length - 1, 1)) * (w - 4) + 2;
  const sy = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const d = pts.map((p, k) => `${k ? "L" : "M"}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0">
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
