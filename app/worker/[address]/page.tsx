"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Activity, AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WorkerView } from "@/components/worker-view";
import { OperationsPanel } from "@/components/operations-panel";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { useSavedWorkers } from "@/lib/saved-workers";
import { shortAddr } from "@/lib/utils";
import type { Worker, Job } from "@/lib/subgraph";

export default function WorkerPage() {
  const params = useParams<{ address: string }>();
  const address = (params?.address ?? "").toString();
  const { network } = useNetwork();
  const { has, add, remove } = useSavedWorkers();
  const net = NETWORKS[network];

  const [worker, setWorker] = useState<Worker | null | undefined>(undefined);
  const [jobs, setJobs] = useState<Job[]>([]);
  // Registration read straight from the chain (works for any worker a visitor opens),
  // so this shareable page shows the right status even when the index is stale.
  const [onchainRegistered, setOnchainRegistered] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);

  const load = useCallback(async () => {
    if (!valid) {
      setError("Invalid worker address.");
      return;
    }
    try {
      const r = await fetch(`/api/worker?net=${network}&address=${address}`).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "lookup failed");
      setWorker(r.worker);
      setJobs(Array.isArray(r.jobs) ? r.jobs : []);
      setOnchainRegistered(typeof r.onchainRegistered === "boolean" ? r.onchainRegistered : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [address, network, valid]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/network" className="mb-5 inline-flex items-center gap-1.5 text-sm text-content-soft hover:text-content-primary">
        <ArrowLeft className="size-4" /> Network
      </Link>

      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-content-primary">Worker</h1>
        <p className="mt-1 font-mono text-sm text-content-soft">{valid ? shortAddr(address) : address}</p>
      </div>

      {error && (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4" /> {error}
        </div>
      )}

      {worker === null && !error && (
        <Card className="mt-6 p-8 text-center text-content-soft">
          No worker found at <span className="font-mono text-content-primary">{shortAddr(address)}</span> on{" "}
          {net.label.toLowerCase()}.
        </Card>
      )}

      {worker === undefined && !error && (
        <Card className="mt-6 p-10 text-center text-content-soft">
          <Activity className="mx-auto mb-3 size-8" />
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className="size-3.5 animate-spin" /> Loading worker...
          </span>
        </Card>
      )}

      {worker && (
        <div className="mt-2">
          <WorkerView
            worker={worker}
            jobs={jobs}
            explorer={net.explorer}
            minStake={net.minStakeLcai}
            watched={has(worker.id)}
            onToggleWatch={() => (has(worker.id) ? remove(worker.id) : add(worker.id))}
            onchainRegistered={onchainRegistered}
          />
        </div>
      )}

      <Card className="mt-8 p-6">
        <OperationsPanel />
      </Card>
    </div>
  );
}
