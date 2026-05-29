"use client";

import { useEffect, useState } from "react";
import { Activity, Cpu, Layers, Coins } from "lucide-react";
import { compact, fmt } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";

interface NetworkResponse {
  ok: boolean;
  stats?: { total: number; active: number; live: number; models: number; jobsCompleted: number; totalEarnedLcai: number };
}

export function LiveStats() {
  const { network } = useNetwork();
  const [data, setData] = useState<NetworkResponse | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setData(null);
    setErr(false);
    const load = () =>
      fetch(`/api/network?net=${network}`)
        .then((r) => r.json())
        .then((j) => on && (setData(j), setErr(!j.ok)))
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const s = data?.stats;
  // "Online" = workers the chain reports as active (registered + staked + not
  // deregistered). The 20-min heartbeat ("live") is a finer per-worker signal we
  // surface on the dashboard - it's too volatile to headline (it can read 0 even
  // when a healthy, earning pool exists).
  const tiles = [
    { icon: Activity, label: "Workers online", value: s ? fmt(s.active, 0) : "-", tone: "text-success" },
    { icon: Cpu, label: "Total registered", value: s ? fmt(s.total, 0) : "-", tone: "text-content-primary" },
    { icon: Layers, label: "Models live", value: s ? fmt(s.models, 0) : "-", tone: "text-primary" },
    { icon: Coins, label: "LCAI paid to workers", value: s ? compact(s.totalEarnedLcai) : "-", tone: "text-content-primary" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-bdr-soft bg-card/50 p-4 backdrop-blur-sm"
        >
          <div className="mb-2 flex items-center gap-2 text-content-soft">
            <t.icon className="size-4" />
            <span className="text-xs font-medium">{t.label}</span>
          </div>
          <div className={`text-2xl font-semibold tracking-tight ${t.tone}`}>
            {err && !s ? "-" : t.value}
          </div>
        </div>
      ))}
      <p className="col-span-2 -mt-1 text-xs text-content-soft md:col-span-4">
        {err ? (
          <span className="text-warning">Live network feed unavailable right now.</span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success animate-pulse-dot" />
            Live from the LightChain {NETWORKS[network].label.toLowerCase()} worker subgraph, refreshing every 30s
          </span>
        )}
      </p>
    </div>
  );
}
