import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    // Old routes from before the driver/company split keep working.
    const moved: [string, string][] = [
      ["/dashboard", "/company"],
      ["/alerts", "/company/alerts"],
      ["/alerts/:id", "/company/alerts/:id"],
      ["/chargers", "/company/chargers"],
      ["/chargers/:id", "/company/chargers/:id"],
      ["/stations", "/driver"],
      ["/stations/:id", "/driver/stations/:id"],
      ["/recommendations", "/driver"],
      ["/drivers", "/driver"],
      ["/model", "/company/model"],
      ["/analytics", "/company/method"],
      ["/data", "/company/data"],
      ["/settings", "/company/settings"],
    ];
    return moved.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
