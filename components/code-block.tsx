"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className={cn("code-surface overflow-hidden rounded-xl border border-bdr-soft", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-bdr-soft px-3 py-1.5">
        <span className="truncate text-xs font-medium text-content-soft">{label ?? "command"}</span>
        <button
          onClick={copy}
          aria-label="Copy to clipboard"
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-bdr-soft bg-surface-base-light px-2 py-1 text-xs text-content-soft transition-colors hover:text-content-primary"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}
