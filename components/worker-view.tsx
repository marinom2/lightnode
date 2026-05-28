"use client";

import {
  Coins,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Star,
  TrendingUp,
  Boxes,
  Percent,
  History,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fromWei, fmt, compact, timeAgo, shortAddr, stakeBelowFloor, cn } from "@/lib/utils";
import { DEFAULT_MODEL } from "@/lib/network";
import { workerSharePerJob } from "@/lib/hardware";
import type { Worker, Job, ServedModel } from "@/lib/subgraph";
import { openExternal } from "@/lib/tauri";
import type { LocalContainerStatus } from "@/lib/tauri";

type Health = "live" | "inactive" | "down";

/**
 * Earnings split. A job's reward is escrowed while it sits in `Completed` and
 * only lands in `total_earned` once it flips to `Released` on the network's
 * release cycle (≈hourly, up to ~8h). So lifetime reward ≈ `jobs_completed ×
 * per-job share`; the part not yet in `total_earned` is "pending release".
 * (Verified identical on testnet + mainnet: Completed jobs read share 0,
 * Released jobs read the real 0.016 LCAI - it's a lifecycle state, not a gap.)
 */
export function earningsOf(worker: Worker): { settled: number; pending: number; expected: number } {
  const settled = fromWei(worker.total_earned);
  const expected = (worker.jobs_completed ?? 0) * workerSharePerJob;
  const pending = Math.max(0, expected - settled);
  return { settled, pending, expected };
}

// The subgraph's last_seen_at is NOT a real-time heartbeat - it tracks last
// on-chain activity, so even busy workers (200+ jobs) read "stale" for long
// stretches. So health is based on the reliable signal: on-chain status. Use
// Operations → Status to confirm the container's websocket is connected.
export function healthOf(w: Worker): Health {
  if (w.status === "active") return "live";
  // Deactivated = still registered (stake locked) but not currently eligible -
  // usually the stake fell below the minimum after a slash, or it went offline.
  if (w.status === "deactivated") return "inactive";
  return "down"; // deregistered (stake returned) or never registered
}

const HEALTH: Record<Health, { tone: "success" | "warning" | "danger"; label: string; hint: string }> = {
  live: { tone: "success", label: "Registered", hint: "Registered & staked on-chain (stays this way until you deregister). This does not mean the container is running; that's the local status." },
  inactive: { tone: "warning", label: "Registered · inactive", hint: "Registered on-chain (your stake is still locked) but not currently active. The usual cause is the stake dropping below the minimum after a slash (see below), or the worker being offline. It is NOT deregistered." },
  down: { tone: "danger", label: "Not registered", hint: "Not registered on-chain: either deregistered (stake returned) or never started." },
};

