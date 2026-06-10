"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONSOLE_NAV, type ConsoleNavItem } from "./nav-config";

/** Is this nav item the active route? Overview matches exactly; everything else
 *  matches itself or any deeper sub-route. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/build") return pathname === "/build";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavRow({ item, active, onNavigate }: { item: ConsoleNavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  if (item.ready === false) {
    return (
      <span
        className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content-soft/50"
        title="Coming soon"
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="rounded-full border border-bdr-soft px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-content-soft/60">
          soon
        </span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-content-primary"
          : "text-content-soft hover:bg-surface-base-faint hover:text-content-primary",
      )}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-primary" />}
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-content-soft group-hover:text-primary")} />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

function NavTree({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {CONSOLE_NAV.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-content-soft/70">
            {section.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavRow key={item.label} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * The BUILD developer-console shell: a sticky left rail of runnable capabilities
 * + reference, with the page content in the main column. On mobile the rail
 * collapses into a drawer. Sits below the global site nav (h-16).
 */
export function BuildShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Branded ambient gradient backdrop. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-12%] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(112,100,233,0.16),transparent_70%)] blur-3xl" />
        <div className="absolute left-[-6%] top-[34%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(221,0,172,0.10),transparent_70%)] blur-3xl" />
        <div className="absolute right-[-4%] top-[8%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(79,124,246,0.10),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[40%] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(113,48,195,0.10),transparent_70%)] blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-5">
      {/* Mobile: a bar that opens the console drawer. */}
      <div className="flex items-center justify-between gap-3 py-3 md:hidden">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-content-primary">
          <Terminal className="size-4 text-primary" /> Build console
        </span>
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-label="Toggle console menu"
          aria-expanded={drawerOpen}
          className="grid size-9 place-items-center rounded-lg border border-bdr-soft text-content-soft"
        >
          {drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {drawerOpen && (
        <div className="mb-4 rounded-2xl border border-bdr-soft bg-card/80 p-3 backdrop-blur-sm md:hidden">
          <NavTree pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
        </div>
      )}

      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
        {/* Desktop sticky rail. */}
        <aside className="hidden md:block">
          <div className="sticky top-[4.5rem] max-h-[calc(100vh-5.5rem)] overflow-y-auto py-8 pr-2">
            <p className="mb-4 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-wider text-content-soft">
              <Terminal className="size-3.5 text-primary" /> Build console
            </p>
            <NavTree pathname={pathname} />
          </div>
        </aside>

        {/* Main content column. */}
        <div className="min-w-0 pb-16 md:py-8">{children}</div>
      </div>
      </div>
    </>
  );
}
