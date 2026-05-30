"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/lib/tauri";

/**
 * Render `children` only when this page is loaded in the web browser. In the
 * Tauri desktop shell (the worker app) the wrapped block is removed. Used to
 * hide cloud-IDE shortcuts (Codespaces, StackBlitz) from operators - they
 * already have a local environment and the buttons just produce dead ends.
 */
export function HideOnDesktop({ children }: { children: React.ReactNode }) {
  // Render nothing on the first paint so the SSR markup matches the desktop
  // (no flash). Then on mount, reveal if we're in a web browser.
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(!isDesktop());
  }, []);
  if (!show) return null;
  return <>{children}</>;
}
