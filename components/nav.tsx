"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@/components/connect-button";
import { NetworkToggle } from "@/components/network-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { isDesktop } from "@/lib/tauri";

const ALL_LINKS = [
  { href: "/onboard", label: "Become a worker" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/network", label: "Network" },
  { href: "/build", label: "Build", webOnly: true },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // SSR-safe: assume web, then drop web-only links once we detect Tauri on mount.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => { setDesktop(isDesktop()); }, []);
  const links = desktop ? ALL_LINKS.filter((l) => !l.webOnly) : ALL_LINKS;

  return (
    <header className="gradient-underline sticky top-0 z-40 border-b border-bdr-soft bg-background/65 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55">
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
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-surface-base-light text-gradient" : "text-content-soft hover:text-content-primary",
                  )}
                >
                  {l.label}
                </Link>
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
