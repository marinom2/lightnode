"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@/components/connect-button";
import { NetworkToggle } from "@/components/network-toggle";

const links = [
  { href: "/onboard", label: "Become a worker" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-bdr-soft bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-primary text-white">
            <Cpu className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-content-primary">
            Light<span className="text-gradient">Node</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith(l.href)
                  ? "bg-surface-base-light text-content-primary"
                  : "text-content-soft hover:text-content-primary",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <NetworkToggle />
          <ConnectButton size="sm" />
        </div>
      </div>
    </header>
  );
}
