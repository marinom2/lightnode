export type DownloadOS = "mac" | "windows" | "linux";

export const OS_LABEL: Record<DownloadOS, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/**
 * Best-effort client OS detection for choosing a desktop installer. Returns null
 * for mobile / unrecognized clients (which can't run the desktop app), so the UI
 * can fall back to showing every download.
 */
export function detectClientOS(): DownloadOS | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return null; // Android UA also says "Linux"
  if (/iPhone|iPad|iPod/i.test(ua)) return null; // mobile, can't install
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Windows|Win64|Win32/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
}
