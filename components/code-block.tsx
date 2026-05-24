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
    <div className={cn("group relative overflow-hidden rounded-xl border border-bdr-soft bg-[#0b0b14]", className)}>
      {label && (
        <div className="flex items-center justify-between border-b border-bdr-soft px-4 py-2">
          <span className="text-xs font-medium text-content-soft">{label}</span>
        </div>
      )}
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-bdr-soft bg-surface-base-light px-2 py-1 text-xs text-content-soft opacity-0 transition-opacity hover:text-content-primary group-hover:opacity-100"
        style={label ? { top: "2.5rem" } : undefined}
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-content-default">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}
