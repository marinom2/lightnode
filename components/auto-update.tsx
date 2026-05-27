"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the (often cached) desktop WebView fresh: polls the server's current
 * build and reloads when it differs from the build this page was served from.
 * So a `vercel --prod` reaches users without a manual quit/reopen. No-op in dev
 * or when the build id is unknown.
 */
export function AutoUpdate() {
  const own = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
  const reloading = useRef(false);

  useEffect(() => {
    if (own === "dev") return; // only meaningful on a real deploy
    let stopped = false;

    const check = async () => {
      if (stopped || reloading.current) return;
      try {
        const { build } = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json());
        if (build && build !== "dev" && build !== own) {
          reloading.current = true;
          window.location.reload();
        }
      } catch {
        /* offline / transient - try again next tick */
      }
    };

    const onVisible = () => document.visibilityState === "visible" && check();
    const t = setInterval(check, 120_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    check();

    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [own]);

  return null;
}
