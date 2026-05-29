"use client";

import { useEffect, useState } from "react";
import { HeartPulse, Boxes, Sparkles, Banknote, Hourglass, Loader2 } from "lucide-react";
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
  icon: typeof Boxes;
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
export function WorkerHealthPanel({
  expectedChainId,
  onHealth,
}: {
  expectedChainId?: number;
  // Report each good reading up so the dashboard can use the gateway-validated
  // state as the authoritative worker status (the subgraph can be wrong).
  onHealth?: (h: WorkerHealth) => void;
}) {
  const [h, setH] = useState<WorkerHealth | null | undefined>(undefined);

  useEffect(() => {
    let on = true;
    const tick = () =>
      fetchWorkerHealth().then((r) => {
        if (!on) return;
        // keep the last good reading on a transient null (busy channel / blip)
        setH((prev) => (r ? r : prev === undefined ? null : prev));
        if (r) onHealth?.(r);
      });
    tick();
    const t = setInterval(tick, 8_000); // responsive enough to catch a job in flight
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [onHealth]);

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

  const modelWarm = h.modelMemBytes != null && h.modelMemBytes > 0;
  const servedName = h.servedModel?.replace(/:latest$/, "") ?? null;
  const processing = (h.activeJobs ?? 0) > 0;

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
      <div className="relative mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-content-soft">
        {h.running ? (
          <>
            <span>Up {h.uptime || "just now"}</span>
            <span aria-hidden className="h-3 w-px bg-bdr-soft" />
            <span>{hb}</span>
            {h.gatewayConnected && (
              <>
                <span aria-hidden className="h-3 w-px bg-bdr-soft" />
                <span className="text-success">gateway connected</span>
              </>
            )}
          </>
        ) : (
          <span>Container stopped on this machine</span>
        )}
      </div>

      {/* the live "am I working right now" signal */}
      <div
        className={cn(
          "relative mb-3 flex items-center gap-3 rounded-xl border p-4 transition-colors",
          processing ? "border-success/40 bg-success/10" : "border-bdr-soft bg-surface-base-subtle/50",
        )}
      >
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            processing ? "bg-success/20 text-success" : "bg-surface-base-light text-content-soft",
          )}
        >
          {processing ? <Loader2 className="size-5 animate-spin" /> : <Boxes className="size-5" />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            {processing ? `Processing ${h.activeJobs} job${h.activeJobs === 1 ? "" : "s"} now` : "Idle - ready for jobs"}
            <span className="rounded-md bg-surface-base-light px-1.5 py-0.5 font-mono text-[11px] text-content-soft">
              {h.activeJobs ?? 0}/{h.maxJobs ?? 2} slots
            </span>
          </div>
          <div className="text-xs text-content-soft">
            {processing
              ? "Serving inference right now - you earn once it completes and settles."
              : "The gateway routes jobs to you automatically; this lights up when one is in flight."}
          </div>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={Sparkles}
          label="Model"
          value={modelWarm ? "warm" : h.modelMemBytes === 0 ? "cold" : h.ollamaUp ? "ready" : "-"}
          tone={modelWarm ? "text-success" : h.modelMemBytes === 0 ? "text-warning" : "text-content-primary"}
          sub={
            servedName
              ? `${servedName}${modelWarm ? ` (${(h.modelMemBytes! / 1e9).toFixed(1)} GB)` : " (loads on demand)"}`
              : "via Ollama"
          }
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
      </div>
      {h.modelMemBytes === 0 && (
        <p className="relative mt-2 text-[11px] text-content-soft">
          Model is cold (unloaded while idle). It warms on the next job or when the keep-online watchdog runs - a cold
          first job just loads a bit slower.
        </p>
      )}
      <p className="relative mt-2 text-[11px] text-content-soft">
        Live from the worker on this machine, refreshed every few seconds. Jobs completed + earnings tick up in the cards
        above.
      </p>
      <p className="relative mt-1.5 flex items-start gap-1.5 text-[11px] text-content-soft">
        <Sparkles className="mt-0.5 size-3 shrink-0 text-warning" />
        For 24/7 uptime, run on a machine that won&apos;t sleep - a Linux server is ideal. On a laptop, keep it plugged in
        with the lid open; on battery or with the lid closed the OS sleeps, which pauses the worker (uptime above resets)
        until it wakes and the watchdog restarts it.
      </p>
    </Card>
  );
}
