"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isDesktop } from "@/lib/tauri";

/**
 * The marketing landing (download band, "run one from your desktop", etc.) is for
 * web visitors. Inside the desktop app the user already has the app, so send them
 * straight into the worker flow instead of showing a page that pitches the download.
 */
export function DesktopHomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (isDesktop()) router.replace("/onboard");
  }, [router]);
  return null;
}
