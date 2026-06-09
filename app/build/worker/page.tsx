"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Server, CheckCircle2, AlertTriangle, XCircle, Clock, ArrowRight, Scale } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, RunButton, ResponseEmpty, ProofRow, Notice, short } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

type Action = "config" | "status" | "job" | "risk";
const ACTIONS: { id: Action; label: string }[] = [
  { id: "config", label: "Protocol config" },
  { id: "status", label: "Worker status" },
  { id: "risk", label: "Suspension & slashing" },
  { id: "job", label: "Classify a job" },
];
const NEEDS_WORKER = (a: Action) => a === "status" || a === "risk";

interface ConfigData {
  minStakeLcai: number;
  ackTimeoutSec: number;
  completionTimeoutSec: number;
  resolutionTimeoutSec: number;
  disputeWindowSec: number;
  slashBps: { ackTimeout: number; completionTimeout: number; dispute: number; max: number };
  feeBps: { protocol: number; worker: number; feePool: number };
  suspensionThreshold: number;
  suspensionCooldownSec: number;
}
interface ModelRow {
  id: string;
  name: string | null;
  isLive: boolean;
  isStale: boolean;
}
interface StatusData {
  registered: boolean;
  stakeLcai: number;
  belowFloor: boolean;
  claimableLcai: number;
  walletBalanceLcai: number;
  lifetimeJobsCompleted: number;
  lifetimeJobsTimedOut: number;
  recentReleased: number;
  recentPendingRelease: number;
  recentStuck: number;
  recentInFlight: number;
  registeredModels: ModelRow[];
}
type JobCategory = "submitted" | "in-flight" | "completed" | "stalled" | "disputed" | "resolved" | "unknown";
interface JobStatusData {
  id: string;
  raw: string;
  category: JobCategory;
  worker: string | null;
  model: string | null;
  submittedAt: number | null;
  completedAt: number | null;
  workerShareLcai: number;
  refundable: boolean;
  submitTx: string | null;
  completionTx: string | null;
}
interface JobOnchain {
  stateIndex: number;
  submittedAt: number;
  ackAt: number;
  completedAt: number;
  deadlineAt: number;
  escrowedFeeLcai: number;
  worker: string;
}
interface JobProtocol {
  ackTimeoutSec: number;
  completionTimeoutSec: number;
  resolutionTimeoutSec: number;
  disputeWindowSec: number;
  slashBps: { ackTimeout: number; completionTimeout: number; dispute: number; max: number };
  suspensionThreshold: number;
  suspensionCooldownSec: number;
}
type RiskVerdict = "active" | "below-floor" | "suspended" | "no-models" | "unregistered";
interface RiskData {
  standing: {
    registered: boolean;
    stakeLcai: number;
    minStakeLcai: number;
    belowFloor: boolean;
    headroomLcai: number;
    servedModels: { modelId: string; name: string | null; eligible: boolean | null }[];
    verdict: RiskVerdict;
  };
  suspension: { lifetimeTimeouts: number; threshold: number; cooldownSec: number; stuckNow: number; atRisk: boolean };
  slash: {
    exposureLcai: number;
    exposureBps: number;
    maxBps: number;
    stuckJobs: { id: string; kind: "unacked" | "incomplete"; slashBps: number; pastDeadlineSec: number }[];
  };
  schedule: { ackTimeoutBps: number; completionTimeoutBps: number; disputeBps: number; maxBps: number };
}
type PreviewResponse =
  | { action: "config"; config: ConfigData }
  | { action: "status"; worker: string; status: StatusData }
  | { action: "job"; jobId: string; status: JobStatusData | null; onchain: JobOnchain | null; protocol: JobProtocol | null }
  | { action: "risk"; worker: string; standing: RiskData["standing"]; suspension: RiskData["suspension"]; slash: RiskData["slash"]; schedule: RiskData["schedule"] };

const SNIPPET = `import { WorkerOperator } from "lightnode-sdk";

const op = new WorkerOperator("mainnet", { publicClient, walletClient });

await op.config();              // live AIConfig: stake floor, timeouts, slash bps
await op.status();              // registered, stake, claimable, below-floor
await op.clearStuck(jobIds);    // recover acked-but-stuck jobs that block exit
await op.unstickAndDeregister(jobIds); // clear + settle + withdraw + exit`;

