"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Activity, AlertTriangle, RefreshCw, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModelsPanel } from "@/components/models-panel";
import { WatchGrid } from "@/components/watch-grid";
import { OperationsPanel } from "@/components/operations-panel";
import { WorkerView } from "@/components/worker-view";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { useSavedWorkers } from "@/lib/saved-workers";
import { shortAddr, cn } from "@/lib/utils";
import type { Worker, Job } from "@/lib/subgraph";

export default function DashboardPage() {
  const { network } = useNetwork();
  const { saved, add, remove, has } = useSavedWorkers();
  const [myWorker, setMyWorker] = useState("");
  useEffect(() => {
    try { const w = window.localStorage.getItem("lightnode.workerAddress"); if (w) setMyWorker(w); } catch { /* ignore */ }
  }, []);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [worker, setWorker] = useState<Worker | null | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[]>([]);
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
        setJobs(Array.isArray(r.jobs) ? r.jobs : []);
      } catch (e) {
        setError((e as Error).message);
        setWorker(undefined);
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    [network],
  );

  // Deep-link support: /dashboard?address=0x... (e.g. from the leaderboard).
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("address");
    if (a && /^0x[a-fA-F0-9]{40}$/.test(a)) {
      setInput(a);
      setQuery(a);
    }
  }, []);

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
            placeholder="0x... worker address"
            className="h-11 w-full rounded-xl border border-bdr-soft bg-surface-base-subtle pl-9 pr-3 font-mono text-sm text-content-primary outline-none focus:border-primary"
          />
        </div>
        <Button type="submit" variant="gradient" disabled={loading}>
          {loading ? <RefreshCw className="animate-spin" /> : <Search />} Look up
        </Button>
        {(myWorker || saved[0]) && (
          <Button type="button" variant="outline" onClick={() => { const w = myWorker || saved[0]; setInput(w); setQuery(w); }}>
            My worker
          </Button>
        )}
      </form>
      <p className="mt-2 text-xs text-content-soft">
        Tip: your worker address is printed by <code className="rounded bg-surface-base-light px-1 py-0.5">08-run-worker</code> /{" "}
        <code className="rounded bg-surface-base-light px-1 py-0.5">status</code> - it&apos;s the generated worker key, not your funder wallet.
      </p>

      {saved.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <Star className="size-4 fill-warning text-warning" />
            <h2 className="text-sm font-semibold text-content-primary">Your watchlist</h2>
            <span className="text-xs text-content-soft">live overview · click to open</span>
          </div>
          <WatchGrid
            addresses={saved}
            network={network}
            active={query}
            onSelect={(a) => {
              setInput(a);
              setQuery(a);
            }}
          />
        </div>
      )}

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

      {worker && (
        <div className="mt-6">
          <WorkerView
            worker={worker}
            jobs={jobs}
            explorer={net.explorer}
            minStake={net.minStakeLcai}
            watched={has(worker.id)}
            onToggleWatch={() => (has(worker.id) ? remove(worker.id) : add(worker.id))}
          />
        </div>
      )}

      {worker === undefined && !error && !loading && (
        <Card className="mt-6 p-10 text-center">
          <Activity className="mx-auto mb-3 size-8 text-content-soft" />
          <p className="text-content-soft">Enter a worker address to see its live status.</p>
        </Card>
      )}

      <Card className="mt-8 p-6">
        <OperationsPanel />
      </Card>

      <Card className="mt-4 p-6">
        <ModelsPanel />
      </Card>
    </div>
  );
}
