"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  ChevronDown,
  Database,
  FileText,
  Globe,
  Menu,
  Rocket,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@/components/connect-button";
import { NetworkToggle } from "@/components/network-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDesktop } from "@/lib/tauri";

type IconType = typeof Boxes;

interface NavItem {
  href: string;
  label: string;
  webOnly?: boolean;
  /** When present, this nav item is a dropdown; the array describes the menu items. */
  children?: Array<{
    href: string;
    label: string;
    desc: string;
    icon: IconType;
  }>;
}

const ALL_LINKS: NavItem[] = [
  { href: "/learn", label: "How it works", webOnly: true },
  { href: "/onboard", label: "Run a worker" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/network", label: "Network" },
  { href: "/wallet", label: "Wallet", webOnly: true },
  {
    href: "/build",
    label: "Build",
    webOnly: true,
    children: [
      { href: "/build", label: "Console overview", desc: "Runnable capabilities + quickstart", icon: Rocket },
      { href: "/build/inference", label: "Inference", desc: "Encrypted prompt to a verifiable answer", icon: Sparkles },
      { href: "/build/worker", label: "Worker ops", desc: "Status, settle, stuck-job recovery, exit", icon: Server },
      { href: "/build/network", label: "Live network", desc: "Workers, models, jobs in real time", icon: Globe },
      { href: "/build/reference", label: "Reference", desc: "Methods, contracts, networks, changelog", icon: Database },
      { href: "/build/cli", label: "CLI", desc: "Run lightnode commands interactively", icon: FileText },
    ],
  },
];

/**
 * Desktop dropdown anchored to a parent nav item. Closes on outside click,
 * Escape, and route change. Mobile renders the same children as a flat list
 * inside the burger menu so we don't ship two info architectures.
 */
function DesktopDropdown({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  // Hover-to-open with a short close delay (so the cursor can travel across
  // the small gap between the trigger and the panel without dismissing).
  // Click still works as a fallback for keyboard / touch.
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active ? "text-gradient" : "text-content-soft hover:text-content-primary",
        )}
      >
        {item.label}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {active && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-gradient-primary" />}
      </button>

      {open && item.children ? (
        <div
          role="menu"
          // bg-card/95 is already all but opaque, so backdrop-blur-xl bought
          // almost nothing visually while still forcing a filtered layer.
          className="absolute left-1/2 top-full z-50 mt-2 w-[420px] -translate-x-1/2 rounded-xl border border-bdr-soft bg-card/95 p-1.5 shadow-xl"
        >
          {item.children.map((c) => (
            <Link
              key={c.href}
              role="menuitem"
              href={c.href}
              className={cn(
                "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                pathname === c.href
                  ? "bg-primary/10"
                  : "hover:bg-surface-base-faint",
              )}
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-bdr-soft bg-surface-base-faint text-content-soft transition-colors group-hover:border-primary/40 group-hover:text-primary">
                <c.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-content-primary">{c.label}</span>
                <span className="block text-[11px] text-content-soft">{c.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(isDesktop());
  }, []);
  const links = desktop ? ALL_LINKS.filter((l) => !l.webOnly) : ALL_LINKS;

  // The header carries no backdrop-blur, deliberately. It is `sticky`, so the
  // content behind it changes on every scroll frame - which means a
  // backdrop-filter has to re-sample and re-blur the full width of the viewport
  // 60 times a second. On a 4K display that is ~3840px of blur per frame, and
  // WebKitGTK (what the desktop app renders with) is markedly slower at it than
  // Chromium. It was the largest single cause of scroll jank in the desktop
  // app, and invisible in profiles taken at rest: idle cost was zero.
  //
  // An opaque background lands within a hair of the same look on a dark theme
  // for no per-frame cost. Blur is still fine on surfaces that do not sit over
  // moving content - the dropdown above only exists while it is open.
  return (
    <header className="gradient-underline sticky top-0 z-40 border-b border-bdr-soft bg-background/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="group flex items-center gap-2" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/lightnode-mark.png"
            alt="LightNode"
            className="size-9 transition-transform group-hover:scale-105"
          />
          <span className="text-[15px] font-semibold tracking-tight text-content-primary">
            Light<span className="text-gradient">Node</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => {
            const active = pathname.startsWith(l.href);
            if (l.children) {
              return <DesktopDropdown key={l.href} item={l} active={active} />;
            }
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-gradient" : "text-content-soft hover:text-content-primary",
                )}
              >
                {l.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-gradient-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <NetworkToggle />
          <div className="hidden sm:block">
            <ConnectButton size="sm" />
          </div>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={open}
            className="grid size-9 place-items-center rounded-lg border border-bdr-soft text-content-soft md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-bdr-soft bg-background/95 px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <div key={l.href} className="flex flex-col">
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "bg-surface-base-light text-gradient" : "text-content-soft hover:text-content-primary",
                    )}
                  >
                    {l.label}
                  </Link>
                  {l.children
                    ? l.children
                        .filter((c) => c.href !== l.href)
                        .map((c) => (
                          <Link
                            key={c.href}
                            href={c.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "ml-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors",
                              pathname === c.href ? "text-content-primary" : "text-content-soft hover:text-content-primary",
                            )}
                          >
                            <c.icon className="size-3.5" />
                            {c.label}
                          </Link>
                        ))
                    : null}
                </div>
              );
            })}
          </nav>
          <div className="mt-3 sm:hidden">
            <ConnectButton size="sm" />
          </div>
        </div>
      )}
    </header>
  );
}
