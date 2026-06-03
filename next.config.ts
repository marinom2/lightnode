import type { NextConfig } from "next";
import path from "node:path";

// Wallet SDKs (WalletConnect/Reown, Coinbase, Base) persist session state via
// idb-keyval → IndexedDB, which throws "database connection is closing" inside
// Tauri's WebView. Redirect idb-keyval to a localStorage-backed shim so wallet
// connect works in the desktop app (and stays reliable in browsers).
const idbKeyvalShim = path.resolve(process.cwd(), "lib/idb-keyval-localstorage.ts");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the file-tracing root to this repo. Without it, Next.js walks up the
  // tree, finds an unrelated package-lock.json in a parent directory, and warns
  // "inferred your workspace root, but it may not be correct" on every build.
  outputFileTracingRoot: process.cwd(),
  // Bake the deploy's commit SHA into the client so it can detect when a newer
  // build is live and self-reload (the desktop WebView otherwise keeps the
  // loaded page in memory across window close/reopen).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  async headers() {
    // The desktop WebView aggressively caches the page HTML, which can pin it to
    // an old JS bundle (stale install script). Force the document routes to
    // revalidate so a relaunch always runs the latest code. Hashed /_next/static
    // assets stay immutable, so this is cheap.
    const noStore = [{ key: "Cache-Control", value: "no-store, must-revalidate" }];
    const pages = ["/", "/onboard", "/dashboard", "/network", "/worker/:address*"];
    return [
      { source: "/:path*", headers: securityHeaders },
      ...pages.map((source) => ({ source, headers: noStore })),
    ];
  },
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...config.resolve.alias, "idb-keyval": idbKeyvalShim };
    return config;
  },
  async redirects() {
    // The /build/sdks reorg (2026-06): preflight + batch + agent + models were
    // collapsed into the new Inference SDK + Chat SDK. Keep old links live so
    // anything bookmarked, indexed, or shared in the wild still lands somewhere
    // meaningful.
    return [
      { source: "/build/sdks/preflight", destination: "/build/sdks/inference", permanent: true },
      { source: "/build/sdks/batch", destination: "/build/sdks/inference", permanent: true },
      { source: "/build/sdks/models", destination: "/build/sdks/inference", permanent: true },
      { source: "/build/sdks/agent", destination: "/build/sdks/chat", permanent: true },
    ];
  },
};

export default nextConfig;
