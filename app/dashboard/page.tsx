"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import {
  Search,
  Coins,
  CheckCircle2,
  Clock,
  Activity,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModelsPanel } from "@/components/models-panel";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { fromWei, fmt, compact, timeAgo, shortAddr, cn } from "@/lib/utils";
import type { Worker } from "@/lib/subgraph";

type Health = "live" | "stale" | "down";

function healthOf(w: Worker): Health {
  if (w.status !== "active") return "down";
  if (!w.last_seen_at) return "down";
  return Math.floor(Date.now() / 1000) - w.last_seen_at < 20 * 60 ? "live" : "stale";
}

const HEALTH: Record<Health, { tone: "success" | "warning" | "danger"; label: string; hint: string }> = {
  live: { tone: "success", label: "Live", hint: "Heartbeat fresh — serving jobs." },
  stale: { tone: "warning", label: "Stale heartbeat", hint: "Active on-chain but no recent heartbeat. Check the container / watchdog." },
  down: { tone: "danger", label: "Offline", hint: "Not active. Deregistered, deactivated, or never started." },
};

export default function DashboardPage() {
  const { address } = useAccount();
  const { network } = useNetwork();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [worker, setWorker] = useState<Worker | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (addr: string) => {
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        setError("Enter a valid 0x worker address.");
        return;
      }
      setError("");
      setLoading(true);
      try {
        const r = await fetch(`/api/worker?net=${network}&address=${addr}`).then((x) => x.json());
        if (!r.ok) throw new Error(r.error || "lookup failed");
        setWorker(r.worker);
      } catch (e) {
        setError((e as Error).message);
        setWorker(undefined);
      } finally {
        setLoading(false);
      }
    },
    [network],
  );

  useEffect(() => {
    if (!query) return;
    load(query);
    const t = setInterval(() => load(query), 20_000);
    return () => clearInterval(t);
  }, [query, load]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  const net = NETWORKS[network];

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-content-primary">Worker dashboard</h1>
        <p className="mt-2 text-content-soft">
          Live status, earnings, and health for any LightChain {net.label.toLowerCase()} worker.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-soft" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x… worker address"
            className="h-11 w-full rounded-xl border border-bdr-soft bg-surface-base-subtle pl-9 pr-3 font-mono text-sm text-content-primary outline-none focus:border-primary"
          />
        </div>
        <Button type="submit" variant="gradient" disabled={loading}>
          {loading ? <RefreshCw className="animate-spin" /> : <Search />} Look up
        </Button>
        {address && (
          <Button type="button" variant="outline" onClick={() => { setInput(address); setQuery(address); }}>
            Use connected
          </Button>
        )}
      </form>
      <p className="mt-2 text-xs text-content-soft">
        Tip: your worker address is printed by <code className="rounded bg-surface-base-light px-1 py-0.5">08-run-worker</code> /{" "}
        <code className="rounded bg-surface-base-light px-1 py-0.5">status</code> — it&apos;s the generated worker key, not your funder wallet.
      </p>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {error}
        </div>
      )}

      {worker === null && !error && (
        <Card className="mt-6 p-8 text-center">
          <p className="text-content-soft">
            No worker found at <span className="font-mono text-content-primary">{shortAddr(query)}</span> on{" "}
            {net.label.toLowerCase()}. It may not be registered yet.
          </p>
        </Card>
      )}

      {worker && <WorkerView worker={worker} explorer={net.explorer} minStake={net.minStakeLcai} />}

      {worker === undefined && !error && !loading && (
        <Card className="mt-6 p-10 text-center">
          <Activity className="mx-auto mb-3 size-8 text-content-soft" />
          <p className="text-content-soft">Enter a worker address to see its live status.</p>
        </Card>
      )}

      <Card className="mt-8 p-6">
        <ModelsPanel />
      </Card>
    </div>
  );
}

function WorkerView({ worker, explorer, minStake }: { worker: Worker; explorer: string; minStake: number }) {
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
    <div className="mt-6 space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "size-2.5 rounded-full",
                h === "live" ? "bg-success animate-pulse-dot" : h === "stale" ? "bg-warning" : "bg-destructive",
              )}
            />
            <span className="font-mono text-sm text-content-primary">{shortAddr(worker.id)}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {(worker.active_job_count ?? 0) > 0 && <Badge tone="brand">{worker.active_job_count} active job(s)</Badge>}
          </div>
          <a href={`${explorer}/address/${worker.id}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              Explorer <ExternalLink />
            </Button>
          </a>
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

      {(worker.jobs_timed_out ?? 0) > 0 && (
        <Card className="border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-2 text-sm text-content-default">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium text-content-primary">{worker.jobs_timed_out} timed-out job(s).</span> Each
              ack-then-incomplete job risks a slash. Make sure the liveness watchdog is running and Ollama serves{" "}
              <code className="rounded bg-surface-base-light px-1 py-0.5">llama3-8b</code> by that exact name.
            </span>
          </div>
        </Card>
      )}

      {stake < minStake && worker.status === "active" && (
        <Card className="border-warning/30 bg-warning/10 p-4 text-sm text-content-default">
          Stake is below the {minStake.toLocaleString()} LCAI floor — likely slashed. Top up to stay eligible for jobs.
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
