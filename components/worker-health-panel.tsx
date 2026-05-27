"use client";

import { useEffect, useState } from "react";
import { HeartPulse, Boxes, Sparkles, Banknote, Cpu, MemoryStick, Hourglass, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchWorkerHealth, type WorkerHealth } from "@/lib/tauri";
import { cn } from "@/lib/utils";

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "text-content-primary",
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-subtle/60 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-content-soft">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-content-soft">{sub}</div>}
    </div>
  );
}

/**
 * Live health of the worker running on THIS machine - the real-time telemetry the
 * on-chain subgraph can't see. Desktop only; polls the worker's local metrics via
 * the native bridge. Renders nothing on the web or when no worker is found locally.
 */
export function WorkerHealthPanel({ expectedChainId }: { expectedChainId?: number }) {
  const [h, setH] = useState<WorkerHealth | null | undefined>(undefined);

  useEffect(() => {
    let on = true;
    const tick = () =>
      fetchWorkerHealth().then((r) => {
        if (!on) return;
        // keep the last good reading on a transient null (busy channel / blip)
        setH((prev) => (r ? r : prev === undefined ? null : prev));
      });
    tick();
    const t = setInterval(tick, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);

  if (h === undefined) {
    return (
      <Card className="p-6">
        <div className="h-5 w-32 animate-pulse rounded bg-surface-base-light" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-base-subtle" />
          ))}
        </div>
      </Card>
    );
  }
  if (h === null) return null; // no local worker / Docker unreachable - nothing to show

  // The machine runs ONE worker container. If it serves a different network than
  // the worker being viewed, its health isn't this worker's - say so plainly
  // instead of showing another worker's telemetry under this one.
  if (expectedChainId && h.chainId && h.chainId !== expectedChainId) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-2.5 text-sm text-content-soft">
          <HeartPulse className="mt-0.5 size-4 shrink-0" />
          <span>
            The worker running on this machine serves a different network (chain {h.chainId}). Live health is shown for
            the worker that matches the network toggle at the top.
          </span>
        </div>
      </Card>
    );
  }

  const live = h.running && h.heartbeatAgoSec != null && h.heartbeatAgoSec < 90;
  const statusTone = live ? "success" : h.running ? "warning" : "muted";
  const statusLabel = live ? "Live" : h.running ? "Running (stale heartbeat)" : "Offline";

  const hb =
    h.heartbeatAgoSec == null ? "no heartbeat yet" : h.heartbeatAgoSec < 90 ? `heartbeat ${h.heartbeatAgoSec}s ago` : `last heartbeat ${Math.floor(h.heartbeatAgoSec / 60)}m ago`;

  return (
    <Card className="relative overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-48 rounded-full opacity-15 blur-3xl"
        style={{ background: `radial-gradient(circle, ${live ? "#1fc16b" : "#7064e9"}, transparent 70%)` }}
      />
      <div className="relative mb-4 flex flex-wrap items-center gap-2">
        <span className={cn("dot", live ? "dot-live" : h.running ? "dot-warn" : "dot-down")} />
        <HeartPulse className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Live health</h3>
        <Badge tone={statusTone} className="ml-auto">{statusLabel}</Badge>
      </div>
      <p className="relative mb-4 text-xs text-content-soft">
        {h.running ? `Up ${h.uptime || "just now"} · ${hb}` : "Container stopped on this machine"}
        {h.gatewayConnected && " · gateway connected"}
      </p>

      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          icon={Boxes}
          label="Active jobs"
          value={`${h.activeJobs ?? 0} / ${h.maxJobs ?? 2}`}
          sub="in flight"
        />
        <Stat
          icon={Sparkles}
          label="Ollama"
          value={h.ollamaUp == null ? "-" : h.ollamaUp ? "ready" : "down"}
          tone={h.ollamaUp ? "text-success" : h.ollamaUp === false ? "text-warning" : "text-content-primary"}
          sub="model server"
        />
        <Stat icon={Banknote} label="Released" value={`${h.releasedTotal ?? 0}`} sub="jobs paid out" />
        <Stat icon={Hourglass} label="Pending release" value={`${h.releasePending ?? 0}`} sub="awaiting settle" />
        <Stat icon={Cpu} label="CPU" value={h.cpuPct == null ? "-" : `${h.cpuPct.toFixed(0)}%`} sub="container" />
        <Stat icon={MemoryStick} label="Memory" value={h.memUsed ?? "-"} sub="container" />
      </div>

      {h.recentEvents.length > 0 && (
        <div className="relative mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-content-soft">
            <Radio className="size-3.5" /> Recent activity
          </div>
          <div className="space-y-1">
            {h.recentEvents.map((e, i) => (
              <div key={i} className="truncate rounded-md bg-surface-base-subtle/50 px-2 py-1 text-[11px] text-content-default">
                {e}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="relative mt-3 text-[11px] text-content-soft">
        Live from the worker on this machine (local metrics). GPU telemetry isn&apos;t reported on this platform.
      </p>
    </Card>
  );
}
