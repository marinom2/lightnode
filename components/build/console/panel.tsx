import type { ReactNode } from "react";

/**
 * Standard header + body frame for a console surface (overview, capability
 * panels, reference). Keeps every page in the console visually consistent: a
 * small-caps kicker, a title (optionally with a gradient accent passed as a
 * node), a subtitle, optional right-aligned actions, then the body.
 */
export function ConsolePanel({
  kicker,
  title,
  subtitle,
  actions,
  children,
}: {
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-primary">{kicker}</p>
          )}
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-content-primary sm:text-3xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-content-soft">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
