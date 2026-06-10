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
    <section className="overflow-hidden rounded-2xl border border-bdr-soft bg-card/40 backdrop-blur-sm">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-bdr-soft bg-[linear-gradient(180deg,rgba(112,100,233,0.06),transparent)] px-5 py-5 sm:px-6">
        <div className="min-w-0">
          {kicker && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <span className="size-1.5 rounded-full bg-[linear-gradient(94deg,#dd00ac,#7064e9)]" />
              {kicker}
            </p>
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
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
