"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, Activity, ExternalLink, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveStats } from "@/components/live-stats";
import { ModelsPanel } from "@/components/models-panel";
import { ModelAnalytics } from "@/components/model-analytics";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";
import { openExternal } from "@/lib/tauri";
import { fmt, compact, shortAddr, timeAgo, cn } from "@/lib/utils";

interface Row {
  id: string;
  status: string;
  live: boolean;
  jobs_completed: number;
  earnedLcai: number;
  last_seen_at: number;
}

export default function NetworkPage() {
  const { network } = useNetwork();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState(false);
  const explorer = NETWORKS[network].explorer;

  useEffect(() => {
    let on = true;
    setRows(null);
    setErr(false);
    const load = () =>
      fetch(`/api/leaderboard?net=${network}`)
        .then((r) => r.json())
        .then((j) => on && (j.ok ? setRows(j.workers) : setErr(true)))
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-content-primary">Network</h1>
        <p className="mt-2 text-content-soft">
          Live overview of the LightChain {NETWORKS[network].label.toLowerCase()} AI worker network.
        </p>
      </div>

      <div className="mb-8">
        <LiveStats />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-bdr-soft px-5 py-4">
          <Trophy className="size-4 text-warning" />
          <h2 className="text-sm font-semibold text-content-primary">Top workers</h2>
          <span className="text-xs text-content-soft">by jobs completed</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-content-soft">
            <RefreshCw className="size-3" /> 30s
          </span>
        </div>

        {err && !rows && <p className="px-5 py-8 text-center text-sm text-content-soft">Leaderboard unavailable right now.</p>}

        <div className="divide-y divide-bdr-light">
          {(rows ?? Array.from({ length: 8 }, () => null)).map((r, i) => (
            <div key={r?.id ?? i} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="w-6 text-right font-mono text-content-soft">{i + 1}</span>
              <span
                className={cn("dot", !r ? "dot-idle" : r.status === "active" ? "dot-live" : "dot-down")}
              />
              <Link
                href={`/worker/${r?.id ?? ""}`}
                className="flex-1 font-mono text-content-primary hover:text-primary"
              >
                {r ? shortAddr(r.id) : "-"}
              </Link>
              <span className="hidden w-28 text-right text-content-soft sm:block">
                {r ? `${fmt(r.jobs_completed, 0)} jobs` : "-"}
              </span>
              <span className="w-28 text-right font-medium text-success">{r ? `${fmt(r.earnedLcai, 2)} LCAI` : "-"}</span>
              <span className="hidden w-20 text-right text-content-soft md:block">{r ? timeAgo(r.last_seen_at) : ""}</span>
              {r && (
                <button type="button" onClick={() => openExternal(`${explorer}/address/${r.id}`)} className="text-content-soft hover:text-content-primary" aria-label="Explorer">
                  <ExternalLink className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {rows && rows.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-content-soft">
            <Activity className="mx-auto mb-2 size-6" /> No workers registered yet.
          </p>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-content-soft">
        <Badge tone="success">online</Badge> active &amp; staked
        <Badge tone="danger">offline</Badge> deregistered / inactive
        <span className="text-content-soft">- open a worker for its live heartbeat &amp; earnings.</span>
      </div>

      <div className="mt-8">
        <ModelAnalytics />
      </div>

      <Card className="mt-8 p-6">
        <ModelsPanel />
      </Card>
    </div>
  );
}
