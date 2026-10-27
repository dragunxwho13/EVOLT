"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const LINKS = [
  { href: "/driver", label: "Find a charger" },
  { href: "/driver/compare", label: "Compare" },
  { href: "/driver/bookings", label: "My bookings" },
];

export function DriverNavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Driver" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
      {LINKS.map((l) => {
        const active =
          l.href === "/driver"
            ? pathname === "/driver" || pathname.startsWith("/driver/stations") || pathname.startsWith("/driver/book/")
            : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active ? "bg-surface font-medium text-ink shadow-lift" : "text-muted hover:bg-surface/60 hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
