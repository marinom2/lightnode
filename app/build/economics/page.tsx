"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, TrendingUp, Loader2 } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, Notice } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

interface EconModel {
  id: string;
  name: string;
  feeLcai: number;
  maxOutputTokens: number;
  enabled: boolean;
  recentJobs: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
}
type Mode = "operator" | "consumer";
interface EconData {
  gasPerJobLcai: number;
  config: {
    minStakeLcai: number;
    workerFeeBps: number;
    protocolFeeBps: number;
    feePoolBps: number;
    completionTimeoutBps: number;
    maxSlashBps: number;
  };
  network: { activeWorkers: number | null; totalWorkers: number | null; jobsCompleted: number | null };
  models: EconModel[];
}

const SNIPPET = `import { WorkerOperator } from "lightnode-sdk";

const op = new WorkerOperator("mainnet", { publicClient });

// Live fee split + model fee minus an estimated gas cost per job.
const p = await op.profitability({ modelTag: "llama3-8b", jobsPerDay: 100 });
console.log(p.workerFeeLcaiPerJob, p.netLcaiPerJob, p.projectedDailyLcai);`;

function lcai(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
      <div className="text-[11px] text-content-soft">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-content-primary",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-content-soft">{sub}</div>}
    </div>
  );
}

function ConsumerView({
  model,
  c,
  jobsPerDay,
}: {
  model: EconModel;
  c: { costPerCall: number; txGasLcai: number; per1k: number; perDay: number; perMonth: number; reuseSavingPerDay: number };
  jobsPerDay: number;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Cost / call" value={`${lcai(c.costPerCall)} LCAI`} />
        <Stat label="Cost / 1k calls" value={`${lcai(c.per1k, 2)} LCAI`} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={`Cost / day (${jobsPerDay.toLocaleString()} calls)`} value={`${lcai(c.perDay, 2)} LCAI`} />
        <Stat label="Cost / month" value={`${lcai(c.perMonth, 0)} LCAI`} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Fee / call" value={`${lcai(model.feeLcai)} LCAI`} sub="paid to the worker pool" />
        <Stat label="Gas / call (2 txs)" value={`~${lcai(c.txGasLcai)} LCAI`} sub="createSession + submitJob" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Per-call wall-clock"
          value={model.p95 != null ? `~${model.p95}s p95` : model.p50 != null ? `~${model.p50}s p50` : "-"}
          sub="answer latency + 2 confirmations"
        />
        <Stat label="Session-reuse saving / day" value={`${lcai(c.reuseSavingPerDay)} LCAI`} sub="Conversation signs createSession once" tone="good" />
      </div>
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-content-soft">
        <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-primary" />
        The consumer pays the full model fee per call (the submitJob value) plus tiny gas for the two signed txs. A reused session (Conversation) signs createSession once, so multi-turn chats save the per-call session gas.
      </p>
    </div>
  );
}

