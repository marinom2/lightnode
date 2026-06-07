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
import { AlertTriangle, Coins, Clock, CheckCircle2, Activity, Copy, Check, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, cn, timeAgo } from "@/lib/utils";
import { classifyJobs } from "@/lib/analytics";
import type { Job, Worker } from "@/lib/subgraph";
import type { WorkerActionCenter, WorkerAction } from "lightnode-sdk";

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

/** Plain-text diagnostics report for copy-paste into support / an issue. */
function buildDiagnosticsReport(a: WorkerActionCenter, jobs: Job[]): string {
  const b = classifyJobs(jobs, Math.floor(Date.now() / 1000));
  const lv = a.liveness;
  const lines = [
    "LightChain worker diagnostics",
    `address:     ${a.address}`,
    `registered:  ${a.registered}   stake: ${fmt(a.stakeLcai, 0)} LCAI`,
    `wallet gas:  ${a.walletGasLcai} LCAI${a.outOfGas ? "   ** OUT OF GAS - settle/claim/deregister cannot be sent **" : ""}`,
    `claimable:   ${fmt(a.claimableLcai, 3)} LCAI (released, not yet withdrawn)`,
    `liveness:    ${lv.liveness}   last on-chain activity ${lv.lastSeenAgoSec == null ? "unknown" : `${Math.round(lv.lastSeenAgoSec / 3600)}h ago`}`,
    `stuck jobs:  ${lv.stuckJobs.length} (unacked ${lv.unackedCount}, incomplete ${lv.incompleteCount})${lv.slashExposureLcai > 0 ? `, ~${fmt(lv.slashExposureLcai, 0)} LCAI slash risk${lv.suspensionRisk ? " + suspension" : ""}` : ""}`,
    `settlement:  ${a.settlement.releasableNowCount} releasable now, ${a.settlement.inWindowCount} in dispute window, ${a.settlement.pendingReleaseCount} pending release`,
    `job history: ${b.total} jobs, ${b.success} settled, ${b.timedOut} timed out, ${b.stuck} stuck; completion ${b.completionRate == null ? "n/a" : `${Math.round(b.completionRate * 100)}%`}; p50 ${b.p50 ?? "n/a"}s, p95 ${b.p95 ?? "n/a"}s`,
    "actions:",
    ...(a.actions.length ? a.actions.map((x, i) => `  ${i + 1}. [${x.urgency}] ${x.title} - ${x.detail}`) : ["  (none)"]),
  ];
  return lines.join("\n");
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
