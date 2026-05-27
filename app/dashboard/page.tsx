"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Activity, AlertTriangle, RefreshCw, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModelsPanel } from "@/components/models-panel";
import { WatchGrid } from "@/components/watch-grid";
import { OperationsPanel } from "@/components/operations-panel";
import { WithdrawWorker } from "@/components/withdraw-worker";
import { DownloadButton } from "@/components/download-button";
import { WorkerHealthPanel } from "@/components/worker-health-panel";
import { WorkerView } from "@/components/worker-view";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { useSavedWorkers } from "@/lib/saved-workers";
import { getWorkerAddr, setWorkerAddr } from "@/lib/secrets";
import { isDesktop, localContainerStatus, isStreamBusy, type LocalContainerStatus } from "@/lib/tauri";
import { shortAddr, cn } from "@/lib/utils";
import type { Worker, Job } from "@/lib/subgraph";

export default function DashboardPage() {
  const { network } = useNetwork();
  const { saved, add, remove, has } = useSavedWorkers();
  const [myWorker, setMyWorker] = useState("");
  // Per-network: the "My worker" for testnet vs mainnet are different workers.
  useEffect(() => setMyWorker(getWorkerAddr(network)), [network]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [worker, setWorker] = useState<Worker | null | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [localStatus, setLocalStatus] = useState<LocalContainerStatus | null>(null);
  // Worker operations (install/settle/withdraw) run in the desktop app, never via
  // copy-paste on the web. On the web the dashboard is a read-only tracker.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isDesktop()), []);

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
        // If this is one of YOUR (watchlisted) workers, tag it as this network's
        // worker so the per-network "My worker" + Operations target stay correct.
        if (r.worker && has(addr)) {
          setWorkerAddr(network, addr);
          setMyWorker(addr);
        }
      } catch (e) {
        setError((e as Error).message);
        setWorker(undefined);
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network, has],
  );

  // Auto-select a worker to show. A ?address= deep-link wins (e.g. from the
  // leaderboard); otherwise default to THIS network's worker, or the first
  // watchlisted one. Done once per network (tracked by `autoFor`) so it opens
  // straight onto your worker instead of an empty prompt, without overriding a
  // manual lookup or re-triggering when the watchlist changes.
  const autoFor = useRef("");
  useEffect(() => {
    if (autoFor.current === network) return;
    const valid = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);
    const deeplink = new URLSearchParams(window.location.search).get("address") ?? "";
    const candidate = valid(deeplink) ? deeplink : getWorkerAddr(network) || saved.find(valid) || "";
    if (!valid(candidate)) return;
    autoFor.current = network;
    setInput(candidate);
    setQuery(candidate);
  }, [network, saved]);

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

  // In the desktop app, show the REAL local container state for YOUR worker -
  // the one signal the on-chain subgraph can't see (it only knows "registered").
  const isMine = !!worker && !!myWorker && worker.id.toLowerCase() === myWorker.toLowerCase();
  useEffect(() => {
    if (!isMine || !isDesktop()) {
      setLocalStatus(null);
      return;
    }
    let on = true;
    // Skip while a streamed Operations command is running - both share the native
    // runner's global event channel, so polling docker ps mid-command would leak
    // "Up N minutes" lines into that command's log.
    const check = () => {
      if (isStreamBusy()) return;
      localContainerStatus().then((s) => on && setLocalStatus(s));
    };
    check();
    const t = setInterval(check, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [isMine]);

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
            localStatus={localStatus}
          />
          {isMine && desktop && (
            <div className="mt-4">
              <WorkerHealthPanel />
            </div>
          )}
        </div>
      )}

      {worker === undefined && !error && !loading && (
        <Card className="mt-6 p-10 text-center">
          <Activity className="mx-auto mb-3 size-8 text-content-soft" />
          <p className="text-content-soft">Enter a worker address to see its live status.</p>
        </Card>
      )}

      {desktop ? (
        <>
          <Card className="mt-8 p-6">
            <OperationsPanel />
          </Card>
          <div className="mt-4">
            <WithdrawWorker />
          </div>
        </>
      ) : (
        <Card className="mt-8 overflow-hidden p-0">
          <div className="relative p-6">
            <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-gradient-primary opacity-15 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-md">
                <h3 className="text-sm font-semibold text-content-primary">Manage your worker from the app</h3>
                <p className="mt-1 text-sm text-content-soft">
                  Install, settle earnings, withdraw, and keep your worker online with one click in the LightNode desktop
                  app. This page tracks any worker live; the controls live in the app.
                </p>
              </div>
              <DownloadButton />
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-4 p-6">
        <ModelsPanel />
      </Card>
    </div>
  );
}
