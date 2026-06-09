"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, CheckCircle2, AlertTriangle, Loader2, ArrowRight } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, RunButton, ResponseEmpty, Notice } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

interface Quote {
  model: string;
  modelId: string;
  feeLcai: number;
  maxOutputTokens: number;
  enabled: boolean;
  eligibleWorkers: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
  sampleJobs: number;
  refundWindowSec: number;
  routable: boolean;
  verdict: string;
}

const SNIPPET = `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet");
const q = await ln.preInferenceQuote("llama3-8b");

if (!q.routable) throw new Error(q.verdict);
// fee, redundancy depth, reliability, latency, refund timing - before you spend
console.log(q.feeLcai, q.eligibleWorkers, q.completionRate, q.p95, q.refundWindowSec);`;

function humanizeSec(sec: number): string {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
      <div className="text-[11px] text-content-soft">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-content-primary")}>
        {value}
      </div>
    </div>
  );
}

export default function QuotePage() {
  const { network } = useNetwork();
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the model list for the dropdown on mount / network change.
  useEffect(() => {
    let on = true;
    setModels(null);
    setQuote(null);
    setError(null);
    fetch(`/api/network?net=${network}`)
      .then((r) => r.json())
      .then((j: { models?: { name: string }[] }) => {
        if (!on) return;
        const names = (j.models ?? []).map((m) => m.name).filter(Boolean);
        setModels(names);
        setModel((prev) => (names.includes(prev) ? prev : (names[0] ?? "")));
      })
      .catch(() => on && setModels([]));
    return () => {
      on = false;
    };
  }, [network]);

  const getQuote = useCallback(
    async (tag: string) => {
      if (!tag) return;
      setLoading(true);
      setError(null);
      setQuote(null);
      try {
        const res = await fetch(`/api/operator-preview?action=quote&net=${network}&model=${encodeURIComponent(tag)}`);
        const j = (await res.json()) as { quote?: Quote; error?: string };
        if (!res.ok || j.error || !j.quote) {
          setError(j.error ?? "Could not get a quote.");
          return;
        }
        setQuote(j.quote);
      } catch {
        setError("Network error reaching the quote endpoint.");
      } finally {
        setLoading(false);
      }
    },
    [network],
  );

  const netLabel = NETWORKS[network].label;

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Quote"
        title="Pre-spend quote"
        subtitle={`Before you open a session: the live per-job fee, how many workers are eligible to serve the model RIGHT NOW (redundancy depth), the measured completion rate + latency, and when your fee auto-refunds if a worker stalls - one decision object. Read-only, no wallet, ${netLabel}.`}
      >
        <PanelGrid>
          <PanelColumn title="Request">
            <div className="space-y-4">
              <Field label="Model" hint="Any whitelisted model on the selected network.">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!models || models.length === 0}
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60 disabled:opacity-60"
                >
                  {!models && <option>Loading models...</option>}
                  {models && models.length === 0 && <option>No models found</option>}
                  {models?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-soft">Read-only · {netLabel}</span>
                <RunButton running={loading} disabled={!model} onClick={() => void getQuote(model)} idle="Get quote" busy="Quoting..." />
              </div>
            </div>
          </PanelColumn>

          <PanelColumn title="Quote">
            {!quote && !loading && !error && (
              <ResponseEmpty>Pick a model and Get quote to see whether it&apos;s worth routing to, before spending anything.</ResponseEmpty>
            )}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-content-soft">
                <Loader2 className="size-4 animate-spin" /> Reading fee, eligible workers, reliability...
              </div>
            )}
            {error && <Notice tone="warn">{error}</Notice>}
            {quote && (
              <div className="space-y-3">
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-xl border p-3.5",
                    quote.routable ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
                  )}
                >
                  {quote.routable ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-content-primary">{quote.routable ? "Safe to route" : "Not routable right now"}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-content-default">{quote.verdict}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Fee / job" value={`${quote.feeLcai} LCAI`} />
                  <Stat
                    label="Eligible workers"
                    value={String(quote.eligibleWorkers)}
                    tone={quote.eligibleWorkers === 0 ? "warn" : quote.eligibleWorkers === 1 ? "warn" : "good"}
                  />
                  <Stat
                    label="Completion"
                    value={quote.completionRate != null ? `${Math.round(quote.completionRate * 100)}%` : "-"}
                    tone={quote.completionRate != null && quote.completionRate < 0.85 ? "warn" : "default"}
                  />
                  <Stat label="p50 / p95" value={`${quote.p50 ?? "-"} / ${quote.p95 ?? "-"}s`} />
                  <Stat label="Max output" value={`${quote.maxOutputTokens} tok`} />
                  <Stat label="Refund if stalled" value={`~${humanizeSec(quote.refundWindowSec)}`} />
                </div>
                <p className="text-[11px] text-content-soft">
                  Reliability from the last {quote.sampleJobs} job{quote.sampleJobs === 1 ? "" : "s"} for this model. Eligible-worker count is read live from WorkerRegistry.isEligible.
                </p>
              </div>
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="flex items-center gap-1.5 text-xs text-content-soft">
          <ArrowRight className="size-3.5 text-primary" />
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">ln.preInferenceQuote(tag)</code> - route only when{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">q.routable</code> is true.
        </p>
      </section>
    </div>
  );
}
