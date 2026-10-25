import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense, type ReactNode } from "react";
import { AppNav, NavFallback } from "@/components/layout/nav";
import "./globals.css";

const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-wght-normal.woff2", style: "normal", weight: "100 700" },
    { path: "./fonts/ibm-plex-sans-latin-wght-italic.woff2", style: "italic", weight: "100 700" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "EVOLT", template: "%s · EVOLT" },
  description:
    "EVOLT — an explainable intelligence platform for EV charging-connector health and degradation analysis. Research prototype; not a safety certification.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceff2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f161d" },
  ],
};

function PrototypeNote() {
  return (
    <p className="text-xs leading-relaxed text-faint">
      Public discovery for drivers. Operator diagnostics live in the operations workspace.
    </p>
  );
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-ground text-ink">
        <a
          href="#main"
          className="sr-only z-[60] rounded-md bg-ink px-3 py-2 text-surface focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <div className="lg:flex">
          <Suspense fallback={<NavFallback />}>
            <AppNav footer={<PrototypeNote />} />
          </Suspense>
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <div className="mx-auto max-w-[1280px]">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