export default function EconomicsPage() {
  const { network } = useNetwork();
  const [data, setData] = useState<EconData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelId, setModelId] = useState<string>("");
  const [jobsPerDay, setJobsPerDay] = useState(100);
  const [mode, setMode] = useState<Mode>("operator");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/operator-preview?action=economics&net=${network}`);
      const d = (await res.json()) as (EconData & { action: string }) | { error: string };
      if ("error" in d) {
        setError(d.error);
        return;
      }
      setData(d);
      setModelId((prev) => (d.models.some((m) => m.id === prev) ? prev : (d.models[0]?.id ?? "")));
    } catch {
      setError("Could not reach the economics endpoint. Try again.");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    void load();
  }, [load]);

  const model = useMemo(() => data?.models.find((m) => m.id === modelId) ?? null, [data, modelId]);

  const calc = useMemo(() => {
    if (!data || !model) return null;
    const { config, gasPerJobLcai } = data;
    const workerFeePerJob = model.feeLcai * (config.workerFeeBps / 10000);
    const netPerJob = workerFeePerJob - gasPerJobLcai;
    const dailyNet = netPerJob * jobsPerDay;
    const monthlyNet = dailyNet * 30;
    const annualNet = dailyNet * 365;
    const yieldPct = config.minStakeLcai > 0 ? (annualNet / config.minStakeLcai) * 100 : 0;
    const slashPerTimeout = config.minStakeLcai * (config.completionTimeoutBps / 10000);
    return { workerFeePerJob, netPerJob, dailyNet, monthlyNet, annualNet, yieldPct, slashPerTimeout };
  }, [data, model, jobsPerDay]);

  // Consumer spend: the caller pays the FULL model fee per call (the submitJob
  // value) plus gas for the two user-signed txs. Session reuse (Conversation)
  // signs createSession once instead of per call.
  const consumer = useMemo(() => {
    if (!data || !model) return null;
    const txGasLcai = data.gasPerJobLcai; // ~gas for createSession + submitJob
    const costPerCall = model.feeLcai + txGasLcai;
    const perDay = costPerCall * jobsPerDay;
    return {
      costPerCall,
      txGasLcai,
      per1k: costPerCall * 1000,
      perDay,
      perMonth: perDay * 30,
      // Multi-turn: createSession amortised once over the day's calls -> the
      // per-call gas (roughly half of txGasLcai) is saved on all but the first.
      reuseSavingPerDay: jobsPerDay > 1 ? (txGasLcai / 2) * (jobsPerDay - 1) : 0,
    };
  }, [data, model, jobsPerDay]);

  const netLabel = NETWORKS[network].label;

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Economics"
        title={mode === "operator" ? "Worker earnings & ROI" : "Consumer cost planner"}
        subtitle={
          mode === "operator"
            ? `Project what a worker earns from the live protocol economics - the AIConfig fee split, the on-chain model fee, the stake floor, and your assumed throughput. Live from ${netLabel}.`
            : `Budget a user-pays inference feature: the LCAI cost per call / 1k / month at the live model fee, the per-call confirmation wall-clock, and the session-reuse saving. Live from ${netLabel}.`
        }
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-content-soft">
            <Loader2 className="size-4 animate-spin" /> Reading live economics from {netLabel}...
          </div>
        )}

        {data && (
          <div className="mb-5 inline-flex rounded-lg border border-bdr-soft p-0.5 text-sm">
            {(["operator", "consumer"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors",
                  mode === m ? "bg-primary/10 text-content-primary" : "text-content-soft hover:text-content-primary",
                )}
              >
                {m === "operator" ? "Operator ROI" : "Consumer cost"}
              </button>
            ))}
          </div>
        )}

        {data && model && calc && consumer && (
          <PanelGrid>
            <PanelColumn title="Assumptions">
              <div className="space-y-4">
                <Field label="Model" hint={`Fee ${lcai(model.feeLcai)} LCAI/job · worker keeps ${data.config.workerFeeBps / 100}%`}>
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60"
                  >
                    {data.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({lcai(m.feeLcai)} LCAI{m.enabled ? "" : " · disabled"})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label={`${mode === "operator" ? "Jobs" : "Calls"} per day: ${jobsPerDay.toLocaleString()}`}
                  hint={
                    model.completionRate != null
                      ? `Your ${mode === "operator" ? "throughput" : "volume"} assumption. This model's recent network completion rate is ${(model.completionRate * 100).toFixed(0)}%${model.p50 != null ? ` at ${model.p50}s p50` : ""}.`
                      : `Your ${mode === "operator" ? "throughput" : "volume"} assumption.`
                  }
                >
                  <input
                    type="range"
                    min={0}
                    max={2000}
                    step={10}
                    value={Math.min(2000, jobsPerDay)}
                    onChange={(e) => setJobsPerDay(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <input
                    type="number"
                    min={0}
                    value={jobsPerDay}
                    onChange={(e) => setJobsPerDay(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-2 w-32 rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-1.5 text-sm tabular-nums text-content-primary outline-none focus:border-primary/60"
                  />
                </Field>

                <div className="rounded-xl border border-bdr-soft p-3 text-xs text-content-soft">
                  <p className="mb-1.5 font-semibold uppercase tracking-wider text-content-soft/80">Fee split (AIConfig)</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>worker {data.config.workerFeeBps / 100}%</span>
                    <span>protocol {data.config.protocolFeeBps / 100}%</span>
                    <span>fee pool {data.config.feePoolBps / 100}%</span>
                  </div>
                  <p className="mt-2">
                    Gas est. {lcai(data.gasPerJobLcai)} LCAI/job · stake floor {data.config.minStakeLcai.toLocaleString()} LCAI
                    {data.network.activeWorkers != null && ` · ${data.network.activeWorkers} active workers`}
                  </p>
                </div>
              </div>
            </PanelColumn>

            <PanelColumn title={mode === "operator" ? "Operator ROI" : "Consumer cost"}>
              {mode === "consumer" ? (
                <ConsumerView model={model} c={consumer} jobsPerDay={jobsPerDay} />
              ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Net / day" value={`${lcai(calc.dailyNet, 2)} LCAI`} tone={calc.dailyNet >= 0 ? "good" : "warn"} />
                  <Stat label="Net / month" value={`${lcai(calc.monthlyNet, 0)} LCAI`} tone={calc.monthlyNet >= 0 ? "good" : "warn"} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Worker fee / job" value={lcai(calc.workerFeePerJob)} />
                  <Stat label="Gas / job" value={lcai(data.gasPerJobLcai)} />
                  <Stat label="Net / job" value={lcai(calc.netPerJob)} tone={calc.netPerJob >= 0 ? "good" : "warn"} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Annual yield on stake"
                    value={`${lcai(calc.yieldPct, 1)}%`}
                    sub={`${lcai(calc.annualNet, 0)} LCAI/yr on a ${data.config.minStakeLcai.toLocaleString()} LCAI stake`}
                    tone={calc.yieldPct >= 0 ? "good" : "warn"}
                  />
                  <Stat
                    label="Slash per timeout"
                    value={`-${lcai(calc.slashPerTimeout, 0)} LCAI`}
                    sub={`${data.config.completionTimeoutBps / 100}% of stake if a job times out`}
                    tone="warn"
                  />
                </div>
                {calc.netPerJob < 0 && (
                  <Notice tone="warn">
                    At this model fee the worker share ({lcai(calc.workerFeePerJob)} LCAI) is below the estimated gas per job - net is negative. Pick a higher-fee model or a cheaper gas assumption.
                  </Notice>
                )}
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-content-soft">
                  <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  Earnings are net of gas only. Stake is locked, not spent - it is returned on exit unless slashed. Yield assumes the stake floor; staking more does not increase per-job pay.
                </p>
              </div>
              )}
            </PanelColumn>
          </PanelGrid>
        )}
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Calculator className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Same numbers, in code - <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">op.profitability(&#123; modelTag, jobsPerDay &#125;)</code> reads the live AIConfig fee split and model fee.
        </p>
      </section>
    </div>
  );
}
