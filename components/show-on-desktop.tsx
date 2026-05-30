"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/lib/tauri";

/**
 * Render `children` ONLY when this page is loaded inside the Tauri desktop
 * shell. The worker app's landing should be operator-focused; this is the
 * inverse of `HideOnDesktop` for showing a single-CTA worker hero / sections
 * that should never appear on the web.
 */
export function ShowOnDesktop({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(isDesktop());
  }, []);
  if (!show) return null;
  return <>{children}</>;
}
