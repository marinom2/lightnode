"use client";

/**
 * Worker "action center" + earnings analytics, both driven by the read-only SDK
 * action center (LightNode.getWorkerActions, surfaced via /api/worker). The panel
 * answers "what should I do right now" - including the worker-wallet gas balance
 * that silently blocks settle/claim/deregister when it is empty - and a one-click
 * diagnostics report. The analytics panel summarizes reliability and settlement
 * from the worker's job history.
 */
import { useState } from "react";
import { AlertTriangle, Coins, Clock, CheckCircle2, Activity, Copy, Check, ListChecks, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, cn } from "@/lib/utils";
import { classifyJobs } from "@/lib/analytics";
import { buildDiagnosticsReport } from "@/lib/diagnostics";
import type { Job } from "@/lib/subgraph";
import type { WorkerActionCenter, WorkerAction } from "lightnode-sdk";

/** Read-only profitability for the worker's primary served model (from /api/worker). */
export interface WorkerProfitability {
  workerFeeLcaiPerJob: number;
  gasLcaiPerJob: number;
  netLcaiPerJob: number;
  breakEvenJobsPerDay: number | null;
  projectedDailyLcai: number | null;
  modelName: string;
  jobsPerDay: number;
}

const URGENCY_TONE: Record<WorkerAction["urgency"], "danger" | "warning" | "brand"> = {
  critical: "danger",
  warning: "warning",
  info: "brand",
};

function ActionRow({ action }: { action: WorkerAction }) {
  const Icon = action.urgency === "critical" ? AlertTriangle : action.urgency === "warning" ? Clock : CheckCircle2;
  const color =
    action.urgency === "critical" ? "text-danger" : action.urgency === "warning" ? "text-warning" : "text-primary";
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-content-primary">{action.title}</div>
        <div className="text-xs leading-relaxed text-content-soft">{action.detail}</div>
      </div>
    </li>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold", tone ?? "text-content-primary")}>{value}</div>
    </div>
  );
}

/**
 * The action center: a prioritized to-do list plus the four numbers that decide
 * it (claimable, wallet gas, settle-now, in-window), with an out-of-gas alert and
 * a copy-diagnostics button. Renders nothing when there is genuinely nothing to
 * surface (no actions and nothing claimable).
 */
