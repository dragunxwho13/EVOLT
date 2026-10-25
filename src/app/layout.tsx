import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
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
  title: { default: "EVOLT — EV charging intelligence", template: "%s · EVOLT" },
  description:
    "EVOLT helps EV drivers find a suitable charger and helps charging operators see which chargers need attention, with the evidence behind every recommendation.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eceff2" },
    { media: "(prefers-color-scheme: dark)", color: "#0f161d" },
  ],
};

/** Shell-free root: the entry page, the driver app and the company workspace each own their layout. */
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
        {children}
      </body>
    </html>
  );
}
