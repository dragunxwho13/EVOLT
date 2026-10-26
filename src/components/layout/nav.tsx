"use client";

import { ArrowLeftRight, BarChart3, Cable, CalendarClock, CircuitBoard, Wrench, ChartLine, Database, FlaskConical, Gauge, ListChecks, Map as MapIcon, Menu, Settings, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils/cn";
import { Wordmark } from "./wordmark";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

/** Company workspace navigation, grouped by the question an employee is asking. */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { href: "/company", label: "Overview", icon: Gauge },
      { href: "/company/actions", label: "Action items", icon: ListChecks },
      { href: "/company/performance", label: "Performance", icon: BarChart3 },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/company/map", label: "Fleet map", icon: MapIcon },
      { href: "/company/chargers", label: "Chargers", icon: Cable },
      { href: "/company/alerts", label: "Health alerts", icon: TriangleAlert },
      { href: "/company/forecasts", label: "Service forecast", icon: CalendarClock },
      { href: "/company/maintenance", label: "Repair checks", icon: Wrench },
    ],
  },
  {
    label: "Data & models",
    items: [
      { href: "/company/bench", label: "Arduino bench", icon: CircuitBoard },
      { href: "/company/model", label: "Learned model", icon: FlaskConical },
      { href: "/company/method", label: "Analysis method", icon: ChartLine },
      { href: "/company/data", label: "Data import", icon: Database },
      { href: "/company/settings", label: "Settings", icon: Settings },
    ],
  },
];

function isActive(pathname: string | null, href: string) {
  if (pathname === null) return false;
  // The overview matches only itself; other items also match their sub-pages.
  if (href === "/company") return pathname === "/company";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function WorkspaceLabel() {
  return (
    <span className="mb-6 ml-2.5 inline-flex w-fit items-center rounded-full border border-line-strong px-2 py-0.5 text-xs font-medium text-muted">
      Company workspace
    </span>
  );
}

function SwitchLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/driver"
      onClick={onNavigate}
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface/60 hover:text-ink"
    >
      <ArrowLeftRight aria-hidden className="h-4 w-4 text-faint" />
      Switch to driver view
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Company workspace" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2.5 text-xs font-medium text-faint">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
                      active ? "bg-surface font-medium text-ink shadow-lift" : "text-muted hover:bg-surface/60 hover:text-ink",
                    )}
                  >
                    <Icon aria-hidden className={cn("h-4 w-4", active ? "text-ink" : "text-faint group-hover:text-muted")} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Static version rendered in the prerendered shell before the pathname is known. */
export function NavFallback() {
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-3 py-5 lg:flex">
        <Link href="/" className="mb-3 px-2.5" aria-label="EVOLT home">
          <Wordmark />
        </Link>
        <WorkspaceLabel />
        <NavLinks pathname={null} />
      </aside>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-ground/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" aria-label="EVOLT home">
          <Wordmark />
        </Link>
      </div>
    </>
  );
}

export function AppNav({ footer }: { footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-3 py-5 lg:flex">
        <Link href="/" className="mb-3 px-2.5" aria-label="EVOLT home">
          <Wordmark />
        </Link>
        <WorkspaceLabel />
        <NavLinks pathname={pathname} />
        <div className="mt-auto space-y-4 pt-6">
          <SwitchLink />
          <div className="px-2.5">{footer}</div>
        </div>
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-ground/95 px-4 backdrop-blur lg:hidden">
        <Link href="/" aria-label="EVOLT home">
          <Wordmark />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="grid h-9 w-9 place-items-center rounded-md text-ink hover:bg-surface"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-ink/30 transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        inert={!open}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-ground px-3 py-4 shadow-lift transition-transform duration-250 ease-[var(--ease-settle)] lg:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-6 flex items-center justify-between px-2.5">
          <Wordmark />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-surface"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <WorkspaceLabel />
        <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
        <div className="mt-auto space-y-4 pt-6">
          <SwitchLink onNavigate={() => setOpen(false)} />
          <div className="px-2.5">{footer}</div>
        </div>
      </div>
    </>
  );
}