function KV({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2">
      <div className="text-[11px] text-content-soft">{k}</div>
      <div className={cn("mt-0.5 text-sm font-medium tabular-nums", warn ? "text-warning" : "text-content-primary")}>{v}</div>
    </div>
  );
}

function ConfigView({ c }: { c: ConfigData }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV k="Min stake" v={`${c.minStakeLcai.toLocaleString()} LCAI`} />
        <KV k="Ack timeout" v={`${c.ackTimeoutSec}s`} />
        <KV k="Completion timeout" v={`${c.completionTimeoutSec}s`} />
        <KV k="Dispute window" v={`${c.disputeWindowSec}s`} />
        <KV k="Suspension at" v={`${c.suspensionThreshold} timeouts`} />
        <KV k="Suspension cooldown" v={`${c.suspensionCooldownSec}s`} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Slash (bps)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV k="Ack timeout" v={c.slashBps.ackTimeout} />
          <KV k="Completion" v={c.slashBps.completionTimeout} />
          <KV k="Dispute" v={c.slashBps.dispute} />
          <KV k="Max" v={c.slashBps.max} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Fee split (bps)</p>
        <div className="grid grid-cols-3 gap-2">
          <KV k="Protocol" v={c.feeBps.protocol} />
          <KV k="Worker" v={c.feeBps.worker} />
          <KV k="Fee pool" v={c.feeBps.feePool} />
        </div>
      </div>
    </div>
  );
}

