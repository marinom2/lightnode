"use client";

import { useEffect, useState } from "react";
import { Landmark, Loader2, Coins, Percent } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { Notice } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

interface FeeFlow {
  feeBps: { worker: number; protocol: number; feePool: number };
  revenue: {
    totalGrossLcai: number;
    protocolLcai: number;
    feePoolLcai: number;
    workerLcai: number;
    settledCount: number;
    refundedCount: number;
    captureRate: number | null;
    spanSec: number;
    perDay: { grossLcai: number; protocolLcai: number; feePoolLcai: number };
    perModel: { modelId: string; name: string; settled: number; grossLcai: number }[];
  };
  feePoolLcai: number | null;
  treasuryLcai: number | null;
  sampled: number;
}

function lcai(n: number, dp = 2): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: dp }) : "-";
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3.5">
      <div className="text-[11px] text-content-soft">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-content-primary")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-content-soft">{sub}</div>}
    </div>
  );
}

export default function RevenuePage() {
  const { network } = useNetwork();
  const [data, setData] = useState<FeeFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const netLabel = NETWORKS[network].label;

  useEffect(() => {
    let on = true;
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/api/fee-flow?net=${network}`)
      .then((r) => r.json())
      .then((j: (FeeFlow & { ok: true }) | { ok: false; error: string }) => {
        if (!on) return;
        if (!j.ok) setError(j.error);
        else setData(j);
      })
      .catch(() => on && setError("Could not reach the fee-flow endpoint."))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [network]);

  const r = data?.revenue;
  const runRate = r ? r.perDay.protocolLcai * 365 : 0;

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Protocol · Revenue"
        title="Protocol fee revenue & FeePool flow"
        subtitle={`Network-wide economic flow reconstructed from the last settled jobs and the live fee split: the protocol + fee-pool cut of every paid job, the run-rate, the fee-capture rate, and the live FeePool + Treasury balances. Read-only, ${netLabel}.`}
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-content-soft">
            <Loader2 className="size-4 animate-spin" /> Reconstructing revenue from {netLabel}...
          </div>
        )}
        {data && r && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Protocol / day" value={`${lcai(r.perDay.protocolLcai)} LCAI`} tone="good" sub={`over a ${(r.spanSec / 86400).toFixed(1)}d sample`} />
              <Stat label="Protocol / week" value={`${lcai(r.perDay.protocolLcai * 7)} LCAI`} />
              <Stat label="Annualized run-rate" value={`${lcai(runRate, 0)} LCAI`} tone="good" />
              <Stat label="Fee capture" value={r.captureRate != null ? `${Math.round(r.captureRate * 100)}%` : "-"} tone={r.captureRate != null && r.captureRate < 0.85 ? "warn" : "default"} sub={`${r.settledCount} paid / ${r.refundedCount} refunded`} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Gross fees (sample)" value={`${lcai(r.totalGrossLcai)} LCAI`} />
              <Stat label="Protocol cut" value={`${lcai(r.protocolLcai)} LCAI`} sub={`${data.feeBps.protocol / 100}%`} />
              <Stat label="Fee pool cut" value={`${lcai(r.feePoolLcai)} LCAI`} sub={`${data.feeBps.feePool / 100}%`} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat label="FeePool balance (live)" value={data.feePoolLcai != null ? `${lcai(data.feePoolLcai)} LCAI` : "n/a"} sub="accumulated, on-chain" />
              <Stat label="Treasury balance (live)" value={data.treasuryLcai != null ? `${lcai(data.treasuryLcai)} LCAI` : "n/a"} sub="DAO-controlled, on-chain" />
            </div>

            {r.perModel.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Gross fees by model (sample)</p>
                <div className="divide-y divide-bdr-light overflow-hidden rounded-xl border border-bdr-soft">
                  {r.perModel.map((m) => (
                    <div key={m.modelId} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                      <Coins className="size-3.5 text-primary" />
                      <span className="font-mono text-content-primary">{m.name}</span>
                      <span className="text-[11px] text-content-soft">{m.settled} paid</span>
                      <span className="ml-auto tabular-nums font-medium text-content-default">{lcai(m.grossLcai)} LCAI</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-content-soft">
              <Percent className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Revenue is reconstructed from {r.settledCount + r.refundedCount} decided jobs in the last {data.sampled}-job sample, split by the live AIConfig fee bps. Per-day figures use the sample&apos;s actual time span, not a fixed window.
            </p>
          </div>
        )}
      </ConsolePanel>

      <section className="space-y-2 text-xs text-content-soft">
        <div className="flex items-center gap-2">
          <Landmark className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">How it&apos;s built</h2>
        </div>
        <p>
          Every settled job&apos;s gross fee (from the on-chain model registry) is split by the live fee bps into worker / protocol / fee-pool cuts; timed-out and disputed jobs earned nothing (refunded). The FeePool and Treasury balances are read directly from their on-chain addresses.
        </p>
      </section>
    </div>
  );
}
