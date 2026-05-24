import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lightnode.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/onboard", "/dashboard"].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.8,
  }));
}
