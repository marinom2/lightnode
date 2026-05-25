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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...config.resolve.alias, "idb-keyval": idbKeyvalShim };
    return config;
  },
};

export default nextConfig;
