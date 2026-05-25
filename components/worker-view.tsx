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
  ListChecks,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fromWei, fmt, compact, timeAgo, shortAddr, cn } from "@/lib/utils";
import { DEFAULT_MODEL } from "@/lib/network";
import type { Worker, Job } from "@/lib/subgraph";

type Health = "live" | "stale" | "down";

export function healthOf(w: Worker): Health {
  if (w.status !== "active") return "down";
  if (!w.last_seen_at) return "down";
  return Math.floor(Date.now() / 1000) - w.last_seen_at < 20 * 60 ? "live" : "stale";
}

const HEALTH: Record<Health, { tone: "success" | "warning" | "danger"; label: string; hint: string }> = {
  live: { tone: "success", label: "Live", hint: "Heartbeat fresh - serving jobs." },
  stale: { tone: "warning", label: "Stale heartbeat", hint: "Active on-chain but no recent heartbeat. Check the container / watchdog." },
  down: { tone: "danger", label: "Offline", hint: "Not active. Deregistered, deactivated, or never started." },
};

/** Cumulative-earnings sparkline from the recent jobs feed (no chart lib). */
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
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-content-soft" />
          <h3 className="text-sm font-semibold text-content-primary">Earnings trend</h3>
          <span className="text-xs text-content-soft">cumulative, recent jobs</span>
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
    </Card>
  );
}

export function WorkerView({
  worker,
  jobs,
  explorer,
  minStake,
  watched,
  onToggleWatch,
}: {
  worker: Worker;
  jobs: Job[];
  explorer: string;
  minStake: number;
  watched: boolean;
  onToggleWatch: () => void;
}) {
  const h = healthOf(worker);
  const meta = HEALTH[h];
  const stake = fromWei(worker.stake);
  const earned = fromWei(worker.total_earned);

  const tiles = [
    { icon: CheckCircle2, label: "Jobs completed", value: fmt(worker.jobs_completed ?? 0, 0), tone: "text-content-primary" },
    { icon: Coins, label: "LCAI earned", value: fmt(earned, 3), tone: "text-success" },
    { icon: ShieldCheck, label: "Stake (LCAI)", value: compact(stake), tone: "text-content-primary" },
    { icon: Clock, label: "Last seen", value: timeAgo(worker.last_seen_at), tone: h === "live" ? "text-success" : "text-warning" },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn("dot", h === "live" ? "dot-live" : h === "stale" ? "dot-warn" : "dot-down")} />
            <span className="font-mono text-sm text-content-primary">{shortAddr(worker.id)}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {(worker.active_job_count ?? 0) > 0 && <Badge tone="brand">{worker.active_job_count} active job(s)</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onToggleWatch}>
              <Star className={cn("size-4", watched && "fill-warning text-warning")} />
              {watched ? "Watching" : "Watch"}
            </Button>
            <a href={`${explorer}/address/${worker.id}`} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                Explorer <ExternalLink />
              </Button>
            </a>
          </div>
        </div>
        <p className="mt-3 text-sm text-content-soft">{meta.hint}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="mb-2 flex items-center gap-2 text-content-soft">
              <t.icon className="size-4" />
              <span className="text-xs font-medium">{t.label}</span>
            </div>
            <div className={cn("text-2xl font-semibold tracking-tight", t.tone)}>{t.value}</div>
          </Card>
        ))}
      </div>

      <EarningsSparkline jobs={jobs} />

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

      {stake < minStake && worker.status === "active" && (
        <Card className="border-warning/30 bg-warning/10 p-4 text-sm text-content-default">
          Stake is below the {minStake.toLocaleString()} LCAI floor - likely slashed. Top up to stay eligible for jobs.
        </Card>
      )}

      {jobs.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListChecks className="size-4 text-content-soft" />
            <h3 className="text-sm font-semibold text-content-primary">Recent jobs</h3>
          </div>
          <div className="space-y-1.5">
            {jobs.map((j) => {
              const done = /complet/i.test(j.state);
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
                  <span className="text-content-soft">{share > 0 ? `+${fmt(share, 3)} LCAI` : "-"}</span>
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
