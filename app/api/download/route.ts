import { NextRequest, NextResponse } from "next/server";

const OWNER = "marinom2";
const REPO = "lightnode";
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** Installer extension priority per OS (first match wins). */
const EXT_PRIORITY: Record<string, string[]> = {
  mac: [".dmg"],
  windows: ["-setup.exe", ".exe", ".msi"],
  linux: [".appimage", ".deb", ".rpm"],
};

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

function pickAsset(assets: ReleaseAsset[], exts: string[]): ReleaseAsset | null {
  for (const ext of exts) {
    const hit = assets.find((a) => a.name.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

async function fetchLatestAssets(): Promise<ReleaseAsset[] | null> {
  const token = process.env.GITHUB_DOWNLOAD_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // Cache the lookup so we don't hit GitHub's rate limit on every click.
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const release = (await res.json()) as { assets?: ReleaseAsset[] };
  return release.assets ?? [];
}

/**
 * GET /api/download?os=mac|windows|linux
 * Resolves the latest release's matching installer and 302-redirects to it, so
 * download links never embed a version and always track the latest release.
 * Any failure (unknown OS, GitHub unreachable, asset missing) falls back to the
 * public releases page rather than erroring.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const os = (req.nextUrl.searchParams.get("os") ?? "").toLowerCase();
  const exts = EXT_PRIORITY[os];
  if (!exts) return NextResponse.redirect(RELEASES_PAGE, 302);

  try {
    const assets = await fetchLatestAssets();
    if (!assets) return NextResponse.redirect(RELEASES_PAGE, 302);
    const asset = pickAsset(assets, exts);
    if (!asset) return NextResponse.redirect(RELEASES_PAGE, 302);
    return NextResponse.redirect(asset.browser_download_url, 302);
  } catch (err) {
    console.error("[download] failed to resolve latest asset:", err);
    return NextResponse.redirect(RELEASES_PAGE, 302);
  }
}
