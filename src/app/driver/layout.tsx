import { ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Wordmark } from "@/components/layout/wordmark";
import { DriverNavLinks } from "@/components/layout/driver-nav";

/** The driver experience: a light top bar and a single-column task flow — no operator analytics. */
export default function DriverLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-ground/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="EVOLT home" className="mr-auto flex items-center gap-3 sm:mr-0">
            <Wordmark />
          </Link>
          <span className="rounded-full bg-signal-soft px-2.5 py-0.5 text-xs font-medium text-signal">Driver</span>
          <Suspense fallback={<span className="order-last w-full sm:order-none sm:w-auto" />}>
            <DriverNavLinks />
          </Suspense>
          <Link
            href="/company"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <ArrowLeftRight aria-hidden className="h-4 w-4" />
            <span>Company workspace</span>
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
