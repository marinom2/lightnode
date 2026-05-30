"use client";

/**
 * Interactive runner for the `lightnode <command>` read-only catalog. Each
 * card has a Run button that POSTs to /api/sdk-demo and renders the real
 * JSON output in place. Mirrors what the CLI would print, so visitors see
 * the SDK working without installing anything.
 *
 * Two views: a list of commands on the left (radio-style), one detail
 * panel on the right with the args, run button, and output.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlayCircle, Loader2, Copy, Check } from "lucide-react";

interface Command {
  id: string;
  cli: string;
  short: string;
  argLabel: string | null;
  argDefault?: string;
  argPlaceholder?: string;
}

const COMMANDS: Command[] = [
  { id: "network", cli: "lightnode network", short: "Network summary: totals, active workers, jobs, earnings, model count.", argLabel: null },
  { id: "models", cli: "lightnode models", short: "Registered models with fee + token limits + whitelist status.", argLabel: null },
  { id: "analytics", cli: "lightnode analytics", short: "Per-model performance: completion, p50/p95, incomplete.", argLabel: null },
  { id: "reliability", cli: "lightnode reliability", short: "Per-worker reliability over the last 1000 jobs, busiest first.", argLabel: null },
  { id: "fee", cli: "lightnode fee", short: "On-chain inference fee in LCAI. Defaults to llama3-8b.", argLabel: "model tag", argDefault: "llama3-8b", argPlaceholder: "llama3-8b" },
  { id: "worker", cli: "lightnode worker", short: "One worker: on-chain registration + 5 recent jobs.", argLabel: "worker address", argPlaceholder: "0x..." },
  { id: "jobs", cli: "lightnode jobs", short: "One worker's last 100 jobs.", argLabel: "worker address", argPlaceholder: "0x..." },
  { id: "registered", cli: "lightnode registered", short: "On-chain registration boolean (no indexer lag).", argLabel: "worker address", argPlaceholder: "0x..." },
  { id: "job", cli: "lightnode job", short: "One job's status, refundable flag, worker, timings.", argLabel: "job id", argPlaceholder: "1234" },
];

type Net = "mainnet" | "testnet";

export function CliRunner() {
  const [selectedId, setSelectedId] = useState<string>("network");
  const [net, setNet] = useState<Net>("mainnet");
  const [arg, setArg] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const selected = COMMANDS.find((c) => c.id === selectedId) ?? COMMANDS[0];

  // When the user picks a different command, reset the arg field to the
  // default for that command (or empty if no default). Keeps the form sane.
  useEffect(() => {
    setArg(selected.argDefault ?? "");
    setOutput(null);
    setError(null);
  }, [selected.argDefault, selected.id]);

  const fullCli = `${selected.cli}${arg ? ` ${arg}` : ""} --net ${net}`;

  async function run() {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const res = await fetch("/api/sdk-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: selected.id, net, arg: arg || undefined }),
      });
      const text = await res.text();
      if (!res.ok) {
        try {
          const j = JSON.parse(text) as { error?: string };
          setError(j.error ?? text);
        } catch {
          setError(text);
        }
        return;
      }
      setOutput(text);
    } catch (e) {
      setError((e as Error).message ?? "request failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // navigator.clipboard not available in some embedded contexts; ignore silently.
    }
  }

  const needsArg = selected.argLabel != null && !selected.argDefault;
  const argMissing = needsArg && !arg.trim();

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="brand">interactive</Badge>
        <span className="text-sm font-semibold text-content-primary">Run a CLI command from the browser</span>
        <div className="ml-auto inline-flex rounded-lg border border-bdr-soft bg-surface-base-faint p-0.5">
          {(["mainnet", "testnet"] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNet(n)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                net === n ? "bg-card text-content-primary shadow" : "text-content-soft hover:text-content-primary",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        {/* Left rail: command list */}
        <ul className="flex flex-col gap-1">
          {COMMANDS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  selectedId === c.id
                    ? "border-primary/50 bg-primary/5 text-content-primary"
                    : "border-bdr-soft bg-surface-base-faint text-content-soft hover:border-bdr-light hover:text-content-primary",
                )}
              >
                <code className="font-mono text-[11px]">{c.cli}</code>
              </button>
            </li>
          ))}
        </ul>

        {/* Right panel: details + run + output */}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-xs text-content-soft">{selected.short}</p>

          {selected.argLabel ? (
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-content-soft" htmlFor="cli-arg">
                {selected.argLabel}
              </label>
              <input
                id="cli-arg"
                type="text"
                value={arg}
                onChange={(e) => setArg(e.target.value)}
                placeholder={selected.argPlaceholder ?? ""}
                className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-xs text-content-primary outline-none transition-colors focus:border-primary/60"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <code className="overflow-x-auto whitespace-nowrap rounded-md bg-[#0b0b14] px-2 py-1 font-mono text-[11px] text-content-default">
              {fullCli}
            </code>
            <Button size="sm" onClick={run} disabled={busy || argMissing}>
              {busy ? <Loader2 className="animate-spin" /> : <PlayCircle />}
              {busy ? "Running" : "Run"}
            </Button>
          </div>

          {/* Output panel */}
          {output ? (
            <div className="relative">
              <pre className="max-h-[420px] overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[11px] leading-relaxed text-content-default">
                <code>{output}</code>
              </pre>
              <button
                type="button"
                onClick={copyOutput}
                aria-label="Copy output"
                className="absolute right-2 top-2 rounded-md border border-bdr-soft bg-card/80 p-1.5 text-content-soft transition-colors hover:text-content-primary"
              >
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-content-default">
              {error}
            </p>
          ) : null}

          {!output && !error ? (
            <p className="text-[11px] text-content-soft">
              {argMissing
                ? `Enter ${selected.argLabel} above, then hit Run.`
                : "Click Run. The output appears below; it's the same JSON the CLI would print."}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
