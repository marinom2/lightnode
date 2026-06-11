import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lightnode.app";

/** Every public route, weighted by how much we want it discovered. The /build
 *  developer console is the flagship content; keep it fully enumerated. */
const ROUTES: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "/build", priority: 0.9 },
  { path: "/onboard", priority: 0.9 },
  { path: "/wallet", priority: 0.9 },
  { path: "/playground", priority: 0.8 },
  { path: "/network", priority: 0.8 },
  { path: "/dashboard", priority: 0.7 },
  { path: "/learn", priority: 0.7 },
  { path: "/guide", priority: 0.7 },
  { path: "/recover", priority: 0.4 },
  { path: "/wallet/privacy", priority: 0.3 },
  ...[
    "inference",
    "chat",
    "agent",
    "batch",
    "quote",
    "models",
    "network",
    "errors",
    "drift",
    "economics",
    "revenue",
    "bridge",
    "dao",
    "worker",
    "cli",
    "reference",
  ].map((p) => ({ path: `/build/${p}`, priority: 0.7 })),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority,
  }));
}