function StatusView({ s, explorer, worker }: { s: StatusData; explorer: string; worker: string }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV k="Registered" v={s.registered ? "yes" : "no"} warn={!s.registered} />
        <KV k="Stake" v={`${s.stakeLcai.toLocaleString()} LCAI`} warn={s.belowFloor} />
        <KV k="Claimable" v={`${s.claimableLcai} LCAI`} />
        <KV k="Wallet gas" v={`${s.walletBalanceLcai.toFixed(4)} LCAI`} warn={s.walletBalanceLcai < 0.001} />
        <KV k="Lifetime jobs" v={s.lifetimeJobsCompleted} />
        <KV k="Timed out" v={s.lifetimeJobsTimedOut} warn={s.lifetimeJobsTimedOut > 0} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Recent jobs (last 50)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV k="Released" v={s.recentReleased} />
          <KV k="Pending release" v={s.recentPendingRelease} />
          <KV k="Stuck" v={s.recentStuck} warn={s.recentStuck > 0} />
          <KV k="In flight" v={s.recentInFlight} />
        </div>
      </div>
      {s.registeredModels.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Models served</p>
          <div className="flex flex-wrap gap-1.5">
            {s.registeredModels.map((m) => (
              <span
                key={m.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  m.isLive
                    ? "border-success/30 bg-success/10 text-success"
                    : m.isStale
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-bdr-soft text-content-soft",
                )}
              >
                {m.name ?? short(m.id)}
                {m.isStale ? " (stale)" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <ProofRow label="address" value={short(worker)} href={`${explorer}/address/${worker}`} />
    </div>
  );
}

// Plain-English meaning + recommended action per lifecycle state. This is the
// difference between "category: submitted" (useless) and an operator knowing
// what happened, what's next, and what it costs.
const JOB_META: Record<JobCategory, { title: string; tone: "ok" | "warn" | "bad" | "info"; meaning: string; action: string }> = {
  submitted: {
    title: "Submitted",
    tone: "info",
    meaning: "The encrypted prompt is on-chain and a worker is assigned, but it hasn't acknowledged the job yet.",
    action: "Wait - the worker should acknowledge within the ack timeout. If it never does, the job becomes refundable and your fee is returned automatically.",
  },
  "in-flight": {
    title: "In flight",
    tone: "info",
    meaning: "A worker acknowledged the job and is running the inference, still inside the completion window.",
    action: "Wait for the answer. If the worker misses the completion deadline below, the job turns stalled and your fee is refunded.",
  },
  completed: {
    title: "Completed",
    tone: "ok",
    meaning: "The worker delivered an answer and committed jobCompleted on-chain - the final, verifiable result.",
    action: "Nothing to do. The worker's share moves to its claimable balance after the dispute window, then it withdraws.",
  },
  stalled: {
    title: "Stalled (timed out)",
    tone: "warn",
    meaning: "A worker accepted the job but never delivered within the completion deadline.",
    action: "Nothing required - the protocol refunds your fee after the dispute window. Anyone can call timeoutJob(jobId) to settle it immediately.",
  },
  disputed: {
    title: "Disputed",
    tone: "warn",
    meaning: "A dispute is open against this job. Resolution is pending within the resolution timeout.",
    action: "Wait for the dispute to resolve. If it's upheld, your fee is refunded and the worker is slashed.",
  },
  resolved: {
    title: "Resolved",
    tone: "ok",
    meaning: "A dispute on this job has been settled on-chain.",
    action: "Nothing to do - the outcome is final.",
  },
  unknown: {
    title: "Unknown",
    tone: "info",
    meaning: "The indexer hasn't classified this job's state yet - it may still be propagating.",
    action: "Re-read in a few seconds, or open submitJob on the explorer to inspect it directly.",
  },
};

const TONE_CLASS: Record<"ok" | "warn" | "bad" | "info", string> = {
  ok: "border-success/30 bg-success/5 text-success",
  warn: "border-warning/30 bg-warning/5 text-warning",
  bad: "border-destructive/30 bg-destructive/5 text-destructive",
  info: "border-primary/30 bg-primary/5 text-primary",
};
const TONE_ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Clock } as const;

function fmtTs(unix?: number | null): string {
  if (!unix || unix <= 0) return "—";
  return new Date(unix * 1000).toLocaleString();
}
function dur(sec: number): string {
  const s = Math.abs(Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function TimelineRow({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "muted" }) {
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="w-36 shrink-0 text-content-soft">{label}</span>
      <span className="font-mono text-content-default">{value}</span>
      {sub && (
        <span className={cn("ml-auto tabular-nums", tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-content-soft")}>
          {sub}
        </span>
      )}
    </div>
  );
}

function deadlineNote(o: JobOnchain, nowSec: number): { sub: string; tone: "ok" | "warn" | "muted" } {
  if (!o.deadlineAt) return { sub: "", tone: "muted" };
  if (o.completedAt > 0) {
    return o.completedAt <= o.deadlineAt
      ? { sub: `met, ${dur(o.deadlineAt - o.completedAt)} to spare`, tone: "ok" }
      : { sub: `missed by ${dur(o.completedAt - o.deadlineAt)}`, tone: "warn" };
  }
  return nowSec > o.deadlineAt
    ? { sub: `missed, ${dur(nowSec - o.deadlineAt)} past`, tone: "warn" }
    : { sub: `in ${dur(o.deadlineAt - nowSec)}`, tone: "ok" };
}

function penaltyNote(category: JobCategory, p: JobProtocol): string | null {
  const pct = (bps: number) => `${bps / 100}%`;
  if (category === "stalled") {
    return `Worker penalty: this counts as a completion timeout - the worker is slashed ${pct(p.slashBps.completionTimeout)} of stake and your fee is refunded. After ${p.suspensionThreshold} timeouts the worker is suspended for ${dur(p.suspensionCooldownSec)}.`;
  }
  if (category === "disputed") {
    return `If the dispute is upheld, the worker is slashed up to ${pct(p.slashBps.dispute)} of stake (max ${pct(p.slashBps.max)}) and your fee is refunded.`;
  }
  return null;
}

function JobView({
  jobId,
  status,
  onchain,
  protocol,
  explorer,
}: {
  jobId: string;
  status: JobStatusData;
  onchain: JobOnchain | null;
  protocol: JobProtocol | null;
  explorer: string;
}) {
  const meta = JOB_META[status.category] ?? JOB_META.unknown;
  const Icon = TONE_ICON[meta.tone];
  const nowSec = Math.floor(Date.now() / 1000);
  const submittedAt = onchain?.submittedAt || status.submittedAt || 0;
  const completedAt = onchain?.completedAt || status.completedAt || 0;
  const dl = onchain ? deadlineNote(onchain, nowSec) : null;
  const penalty = protocol ? penaltyNote(status.category, protocol) : null;

  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border p-3.5", TONE_CLASS[meta.tone])}>
        <div className="flex items-center gap-2">
          <Icon className="size-4" />
          <span className="text-sm font-semibold">
            Job #{jobId} · {meta.title}
          </span>
          {status.refundable && (
            <span className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
              refund on the table
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-content-default">{meta.meaning}</p>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Timeline</p>
        <div className="space-y-1.5 rounded-xl border border-bdr-soft p-3">
          <TimelineRow label="Submitted" value={fmtTs(submittedAt)} sub={submittedAt ? `${dur(nowSec - submittedAt)} ago` : undefined} />
          {onchain && onchain.ackAt > 0 && (
            <TimelineRow label="Acknowledged" value={fmtTs(onchain.ackAt)} sub={submittedAt ? `+${dur(onchain.ackAt - submittedAt)}` : undefined} />
          )}
          {onchain && onchain.deadlineAt > 0 && (
            <TimelineRow label="Completion deadline" value={fmtTs(onchain.deadlineAt)} sub={dl?.sub || undefined} tone={dl?.tone} />
          )}
          <TimelineRow
            label="Completed"
            value={fmtTs(completedAt)}
            sub={completedAt && submittedAt ? `${dur(completedAt - submittedAt)} total` : "no answer yet"}
            tone={completedAt ? "ok" : "muted"}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {onchain && <KV k="Fee escrowed" v={`${onchain.escrowedFeeLcai} LCAI`} />}
        <KV k="Worker share" v={`${status.workerShareLcai ?? 0} LCAI`} />
        <KV k="Refundable" v={status.refundable ? "yes" : "no"} warn={status.refundable} />
      </div>

      <div className="rounded-xl border border-bdr-soft bg-surface-base-faint p-3">
        <div className="flex items-center gap-1.5">
          <ArrowRight className="size-3.5 text-primary" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-soft">What to do</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-content-default">{meta.action}</p>
      </div>

      {penalty && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs leading-relaxed text-content-default">
          <Scale className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>{penalty}</span>
        </div>
      )}

      <div className="rounded-xl border border-bdr-soft p-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">On-chain</p>
        {status.model && <ProofRow label="model" value={status.model} />}
        {status.worker && <ProofRow label="worker" value={short(status.worker)} href={`${explorer}/address/${status.worker}`} />}
        {status.submitTx && <ProofRow label="submitJob" value={short(status.submitTx)} href={`${explorer}/tx/${status.submitTx}`} />}
        {status.completionTx && <ProofRow label="jobCompleted" value={short(status.completionTx)} href={`${explorer}/tx/${status.completionTx}`} />}
      </div>
    </div>
  );
}

const RISK_VERDICT: Record<RiskVerdict, { title: string; tone: "ok" | "warn" | "bad" | "info"; line: (d: RiskData) => string }> = {
  active: {
    title: "Active & eligible",
    tone: "ok",
    line: () => "Registered, staked above the floor, and eligible on-chain to take jobs for at least one model.",
  },
  "below-floor": {
    title: "Below stake floor",
    tone: "warn",
    line: (d) =>
      `Staked ${d.standing.stakeLcai.toLocaleString()} LCAI against a ${d.standing.minStakeLcai.toLocaleString()} LCAI floor - short by ${Math.max(0, d.standing.minStakeLcai - d.standing.stakeLcai).toLocaleString()} LCAI. The worker can't take jobs until you topUpStake() and reinstate().`,
  },
  suspended: {
    title: "Suspended (jailed)",
    tone: "bad",
    line: (d) =>
      `Registered and staked, but WorkerRegistry.isEligible() is false for every model it serves - the on-chain jailed signal. Usually a timeout suspension; it becomes eligible again after the ${dur(d.suspension.cooldownSec)} cooldown, or call reinstate() once the cause is cleared.`,
  },
  "no-models": {
    title: "No models registered",
    tone: "info",
    line: () => "Registered and staked, but serving no models - it can't be assigned work. Call addModel(tag) to start earning.",
  },
  unregistered: {
    title: "Not registered",
    tone: "info",
    line: () => "No active WorkerRegistry registration on this network for that address.",
  },
};

function pctBps(bps: number): string {
  return `${bps / 100}%`;
}

function RiskView({ d, worker, explorer }: { d: RiskData; worker: string; explorer: string }) {
  const v = RISK_VERDICT[d.standing.verdict] ?? RISK_VERDICT.unregistered;
  const Icon = TONE_ICON[v.tone];
  const remaining = Math.max(0, d.suspension.threshold - d.suspension.lifetimeTimeouts);
  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border p-3.5", TONE_CLASS[v.tone])}>
        <div className="flex items-center gap-2">
          <Icon className="size-4" />
          <span className="text-sm font-semibold">{v.title}</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-content-default">{v.line(d)}</p>
      </div>

      {d.standing.servedModels.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Eligibility (on-chain)</p>
          <div className="flex flex-wrap gap-1.5">
            {d.standing.servedModels.map((m) => (
              <span
                key={m.modelId}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  m.eligible === true
                    ? "border-success/30 bg-success/10 text-success"
                    : m.eligible === false
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-bdr-soft text-content-soft",
                )}
              >
                {m.name ?? short(m.modelId)} · {m.eligible === true ? "eligible" : m.eligible === false ? "not eligible" : "unknown"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suspension countdown */}
      <div className="rounded-xl border border-bdr-soft p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-soft">Suspension risk</p>
          <span className={cn("text-[11px] tabular-nums", d.suspension.atRisk ? "text-warning" : "text-content-soft")}>
            {d.suspension.lifetimeTimeouts} / {d.suspension.threshold} timeouts
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-base-faint">
          <div
            className={cn("h-full rounded-full", d.suspension.atRisk ? "bg-warning" : "bg-primary/60")}
            style={{ width: `${Math.min(100, (d.suspension.lifetimeTimeouts / Math.max(1, d.suspension.threshold)) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-content-soft">
          {remaining > 0
            ? `${remaining} more timeout${remaining === 1 ? "" : "s"} triggers a ${dur(d.suspension.cooldownSec)} suspension.`
            : `At or over the ${d.suspension.threshold}-timeout threshold - subject to a ${dur(d.suspension.cooldownSec)} suspension.`}
          {d.suspension.stuckNow > 0 && ` ${d.suspension.stuckNow} job(s) are stuck right now and will count if they time out.`}
        </p>
      </div>

      {/* Slash exposure now */}
      <div className="rounded-xl border border-bdr-soft p-3">
        <div className="mb-1 flex items-center gap-1.5">
          <Scale className="size-3.5 text-warning" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-content-soft">Stake at risk right now</p>
        </div>
        {d.slash.stuckJobs.length === 0 ? (
          <p className="text-xs text-content-soft">No stuck jobs - nothing is exposed to a slash right now.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-warning">
              ~{d.slash.exposureLcai.toLocaleString()} LCAI ({pctBps(d.slash.exposureBps)} of stake, capped at {pctBps(d.slash.maxBps)})
            </p>
            {d.slash.stuckJobs.map((s) => (
              <div key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-mono text-content-default">job {s.id}</span>
                <span className="text-content-soft">{s.kind === "unacked" ? "never acknowledged" : "acknowledged, never completed"}</span>
                <span className="ml-auto tabular-nums text-warning">{pctBps(s.slashBps)} · {dur(s.pastDeadlineSec)} past deadline</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slash schedule */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Slash schedule (AIConfig)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV k="Ack timeout" v={pctBps(d.schedule.ackTimeoutBps)} />
          <KV k="Completion timeout" v={pctBps(d.schedule.completionTimeoutBps)} />
          <KV k="Dispute" v={pctBps(d.schedule.disputeBps)} />
          <KV k="Max per job" v={pctBps(d.schedule.maxBps)} />
        </div>
      </div>

      <ProofRow label="worker" value={short(worker)} href={`${explorer}/address/${worker}`} />
    </div>
  );
}

export default function WorkerPanel() {
  const { network } = useNetwork();
  const [action, setAction] = useState<Action>("config");
  const [worker, setWorker] = useState("");
  const [jobId, setJobId] = useState("");
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explorer = NETWORKS[network].explorer;

  const run = useCallback(
    async (a: Action) => {
      setRunning(true);
      setError(null);
      setData(null);
      const qs = new URLSearchParams({ action: a, net: network });
      if (NEEDS_WORKER(a)) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(worker.trim())) {
          setError("Paste a valid 0x worker address.");
          setRunning(false);
          return;
        }
        qs.set("worker", worker.trim());
      }
      if (a === "job") {
        if (!/^\d+$/.test(jobId.trim())) {
          setError("Enter a numeric job id.");
          setRunning(false);
          return;
        }
        qs.set("jobId", jobId.trim());
      }
      try {
        const res = await fetch(`/api/operator-preview?${qs.toString()}`);
        const d = (await res.json()) as PreviewResponse & { error?: string };
        if (!res.ok || d.error) {
          setError(d.error ?? "Read failed.");
          return;
        }
        setData(d);
      } catch {
        setError("Network error reaching the operator endpoint.");
      } finally {
        setRunning(false);
      }
    },
    [network, worker, jobId],
  );

  // Auto-load protocol config on mount / network change for instant live data.
  useEffect(() => {
    if (action === "config") void run("config");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Worker ops"
        title="Worker operator"
        subtitle="The Docker-free operator surface: read live protocol config, inspect any worker's on-chain status, see its suspension & slashing exposure, and classify a job - the same reads the desktop Action Center and the lightnode worker CLI use. Write ops (settle, clearStuck, withdraw, deregister) sign with your own key."
      >
        <PanelGrid>
          <PanelColumn title="Request">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAction(a.id);
                      setData(null);
                      setError(null);
                      if (a.id === "config") void run("config");
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      action === a.id
                        ? "border-primary/40 bg-primary/10 text-content-primary"
                        : "border-bdr-soft text-content-soft hover:text-content-primary",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {NEEDS_WORKER(action) && (
                <Field label="Worker address" hint="Any registered worker on the selected network.">
                  <input
                    value={worker}
                    onChange={(e) => setWorker(e.target.value.trim())}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                  />
                </Field>
              )}
              {action === "job" && (
                <Field label="Job id" hint="A numeric on-chain job id to classify (completed / stalled / refundable).">
                  <input
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value.trim())}
                    placeholder="1234"
                    className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                  />
                </Field>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-soft">Read-only · {NETWORKS[network].label}</span>
                <RunButton running={running} onClick={() => run(action)} idle="Read" busy="Reading..." />
              </div>
            </div>
          </PanelColumn>

          <PanelColumn title="Response">
            {error && <Notice tone="warn">{error}</Notice>}
            {!error && !data && !running && <ResponseEmpty>Pick an action and read live on-chain operator data.</ResponseEmpty>}
            {!error && running && <ResponseEmpty>Reading the chain...</ResponseEmpty>}
            {!error && data && data.action === "config" && <ConfigView c={data.config} />}
            {!error && data && data.action === "status" && <StatusView s={data.status} explorer={explorer} worker={data.worker} />}
            {!error && data && data.action === "risk" && (
              <RiskView
                d={{ standing: data.standing, suspension: data.suspension, slash: data.slash, schedule: data.schedule }}
                worker={data.worker}
                explorer={explorer}
              />
            )}
            {!error && data && data.action === "job" && (
              data.status ? (
                <JobView
                  jobId={data.jobId}
                  status={data.status}
                  onchain={data.onchain}
                  protocol={data.protocol}
                  explorer={explorer}
                />
              ) : (
                <ResponseEmpty>No record for that job id on {NETWORKS[network].label} yet.</ResponseEmpty>
              )
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Scaffold a runnable operator console with{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add worker-operator</code>.
        </p>
      </section>
    </div>
  );
}
