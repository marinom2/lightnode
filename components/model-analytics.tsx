"use client";

import { useEffect, useState } from "react";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/lib/network-context";
import { modelStatsCsv, type ModelStat } from "@/lib/analytics";
import { fmt, cn } from "@/lib/utils";

function pct(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function rateTone(r: number | null): string {
  if (r == null) return "text-content-soft";
  if (r >= 0.95) return "text-success";
  if (r >= 0.8) return "text-warning";
  return "text-destructive";
}
function secs(n: number | null): string {
  return n == null ? "-" : `${n}s`;
}

export function ModelAnalytics() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<ModelStat[] | null>(null);
  const [sampled, setSampled] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setStats(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => {
          if (!on) return;
          if (!j.ok) return setErr(true);
          setStats(j.stats);
          setSampled(j.sampled ?? 0);
        })
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const exportCsv = () => {
    if (!stats || stats.length === 0) return;
    const blob = new Blob([modelStatsCsv(stats)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lightchain-${network}-model-stats.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bdr-soft px-5 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-content-primary">Model performance</h2>
          <span className="text-xs text-content-soft">last {fmt(sampled, 0)} jobs</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-content-soft">
            <RefreshCw className="size-3" /> 30s
          </span>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!stats || stats.length === 0}>
            <Download /> CSV
          </Button>
        </div>
      </div>

      {err && !stats && <p className="px-5 py-8 text-center text-sm text-content-soft">Analytics unavailable right now.</p>}
      {!err && stats == null && <div className="px-5 py-8 text-center text-sm text-content-soft">Loading…</div>}
      {stats && stats.length === 0 && <p className="px-5 py-8 text-center text-sm text-content-soft">No jobs yet on this network.</p>}

      {stats && stats.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bdr-soft text-left text-[11px] font-medium text-content-soft">
                <th className="px-5 py-2.5">Model</th>
                <th className="px-3 py-2.5 text-right">Jobs</th>
                <th className="px-3 py-2.5 text-right">Completion</th>
                <th className="px-3 py-2.5 text-right">p50</th>
                <th className="px-3 py-2.5 text-right">p95</th>
                <th className="px-3 py-2.5 text-right">Timed out</th>
                <th className="px-3 py-2.5 text-right">Disputed</th>
                <th className="px-5 py-2.5 text-right">Earnings</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.modelId} className="border-b border-bdr-soft/60 last:border-0">
                  <td className="px-5 py-3 font-medium text-content-primary">{s.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-default">{fmt(s.total, 0)}</td>
                  <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", rateTone(s.completionRate))}>
                    {pct(s.completionRate)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p50)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p95)}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", s.timedOut > 0 ? "text-warning" : "text-content-soft")}>
                    {s.timedOut}
                  </td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", s.disputed > 0 ? "text-destructive" : "text-content-soft")}>
                    {s.disputed}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-success">{fmt(s.earnings, 3)} LCAI</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-3 text-[11px] text-content-soft">
        Completion = succeeded / resolved (in-flight excluded). Latency is acknowledged to completed. Earnings are
        settled worker share over the sampled window.
      </p>
    </Card>
  );
}