/** Cumulative settled-earnings sparkline (Released jobs only; no chart lib). */
function EarningsSparkline({ jobs }: { jobs: Job[] }) {
  const points = jobs
    .filter((j) => fromWei(j.worker_share) > 0)
    .slice()
    .sort((a, b) => (a.completed_at ?? a.submitted_at ?? 0) - (b.completed_at ?? b.submitted_at ?? 0));
  if (points.length < 2) return null;

  let cum = 0;
  const data = points.map((j) => (cum += fromWei(j.worker_share)));
  const w = 600;
  const h = 120;
  const max = Math.max(...data);
  const stepX = w / (data.length - 1);
  const coords = data.map((v, i) => [i * stepX, h - (max ? (v / max) * (h - 12) : 0) - 6]);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <div className="mt-5 border-t border-bdr-light pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-content-soft" />
          <span className="text-xs font-medium text-content-soft">Settled earnings trend</span>
        </div>
        <span className="text-sm font-semibold text-success">+{fmt(cum, 3)} LCAI</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-24 w-full">
        <defs>
          <linearGradient id="lc-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7064e9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7064e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lc-spark)" />
        <path d={line} fill="none" stroke="#8c71f6" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** Hero earnings card: settled vs pending-release, with a segmented bar. */
function EarningsPanel({ worker, jobs }: { worker: Worker; jobs: Job[] }) {
  const { settled, pending, expected } = earningsOf(worker);
  const hasActivity = expected > 0;
  const settledPct = hasActivity ? (settled / expected) * 100 : 0;
  const jobsDone = fmt(worker.jobs_completed ?? 0, 0);

  return (
    <Card className="relative overflow-hidden p-6">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-52 rounded-full bg-primary/10 blur-3xl" />

      <div className="mb-4 flex items-center gap-2">
        <Coins className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Earnings</h3>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-content-soft">Settled</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-4xl font-semibold tracking-tight text-success">{fmt(settled, 3)}</span>
            <span className="text-sm text-content-soft">LCAI</span>
          </div>
        </div>
        {pending > 0 && (
          <div className="text-right">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning">
              <Clock className="size-3.5" /> +{fmt(pending, 3)} LCAI pending
            </span>
            <div className="mt-1 text-[11px] text-content-soft">≈ {fmt(expected, 3)} LCAI lifetime</div>
          </div>
        )}
      </div>

      {hasActivity && (
        <div className="mt-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
            <div className="h-full bg-success transition-all duration-500" style={{ width: `${settledPct}%` }} />
            {pending > 0 && (
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${100 - settledPct}%`,
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(246,181,30,0.6) 0 6px, rgba(246,181,30,0.22) 6px 12px)",
                }}
              />
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-content-soft">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" /> Settled
            </span>
            {pending > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-warning/70" /> Pending release
              </span>
            )}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-content-soft">
        {pending > 0
          ? `${jobsDone} job(s) completed. Each reward is escrowed when the job finishes and moves into your settled balance once the network releases it (about hourly, up to ~8h). This is automatic, no action needed.`
          : hasActivity
            ? "All completed jobs have settled. New rewards appear here automatically after each release cycle."
            : "No completed jobs yet. Rewards appear here once your worker serves and finishes jobs."}
      </p>

      <EarningsSparkline jobs={jobs} />
    </Card>
  );
}

const LOCAL: Record<"running" | "stopped" | "missing", { tone: "success" | "warning" | "danger"; label: string }> = {
  running: { tone: "success", label: "Running on this machine" },
  stopped: { tone: "danger", label: "Stopped on this machine" },
  missing: { tone: "warning", label: "Not installed on this machine" },
};

export function WorkerView({
  worker,
  jobs,
  models = [],
  explorer,
  minStake,
  watched,
  onToggleWatch,
  localStatus,
}: {
  worker: Worker;
  jobs: Job[];
  models?: ServedModel[];
  explorer: string;
  minStake: number;
  watched: boolean;
  onToggleWatch: () => void;
  localStatus?: LocalContainerStatus | null;
}) {
  const h = healthOf(worker);
  const meta = HEALTH[h];
  const stake = fromWei(worker.stake);
  const local = localStatus && localStatus !== "unknown" ? LOCAL[localStatus] : null;

  const completed = worker.jobs_completed ?? 0;
  const attempted = completed + (worker.jobs_timed_out ?? 0) + (worker.disputes_lost ?? 0);
  const successRate = attempted > 0 ? `${Math.round((completed / attempted) * 100)}%` : "-";
  // The subgraph keeps the last-registered stake on the entity even after a
  // deregister returns it on-chain. So once deregistered, show it as returned (0)
  // rather than the stale locked amount.
  const stakeReturned = worker.status === "deregistered";

  const tiles = [
    { icon: CheckCircle2, label: "Jobs completed", value: fmt(completed, 0), tone: "text-content-primary" },
    { icon: Percent, label: "Success rate", value: successRate, tone: "text-content-primary" },
    {
      icon: ShieldCheck,
      label: stakeReturned ? "Stake (returned)" : "Stake (LCAI)",
      value: stakeReturned ? "0" : compact(stake),
      tone: "text-content-primary",
    },
    { icon: Clock, label: "Last on-chain activity", value: timeAgo(worker.last_seen_at), tone: "text-content-primary" },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn("dot", h === "live" ? "dot-live" : h === "inactive" ? "dot-warn" : "dot-down")} />
            <span className="font-mono text-sm text-content-primary">{shortAddr(worker.id)}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {local && <Badge tone={local.tone}>{local.label}</Badge>}
            {(worker.active_job_count ?? 0) > 0 && <Badge tone="brand">{worker.active_job_count} active job(s)</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onToggleWatch}>
              <Star className={cn("size-4", watched && "fill-warning text-warning")} />
              {watched ? "Watching" : "Watch"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openExternal(`${explorer}/address/${worker.id}`)}>
              Explorer <ExternalLink />
            </Button>
          </div>
        </div>
        <p className="mt-3 text-sm text-content-soft">{meta.hint}</p>
        {local && localStatus === "stopped" && (
          <p className="mt-2 flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Your stake is still registered, but the container is stopped on this machine, so it is not earning. Use
            Operations → Restart to bring it back online.
          </p>
        )}
      </Card>

      <EarningsPanel worker={worker} jobs={jobs} />

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {tiles.map((t, i) => (
            <div
              key={t.label}
              className={cn(
                "border-bdr-soft p-4 sm:p-5",
                i % 2 === 0 && "border-r", // mobile 2-col: divider after the left cell
                i >= 2 && "border-t", // mobile: divider above the second row
                "sm:border-t-0", // desktop single row: no top dividers
                i < 3 ? "sm:border-r" : "sm:border-r-0", // desktop: dividers between columns
              )}
            >
              <div className="mb-2 flex items-center gap-2 text-content-soft">
                <t.icon className="size-4" />
                <span className="text-xs font-medium">{t.label}</span>
              </div>
              <div className={cn("text-2xl font-semibold tracking-tight", t.tone)}>{t.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {(worker.jobs_timed_out ?? 0) > 0 && (
        <Card className="border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-2 text-sm text-content-default">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-content-primary">{worker.jobs_timed_out} timed-out job(s).</span> Each
              ack-then-incomplete job risks a slash. Make sure the liveness watchdog is running and Ollama serves{" "}
              <code className="rounded bg-surface-base-light px-1 py-0.5">{DEFAULT_MODEL}</code> by that exact name.
            </span>
          </div>
        </Card>
      )}

      {stakeBelowFloor(worker.stake, minStake) && worker.status !== "deregistered" && (
        <Card className="border-warning/30 bg-warning/10 p-4 text-sm text-content-default">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-content-primary">
                Stake is below the {minStake.toLocaleString()} LCAI minimum
                {worker.status === "deactivated" ? " (this is why the worker shows inactive)" : " (likely slashed)"}.
              </span>{" "}
              This worker holds {compact(stake)} LCAI. Send about{" "}
              <span className="font-semibold tabular-nums">{compact(Math.max(0, minStake - stake))} LCAI</span> to the worker
              wallet to reach the minimum
              {worker.status === "deactivated" ? " so the network can reactivate it" : " and stay eligible for jobs"}. Your
              registration and remaining stake are intact. Nothing was deregistered.
            </span>
          </div>
        </Card>
      )}

      {models.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="size-4 text-content-soft" />
            <h3 className="text-sm font-semibold text-content-primary">Supported models</h3>
            <span className="text-xs text-content-soft">what this worker serves</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-bdr-soft">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-bdr-soft bg-surface-base-subtle/60 px-3 py-2 text-[11px] font-medium text-content-soft">
              <span>Model</span>
              <span className="text-right">Fee</span>
              <span className="text-right">Max output</span>
              <span className="text-right">Status</span>
            </div>
            {models.map((m) => (
              <div
                key={m.name}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-3 py-2.5 text-xs text-content-default [&:not(:last-child)]:border-b [&:not(:last-child)]:border-bdr-soft"
              >
                <span className="truncate font-medium text-content-primary">{m.name}</span>
                <span className="text-right tabular-nums">{m.fee ? `${fmt(fromWei(m.fee), 3)} LCAI` : "-"}</span>
                <span className="text-right tabular-nums text-content-soft">
                  {m.maxOutput ? `${m.maxOutput.toLocaleString()} tok` : "-"}
                </span>
                <span className="text-right">
                  <Badge tone={m.active ? "success" : "muted"}>{m.active ? "active" : "paused"}</Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {jobs.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <History className="size-4 text-content-soft" />
            <h3 className="text-sm font-semibold text-content-primary">Job history</h3>
            <span className="text-xs text-content-soft">newest first</span>
          </div>
          <div className="space-y-1.5">
            {jobs.map((j) => {
              const released = /releas/i.test(j.state);
              const done = released || /complet/i.test(j.state);
              const share = fromWei(j.worker_share);
              return (
                <div key={j.id} className="flex items-center justify-between rounded-lg bg-surface-base-faint px-3 py-2 text-xs">
                  <span className="font-mono text-content-soft">job #{j.id}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 font-medium",
                      done ? "text-success" : /ack/i.test(j.state) ? "text-warning" : "text-content-soft",
                    )}
                  >
                    {done && <CheckCircle2 className="size-3.5" />}
                    {j.state}
                  </span>
                  <span className={cn(share > 0 ? "text-success" : "text-content-soft")}>
                    {share > 0 ? `+${fmt(share, 3)} LCAI` : done && !released ? "pending" : "-"}
                  </span>
                  <span className="text-content-soft">{timeAgo(j.completed_at || j.submitted_at)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <p className="text-center text-xs text-content-soft">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw className="size-3" /> Auto-refreshes every 20s · live from the worker subgraph
        </span>
      </p>
    </div>
  );
}
