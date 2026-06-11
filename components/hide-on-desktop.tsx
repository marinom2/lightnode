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
  // Render on the server and on first paint so browsers (and crawlers) get the
  // content immediately. After mount, remove the block only when we detect the
  // desktop shell - the app sees a brief flash at worst, the web never blanks.
  const [hide, setHide] = useState(false);
  useEffect(() => {
    setHide(isDesktop());
  }, []);
  if (hide) return null;
  return <>{children}</>;
}
