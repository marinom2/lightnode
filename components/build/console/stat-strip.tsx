"use client";

import { useEffect, useState } from "react";
import { useNetwork } from "@/lib/network-context";

interface NetStats {
  total: number;
  active: number;
  live: number;
  models: number;
  jobsCompleted: number;
  totalEarnedLcai: number;
}

function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

/**
 * A compact live strip of network stats, read from /api/network for the
 * currently-selected network. Proves the console is wired to real data, not a
 * mockup. Degrades to "—" if the indexer is unreachable.
 */
export function StatStrip() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<NetStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let on = true;
    setStats(null);
    setFailed(false);
    fetch(`/api/network?net=${network}`)
      .then((r) => r.json())
      .then((d) => {
        if (!on) return;
        if (d?.ok && d.stats) setStats(d.stats as NetStats);
        else setFailed(true);
      })
      .catch(() => on && setFailed(true));
    return () => {
      on = false;
    };
  }, [network]);

  const cells: Array<{ label: string; value: string }> = [
    { label: "Live workers", value: stats ? compact(stats.live) : failed ? "—" : "" },
    { label: "Models", value: stats ? compact(stats.models) : failed ? "—" : "" },
    { label: "Jobs completed", value: stats ? compact(stats.jobsCompleted) : failed ? "—" : "" },
    { label: "LCAI earned", value: stats ? compact(stats.totalEarnedLcai) : failed ? "—" : "" },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-bdr-soft bg-bdr-soft sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-wide text-content-soft">{c.label}</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-content-primary">
            {c.value === "" ? <span className="inline-block h-5 w-12 animate-pulse rounded bg-surface-base-light" /> : c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
