"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "lightnode.theme";

/** Light/dark toggle with the circular "wave" reveal from the click point —
 *  the same View Transitions effect LightChain's chat uses. Falls back to an
 *  instant switch where the API isn't available (and honours reduced-motion). */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const apply = (next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = !dark;
    setDark(next);

    const root = document.documentElement;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const startViewTransition = (
      document as unknown as { startViewTransition?: (cb: () => void) => void }
    ).startViewTransition?.bind(document);

    if (!startViewTransition || reduce) {
      apply(next);
      return;
    }
    // origin of the reveal = the toggle's center
    const rect = e.currentTarget.getBoundingClientRect();
    root.style.setProperty("--x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--y", `${rect.top + rect.height / 2}px`);
    startViewTransition(() => apply(next));
  };

  if (!mounted) return <span className="size-9" aria-hidden />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid size-9 place-items-center rounded-lg border border-bdr-soft text-content-soft transition-colors hover:text-content-primary hover:bg-surface-base-faint"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
