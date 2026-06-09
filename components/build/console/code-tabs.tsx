"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CodeTab {
  /** Tab label, e.g. "TypeScript", "Python", "curl". */
  label: string;
  code: string;
}

/**
 * A copyable code block with optional language tabs. One tab renders as a plain
 * block with a copy button; multiple tabs render a switcher. Used for snippets
 * across the console (install lines, per-capability examples in TS/Python/curl).
 */
export function CodeTabs({ tabs, className }: { tabs: CodeTab[]; className?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = tabs[Math.min(active, tabs.length - 1)] ?? { label: "", code: "" };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border border-bdr-soft bg-surface-base-faint", className)}>
      <div className="flex items-center justify-between border-b border-bdr-soft px-2 py-1.5">
        <div className="flex items-center gap-1">
          {tabs.length > 1 ? (
            tabs.map((t, i) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  i === active
                    ? "bg-surface-base-light text-content-primary"
                    : "text-content-soft hover:text-content-primary",
                )}
              >
                {t.label}
              </button>
            ))
          ) : (
            <span className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-content-soft">
              {current.label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-content-soft transition-colors hover:text-content-primary"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono text-content-default">{current.code}</code>
      </pre>
    </div>
  );
}
