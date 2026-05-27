"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/lib/tauri";

/** Renders children only on the web. Hides web-only sections (e.g. the
 *  "download the desktop app" band) when already running inside the desktop app. */
export function WebOnly({ children }: { children: React.ReactNode }) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);
  if (desktop) return null;
  return <>{children}</>;
}
