import { NextRequest, NextResponse } from "next/server";

const OWNER = "marinom2";
const REPO = "lightnode";
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;

/** Installer extension priority per OS (first match wins).
 *  Linux prefers the .deb: it's a real click-to-install package (apt / the
 *  software center installs it AND auto-pulls the WebKitGTK runtime the app
 *  needs), unlike the AppImage which a user must chmod +x and launch by hand.
 *  The .rpm and portable AppImage stay reachable under "All downloads", and the
 *  one-line installer (lightnode.app/install.sh) covers every other distro. */
const EXT_PRIORITY: Record<string, string[]> = {
  mac: [".dmg"],
  windows: ["-setup.exe", ".exe", ".msi"],
  linux: [".deb", ".appimage", ".rpm"],
};

/** The repo cuts releases for more than one product: desktop builds use `v*`
 *  tags, the wallet extension uses `wallet-v*`. "releases/latest" is whichever
 *  shipped most recently, so each product must resolve against its own tag
 *  family or a wallet release silently breaks every desktop download link. */
const TAG_FAMILY: Record<string, RegExp> = {
  desktop: /^v\d/,
  wallet: /^wallet-v\d/,
};

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets?: ReleaseAsset[];
}

function pickAsset(assets: ReleaseAsset[], exts: string[]): ReleaseAsset | null {
  for (const ext of exts) {
    const hit = assets.find((a) => a.name.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return null;
}

async function fetchNewestRelease(family: RegExp): Promise<Release | null> {
  const token = process.env.GITHUB_DOWNLOAD_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // Cache the lookup so we don't hit GitHub's rate limit on every click.
    next: { revalidate: 300 },
  });
  if (!res.ok) return null;
  const releases = (await res.json()) as Release[];
  // The API returns releases newest-first; the first tag in the family wins.
  return releases.find((r) => !r.draft && family.test(r.tag_name)) ?? null;
}

/**
 * GET /api/download?os=mac|windows|linux        -> latest desktop installer
 * GET /api/download?product=wallet              -> latest wallet extension zip
 * Resolves the newest release IN THAT PRODUCT'S TAG FAMILY and 302-redirects to
 * the matching asset, so download links never embed a version. Any failure
 * (unknown OS, GitHub unreachable, asset missing) falls back to the public
 * releases page rather than erroring.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if ((req.nextUrl.searchParams.get("product") ?? "").toLowerCase() === "wallet") {
      const release = await fetchNewestRelease(TAG_FAMILY.wallet);
      const asset = release?.assets?.find((a) => a.name.endsWith(".zip")) ?? null;
      return NextResponse.redirect(asset?.browser_download_url ?? RELEASES_PAGE, 302);
    }

    const os = (req.nextUrl.searchParams.get("os") ?? "").toLowerCase();
    const exts = EXT_PRIORITY[os];
    if (!exts) return NextResponse.redirect(RELEASES_PAGE, 302);
    const release = await fetchNewestRelease(TAG_FAMILY.desktop);
    const asset = release?.assets ? pickAsset(release.assets, exts) : null;
    return NextResponse.redirect(asset?.browser_download_url ?? RELEASES_PAGE, 302);
  } catch (err) {
    console.error("[download] failed to resolve release asset:", err);
    return NextResponse.redirect(RELEASES_PAGE, 302);
  }
}