export function ActionCenterPanel({ actions, jobs }: { actions: WorkerActionCenter | null | undefined; jobs: Job[] }) {
  const [copied, setCopied] = useState(false);
  if (!actions) return null;
  const a = actions;
  // Nothing worth showing: no to-do items, nothing claimable, wallet has gas.
  if (a.actions.length === 0 && a.claimableLcai === 0 && !a.outOfGas) return null;

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticsReport(a, jobs));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked - ignore */
    }
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-bdr-light px-6 py-4">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-content-soft" />
          <h3 className="text-sm font-semibold text-content-primary">Action center</h3>
        </div>
        <Button variant="outline" size="sm" onClick={copyReport} title="Copy a diagnostics report">
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Diagnostics"}
        </Button>
      </div>

      {a.outOfGas && a.actions.some((x) => x.kind === "fund-gas") && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/5 px-6 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-sm text-content-soft">
            <span className="font-medium text-content-primary">Worker wallet is out of gas.</span> It holds ~
            {a.walletGasLcai} LCAI. Settle, claim, and deregister are all paid from it, so they will fail until you send a
            little LCAI to <span className="font-mono text-xs">{a.address}</span>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y divide-bdr-light sm:grid-cols-4 sm:divide-y-0">
        <StatTile label="Claimable" value={`${fmt(a.claimableLcai, 3)} LCAI`} tone={a.claimableLcai > 0 ? "text-success" : undefined} />
        <StatTile label="Wallet gas" value={`${a.walletGasLcai} LCAI`} tone={a.outOfGas ? "text-danger" : undefined} />
        <StatTile label="Settle now" value={fmt(a.settlement.releasableNowCount, 0)} tone={a.settlement.releasableNowCount > 0 ? "text-primary" : undefined} />
        <StatTile label="In dispute window" value={fmt(a.settlement.inWindowCount, 0)} />
      </div>

      {a.actions.length > 0 && (
        <ul className="space-y-3 border-t border-bdr-light px-6 py-4">
          {a.actions.map((action, i) => (
            <ActionRow key={`${action.kind}-${i}`} action={action} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function meter(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "-";
}

/**
 * Per-job processing time (acknowledged -> completed) against the on-chain
 * deadline, newest jobs on the right. The dashed line is the deadline; bars are
 * green/amber/red by how close each job ran to it - the at-a-glance "am I going
 * to start timing out" signal. Pure SVG, no chart dependency.
 */
function ProcessingTimeChart({ jobs, deadlineSec }: { jobs: Job[]; deadlineSec: number }) {
  const points = jobs
    .filter((j) => j.ack_at != null && j.completed_at != null && j.completed_at > j.ack_at)
    .sort((a, b) => (a.completed_at ?? 0) - (b.completed_at ?? 0))
    .slice(-30)
    .map((j) => ({ id: j.id, sec: (j.completed_at as number) - (j.ack_at as number) }));
  if (points.length < 3) return null;

  const w = 600;
  const h = 120;
  const pad = 6;
  const maxScale = Math.max(deadlineSec, ...points.map((p) => p.sec)) * 1.1;
  const slot = w / points.length;
  const barW = Math.max(2, Math.min(18, slot * 0.6));
  const deadlineY = h - pad - (deadlineSec / maxScale) * (h - 2 * pad);
  const barColor = (sec: number) =>
    sec > deadlineSec ? "#ef4444" : sec > deadlineSec * 0.7 ? "#f59e0b" : "#22c55e";

  return (
    <div className="mt-5 border-t border-bdr-light pt-4">
      <div className="mb-2 flex items-center justify-between text-xs text-content-soft">
        <span>Processing time per job (acknowledged → completed)</span>
        <span>deadline {deadlineSec}s</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-28 w-full">
        <line x1="0" y1={deadlineY} x2={w} y2={deadlineY} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" opacity="0.7" />
        {points.map((p, i) => {
          const bh = Math.max(1, (p.sec / maxScale) * (h - 2 * pad));
          const x = i * slot + (slot - barW) / 2;
          return <rect key={p.id} x={x.toFixed(1)} y={(h - pad - bh).toFixed(1)} width={barW.toFixed(1)} height={bh.toFixed(1)} rx="1.5" fill={barColor(p.sec)} opacity="0.9" />;
        })}
      </svg>
    </div>
  );
}

/**
 * Earnings & settlement analytics from the worker's job history: reliability
 * (completion / timed-out / stuck), processing-time percentiles against the ~120s
 * deadline, and a settled / pending-release / timed-out breakdown bar. Pure read
 * over the jobs already loaded; no extra fetch.
 */
export function EarningsAnalyticsPanel({ jobs, deadlineSec = 120 }: { jobs: Job[]; deadlineSec?: number }) {
  if (jobs.length === 0) return null;
  const b = classifyJobs(jobs, Math.floor(Date.now() / 1000));
  const total = b.success + b.timedOut + b.stuck + b.disputed;
  const p95Tone = b.p95 == null ? "text-content-primary" : b.p95 > deadlineSec ? "text-danger" : b.p95 > deadlineSec * 0.7 ? "text-warning" : "text-success";

  // Settlement composition of completed work, for the breakdown bar.
  const settledSeg = b.success;
  const segments = [
    { label: "Settled", value: settledSeg, color: "bg-success" },
    { label: "Stuck", value: b.stuck, color: "bg-warning" },
    { label: "Timed out", value: b.timedOut, color: "bg-danger" },
  ].filter((s) => s.value > 0);
  const segTotal = segments.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Earnings &amp; settlement analytics</h3>
        <span className="text-xs text-content-soft">last {b.total} jobs</span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Completion</div>
          <div className="mt-0.5 text-2xl font-semibold text-content-primary">{b.completionRate == null ? "-" : `${Math.round(b.completionRate * 100)}%`}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Median time</div>
          <div className="mt-0.5 text-2xl font-semibold text-content-primary">{b.p50 == null ? "-" : `${b.p50}s`}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">p95 vs {deadlineSec}s</div>
          <div className={cn("mt-0.5 text-2xl font-semibold", p95Tone)}>{b.p95 == null ? "-" : `${b.p95}s`}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Earned</div>
          <div className="mt-0.5 text-2xl font-semibold text-success">{fmt(b.earnings, 3)}</div>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-xs text-content-soft">
            <span>Completed-work outcomes</span>
            <span>{meter(settledSeg, total)} settled</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
            {segments.map((s) => (
              <div key={s.label} className={cn("h-full", s.color)} style={{ width: `${(s.value / segTotal) * 100}%` }} title={`${s.label}: ${s.value}`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-content-soft">
            {segments.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", s.color)} /> {s.label} {s.value}
              </span>
            ))}
          </div>
        </div>
      )}

      <ProcessingTimeChart jobs={jobs} deadlineSec={deadlineSec} />

      {b.p95 != null && b.p95 > deadlineSec && (
        <p className="mt-4 flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Your p95 processing time exceeds the {deadlineSec}s deadline - some jobs risk timing out (a slash). A faster GPU
          or a lighter model would help.
        </p>
      )}
    </Card>
  );
}

/**
 * Operator profitability for the primary served model: the worker's fee share per
 * job, the gas it costs, the net, and a projection at the worker's observed
 * throughput. Makes "is this actually paying off" a glance, not a spreadsheet.
 */
export function ProfitabilityCard({ profitability: p }: { profitability: WorkerProfitability }) {
  const profitable = p.netLcaiPerJob > 0;
  const projected = p.projectedDailyLcai ?? p.netLcaiPerJob * p.jobsPerDay;
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Profitability</h3>
        <span className="text-xs text-content-soft">{p.modelName} · ~{fmt(p.jobsPerDay, 1)} jobs/day</span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Fee / job</div>
          <div className="mt-0.5 text-xl font-semibold text-content-primary">{fmt(p.workerFeeLcaiPerJob, 4)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Gas / job</div>
          <div className="mt-0.5 text-xl font-semibold text-content-primary">{fmt(p.gasLcaiPerJob, 4)}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Net / job</div>
          <div className={cn("mt-0.5 text-xl font-semibold", profitable ? "text-success" : "text-danger")}>
            {p.netLcaiPerJob >= 0 ? "+" : ""}
            {fmt(p.netLcaiPerJob, 4)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-content-soft">Projected / day</div>
          <div className={cn("mt-0.5 text-xl font-semibold", projected >= 0 ? "text-success" : "text-danger")}>
            {projected >= 0 ? "+" : ""}
            {fmt(projected, 3)}
          </div>
        </div>
      </div>
      {!profitable && (
        <p className="mt-4 flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          At the current model fee, gas per job exceeds the worker share - more volume or a higher-fee model would help.
          The fee is set on-chain per model.
        </p>
      )}
    </Card>
  );
}
