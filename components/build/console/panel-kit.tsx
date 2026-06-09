"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for a capability panel. Every panel follows the same
 * shape - a Request column and a Response column - so the console feels like one
 * tool, not a pile of one-off widgets.
 */

/** Two-column console body: request (left) | response (right). Stacks on mobile. */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-2">{children}</div>;
}

/** A titled column card (the request or response side). */
export function PanelColumn({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-2xl border border-bdr-soft bg-card/60 backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-bdr-soft px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-content-soft">{title}</span>
        {badge}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

/** A labeled form field with an optional hint under it. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-content-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-content-soft/80">{hint}</span>}
    </label>
  );
}

/** The primary run control, with idle/running states and a leading icon. */
export function RunButton({
  running,
  disabled,
  onClick,
  idle = "Run",
  busy = "Running...",
}: {
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
  idle?: string;
  busy?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[linear-gradient(94deg,#dd00ac_0%,#7130c3_38%,#7064e9_68%,#4f7cf6_100%)] bg-[length:200%_auto] bg-[position:left_center] px-4 text-sm font-medium tracking-[0.3px] text-white transition-all duration-300 hover:bg-[position:right_center] hover:brightness-110 hover:shadow-[0_0_28px_-2px_rgba(112,100,233,0.6)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
    >
      {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      {running ? busy : idle}
    </button>
  );
}

/** Dashed empty state for the response column before a run. */
export function ResponseEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[8rem] place-items-center rounded-xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
      {children}
    </div>
  );
}

/** One on-chain / metadata proof row: label + mono value, optional explorer link. */
export function ProofRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-xs">
      <span className="w-24 shrink-0 text-content-soft">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 break-all font-mono text-primary hover:underline"
        >
          {value} <ArrowUpRight className="size-3" />
        </a>
      ) : (
        <span className="break-all font-mono text-content-default">{value}</span>
      )}
    </div>
  );
}

/** Short address/hash for display. */
export function short(v: string, head = 6, tail = 4): string {
  if (v.length <= head + tail + 1) return v;
  return `${v.slice(0, head)}...${v.slice(-tail)}`;
}

/** A small inline error/notice block. */
export function Notice({ tone = "error", children }: { tone?: "error" | "warn"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-3 text-sm leading-relaxed",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-content-default"
          : "border-warning/30 bg-warning/5 text-content-default",
      )}
    >
      {children}
    </div>
  );
}
