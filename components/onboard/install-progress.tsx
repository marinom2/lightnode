"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, Loader2, X, Terminal, AlertTriangle, KeyRound, ArrowDownToLine } from "lucide-react";
import { deriveInstallView, diagnoseFailure, type RunPhase, type StepStatus } from "@/lib/install-progress";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <Check className="size-3.5" />
      </span>
    );
  if (status === "active")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="size-3.5 animate-spin" />
      </span>
    );
  if (status === "error")
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive">
        <X className="size-3.5" />
      </span>
    );
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-bdr-soft">
      <span className="size-1.5 rounded-full bg-content-soft/50" />
    </span>
  );
}

/**
 * Install progress as a short milestone checklist + a download bar, with the raw
 * terminal log tucked behind a "technical details" disclosure (auto-opened only
 * when something fails). `log` must already be cleaned via appendCleanLog so the
 * disclosure never shows ANSI/spinner spam.
 */
export function InstallProgress({ log, phase }: { log: string[]; phase: RunPhase }) {
  const view = deriveInstallView(log, phase);
  const failureHint = phase === "failed" ? diagnoseFailure(log) : null;
  // When install hits the keystore-password-mismatch sentinel, the diagnoser
  // text already mentions Recover; surface a direct click-through so the user
  // doesn't have to leave onboarding to find it on the dashboard.
  const isKeystoreMismatch = phase === "failed" && log.some((l) => /keystore-password-mismatch/i.test(l));
  const logBox = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const onLogScroll = () => {
    const el = logBox.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useEffect(() => {
    const el = logBox.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div className="space-y-4">
      <ol className="space-y-2.5">
        {view.milestones.map((m) => (
          <li key={m.id} className="flex items-center gap-3">
            <StepIcon status={m.status} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm transition-colors",
                  m.status === "done"
                    ? "text-content-default"
                    : m.status === "active"
                      ? "font-medium text-content-primary"
                      : m.status === "error"
                        ? "font-medium text-destructive"
                        : "text-content-soft",
                )}
              >
                {m.label}
                {m.detail && <span className="ml-1.5 tabular-nums text-content-soft">({m.detail})</span>}
              </div>
              {m.id === "model" && m.status === "active" && view.download != null && (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
                  <div
                    className="h-full rounded-full bg-gradient-primary transition-[width] duration-500"
                    style={{ width: `${view.download}%` }}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {failureHint && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3 text-xs leading-relaxed text-content-default">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{failureHint}</span>
        </div>
      )}

      {phase === "failed" && (
        // Action surface for the operator after a failure: refund the worker
        // wallet straight from here (the most common ask after a failed install),
        // and - when the failure was specifically a keystore-password mismatch -
        // a direct entry into the Recover flow. Both land on the dashboard
        // where the existing flows live, so we never duplicate the signing UI.
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-1.5 font-medium text-content-default transition-colors hover:border-primary/40 hover:text-primary"
          >
            <ArrowDownToLine className="size-3.5" /> Withdraw funds to your wallet
          </Link>
          {isKeystoreMismatch && (
            <Link
              href="/recover"
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <KeyRound className="size-3.5" /> Recover a replaced key
            </Link>
          )}
        </div>
      )}

      {log.length > 0 && (
        <details className="group" open={phase === "failed"}>
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-content-soft transition-colors hover:text-content-default">
            <Terminal className="size-3" /> Technical details
          </summary>
          <div
            ref={logBox}
            onScroll={onLogScroll}
            className="mt-2 max-h-56 overflow-auto overscroll-contain rounded-xl border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[11px] leading-relaxed text-content-default"
          >
            {log.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {l}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
