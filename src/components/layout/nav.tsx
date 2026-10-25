"use client";

import { Cable, ChartLine, Database, FlaskConical, Gauge, MapPin, Menu, Route, Settings, TriangleAlert, X, Zap } from "lucide-react";
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

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "For drivers",
    items: [
      { href: "/drivers", label: "Find a charge", icon: Zap },
      { href: "/stations", label: "Station map", icon: MapPin },
      { href: "/recommendations", label: "Find alternatives", icon: Route },
    ],
  },
  {
    label: "For operators",
    items: [
      { href: "/dashboard", label: "Operations overview", icon: Gauge },
      { href: "/alerts", label: "Alerts", icon: TriangleAlert },
      { href: "/chargers", label: "Chargers", icon: Cable },
      { href: "/model", label: "Learned model", icon: FlaskConical },
      { href: "/analytics", label: "Analysis method", icon: ChartLine },
      { href: "/data", label: "Data import", icon: Database },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2.5 text-xs font-medium text-faint">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
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
        <Link href="/drivers" className="mb-8 px-2.5">
          <Wordmark />
        </Link>
        <NavLinks pathname={null} />
      </aside>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-ground/95 px-4 backdrop-blur lg:hidden">
        <Link href="/drivers">
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
        <Link href="/drivers" className="mb-8 px-2.5" aria-label="EVOLT driver home">
          <Wordmark />
        </Link>
        <NavLinks pathname={pathname} />
        <div className="mt-auto px-2.5 pt-6">{footer}</div>
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-ground/95 px-4 backdrop-blur lg:hidden">
        <Link href="/drivers" aria-label="EVOLT driver home">
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
        <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
        <div className="mt-auto px-2.5 pt-6">{footer}</div>
      </div>
    </>
  );
}
