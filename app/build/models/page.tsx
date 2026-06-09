"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Loader2, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { Notice } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

interface Choice {
  model: string;
  modelId: string;
  feeLcai: number;
  eligibleWorkers: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
  sampleJobs: number;
}

type Verdict = "opportunity" | "under-served" | "over-served" | "balanced";

function verdictOf(c: Choice): { kind: Verdict; label: string; tone: "good" | "warn" | "default" } {
  const jobsPerWorker = c.eligibleWorkers > 0 ? c.sampleJobs / c.eligibleWorkers : Infinity;
  if (c.eligibleWorkers === 0 && c.sampleJobs > 0) return { kind: "opportunity", label: "Unserved - demand, no eligible workers", tone: "warn" };
  if (jobsPerWorker >= 100) return { kind: "under-served", label: "Under-served - high load/worker, room to add capacity", tone: "good" };
  if (c.eligibleWorkers >= 5 && c.sampleJobs < 10) return { kind: "over-served", label: "Over-served - many workers, thin demand", tone: "warn" };
  return { kind: "balanced", label: "Balanced", tone: "default" };
}

export default function ModelsMapPage() {
  const { network } = useNetwork();
  const [rows, setRows] = useState<Choice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const netLabel = NETWORKS[network].label;

  useEffect(() => {
    let on = true;
    setRows(null);
    setError(null);
    fetch(`/api/operator-preview?action=chooseModel&net=${network}`)
      .then((r) => r.json())
      .then((j: { choices?: Choice[]; error?: string }) => {
        if (!on) return;
        if (j.error || !j.choices) setError(j.error ?? "Could not load the model map.");
        else setRows(j.choices);
      })
      .catch(() => on && setError("Network error reaching the model endpoint."));
    return () => {
      on = false;
    };
  }, [network]);

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Models"
        title="Supply vs demand"
        subtitle={`Per model, live DEMAND (recent jobs, completion, latency) crossed against live SUPPLY (workers on-chain eligible to serve it) into a saturation read - so an operator sees what's under-served (opportunity) vs over-served, and a consumer sees where the redundancy is. Read-only, ${netLabel}.`}
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {!rows && !error && (
          <div className="flex items-center gap-2 text-sm text-content-soft">
            <Loader2 className="size-4 animate-spin" /> Crossing demand against eligible supply on {netLabel}...
          </div>
        )}
        {rows && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 px-1 text-[11px] font-medium uppercase tracking-wide text-content-soft">
              <span className="flex-1">Model</span>
              <span className="w-20 text-right">Demand</span>
              <span className="w-16 text-right">Supply</span>
              <span className="hidden w-20 text-right sm:block">Jobs/wkr</span>
              <span className="hidden w-20 text-right sm:block">Complete</span>
            </div>
            {rows.map((c) => {
              const v = verdictOf(c);
              const jpw = c.eligibleWorkers > 0 ? (c.sampleJobs / c.eligibleWorkers).toFixed(0) : "∞";
              return (
                <div key={c.modelId} className="rounded-xl border border-bdr-soft p-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex-1 font-mono text-content-primary">{c.model}</span>
                    <span className="w-20 text-right tabular-nums text-content-default">{c.sampleJobs} jobs</span>
                    <span className={cn("w-16 text-right tabular-nums", c.eligibleWorkers === 0 ? "text-warning" : "text-content-default")}>{c.eligibleWorkers}</span>
                    <span className="hidden w-20 text-right tabular-nums text-content-soft sm:block">{jpw}</span>
                    <span className="hidden w-20 text-right tabular-nums text-content-soft sm:block">
                      {c.completionRate != null ? `${Math.round(c.completionRate * 100)}%` : "-"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {v.tone === "good" ? (
                      <CheckCircle2 className="size-3.5 text-success" />
                    ) : v.tone === "warn" ? (
                      <AlertTriangle className="size-3.5 text-warning" />
                    ) : (
                      <TrendingUp className="size-3.5 text-content-soft" />
                    )}
                    <span className={cn("text-[11px]", v.tone === "good" ? "text-success" : v.tone === "warn" ? "text-warning" : "text-content-soft")}>{v.label}</span>
                    <span className="ml-auto text-[11px] text-content-soft">{c.feeLcai} LCAI/job{c.p95 != null ? ` · p95 ${c.p95}s` : ""}</span>
                  </div>
                </div>
              );
            })}
            <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-content-soft">
              <LayoutGrid className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Demand is the recent job sample; supply is the count of workers on-chain eligible (WorkerRegistry.isEligible) for each model. A high jobs-per-worker ratio is an operator opportunity; many workers with thin demand means new capacity would starve.
            </p>
          </div>
        )}
      </ConsolePanel>
    </div>
  );
}
