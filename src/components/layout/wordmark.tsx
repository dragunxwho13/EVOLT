/**
 * EVOLT mark: a stylised DC connector face — two power contacts above a row of
 * signal pins. The lower-right power contact is drawn hollow, the "one to watch".
 */
export function EvoltMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--ink)" />
      <circle cx="11" cy="13" r="4.2" fill="var(--surface)" />
      <circle cx="21" cy="13" r="4.2" fill="none" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="10" cy="23" r="1.6" fill="var(--surface)" opacity=".7" />
      <circle cx="16" cy="23" r="1.6" fill="var(--surface)" opacity=".7" />
      <circle cx="22" cy="23" r="1.6" fill="var(--surface)" opacity=".7" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <EvoltMark />
      <span className="flex flex-col leading-none">
        <span className="text-[1.15rem] font-bold tracking-[0.08em] text-ink">EVOLT</span>
        <span className="mt-1 text-[0.6875rem] text-muted">Charging intelligence</span>
      </span>
    </span>
  );
}
