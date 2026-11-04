import { createRequire } from "node:module";
import type { NextConfig } from "next";

type ConfigWrapper = (cfg: NextConfig) => NextConfig;

const withBundleAnalyzer: ConfigWrapper =
  process.env.ANALYZE === "true"
    ? (createRequire(import.meta.url)("@next/bundle-analyzer") as ConfigWrapper)
    : (cfg) => cfg;

const pkg = createRequire(import.meta.url)("./package.json") as {
  version?: unknown;
};

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  // Stamped build version for the Account update card (plain web has
  // no desktop bridge, so the bundle carries its own number).
  env: {
    NEXT_PUBLIC_APP_VERSION: typeof pkg.version === "string" ? pkg.version : "0.1.0",
  },
  experimental: {
    optimizePackageImports: ["three", "pixi.js"],
  },
  // Turbopack is the Next 16 default; the old webpack performance
  // hints have no Turbopack equivalent and were advisory only.
  turbopack: {},
  // Folded routes keep working as links: the tote pack-out lives on
  // the console now (?game=tote preserves pack deep-links), leagues
  // on ranks. Temporary, not permanent — the folds are young.
  redirects() {
    return Promise.resolve([
      { source: "/tote", destination: "/console?game=tote", permanent: false },
      { source: "/leagues", destination: "/ranks", permanent: false },
    ]);
  },
  headers() {
    // Production only: dev HMR needs eval, which this policy bans.
    // connect-src stays open to http(s) because direct-sim failover
    // dials a sidecar on whatever host the player configured.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' http: https:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    const extra =
      process.env.NODE_ENV === "production"
        ? [{ key: "Content-Security-Policy", value: csp }]
        : [];
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...extra,
        ],
      },
    ]);
  },
};

export default withBundleAnalyzer(nextConfig);
