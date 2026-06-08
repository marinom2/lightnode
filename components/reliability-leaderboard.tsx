"use client";

/**
 * Reliability leaderboard: ranks workers by completion rate (then by p95 latency),
 * not raw job count - so "who is the most dependable worker" is answerable, which
 * the jobs-completed leaderboard can't show. Reads /api/analytics (the same recent
 * sample the model analytics use), no extra endpoint.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { fmt, shortAddr, cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";

interface WorkerStat {
  address: string;
  total: number;
  completionRate: number | null;
  p50: number | null;
  p95: number | null;
  earnings: number;
}

export function ReliabilityLeaderboard() {
  const { network } = useNetwork();
  const [rows, setRows] = useState<WorkerStat[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setRows(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => on && (j.ok ? setRows(j.workers ?? []) : setErr(true)))
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  // Rank by completion rate desc (workers with no rate sink to the bottom), then
  // by p95 latency asc (faster is better). Only workers with a few jobs, so a
  // single lucky completion doesn't top the chart.
  const ranked = (rows ?? [])
    .filter((w) => w.total >= 3 && w.completionRate != null)
    .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0) || (a.p95 ?? 1e9) - (b.p95 ?? 1e9))
    .slice(0, 15);

  const rateTone = (r: number | null) => (r == null ? "text-content-soft" : r >= 0.95 ? "text-success" : r >= 0.85 ? "text-warning" : "text-danger");

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-bdr-soft px-5 py-4">
        <ShieldCheck className="size-4 text-success" />
        <h2 className="text-sm font-semibold text-content-primary">Most reliable workers</h2>
        <span className="text-xs text-content-soft">by completion rate, then speed</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-content-soft">
          <RefreshCw className="size-3" /> 30s
        </span>
      </div>
      {err && !rows && <p className="px-5 py-8 text-center text-sm text-content-soft">Analytics unavailable right now.</p>}
      <div className="divide-y divide-bdr-light">
        <div className="flex items-center gap-3 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-content-soft">
          <span className="w-6 text-right">#</span>
          <span className="flex-1">Worker</span>
          <span className="w-20 text-right">Complete</span>
          <span className="hidden w-16 text-right sm:block">p95</span>
          <span className="hidden w-16 text-right md:block">Jobs</span>
          <span className="w-24 text-right">Earned</span>
        </div>
        {(ranked.length ? ranked : rows ? [] : Array.from({ length: 6 }, () => null)).map((w, i) => (
          <div key={w?.address ?? i} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="w-6 text-right font-mono text-content-soft">{i + 1}</span>
            <Link href={`/worker/${w?.address ?? ""}`} className="flex-1 truncate font-mono text-content-primary hover:text-primary">
              {w ? shortAddr(w.address) : "-"}
            </Link>
            <span className={cn("w-20 text-right font-semibold", rateTone(w?.completionRate ?? null))}>
              {w && w.completionRate != null ? `${Math.round(w.completionRate * 100)}%` : "-"}
            </span>
            <span className="hidden w-16 text-right text-content-soft sm:block">{w?.p95 != null ? `${w.p95}s` : "-"}</span>
            <span className="hidden w-16 text-right text-content-soft md:block">{w ? fmt(w.total, 0) : "-"}</span>
            <span className="w-24 text-right font-medium text-success">{w ? `${fmt(w.earnings, 2)}` : "-"}</span>
          </div>
        ))}
        {rows && ranked.length === 0 && !err && (
          <p className="px-5 py-8 text-center text-sm text-content-soft">Not enough recent jobs to rank reliability yet.</p>
        )}
      </div>
    </Card>
  );
}
