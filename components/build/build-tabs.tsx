"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Database, FileText, Globe, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact sub-page tab bar that sits under the navbar across the entire
 * `/build` family. Mirrors the dropdown in the main nav so a visitor who
 * landed on one sub-page can jump between siblings without going back to
 * the main menu.
 */
const TABS = [
  { href: "/build", label: "Get started", icon: Rocket },
  { href: "/build/sdks", label: "SDK modules", icon: Boxes },
  { href: "/build/cli", label: "CLI", icon: FileText },
  { href: "/build/network", label: "Live network", icon: Globe },
  { href: "/build/reference", label: "Reference", icon: Database },
] as const;

export function BuildTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-8 -mt-3 overflow-x-auto">
      <div className="inline-flex min-w-full items-center gap-1 rounded-xl border border-bdr-soft bg-surface-base-subtle/40 p-1">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-card text-content-primary shadow-sm"
                  : "text-content-soft hover:text-content-primary",
              )}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
