"use client";

import { useEffect, useState } from "react";
import { BarChart3, Download, RefreshCw, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/lib/network-context";
import { modelStatsCsv, type ModelStat, type NetworkAnalytics } from "@/lib/analytics";
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

/** A thin success/incomplete bar for one model. */
function CompletionBar({ s }: { s: ModelStat }) {
  const denom = s.success + s.incomplete + s.disputed;
  if (denom === 0) return <div className="h-1.5 w-full rounded-full bg-surface-base-faint" />;
  const w = (n: number) => `${(n / denom) * 100}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
      <div className="h-full bg-success" style={{ width: w(s.success) }} />
      <div className="h-full bg-destructive/80" style={{ width: w(s.incomplete) }} />
      <div className="h-full bg-warning/70" style={{ width: w(s.disputed) }} />
    </div>
  );
}

export function ModelAnalytics() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<ModelStat[] | null>(null);
  const [summary, setSummary] = useState<NetworkAnalytics | null>(null);
  const [sampled, setSampled] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setStats(null);
    setSummary(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => {
          if (!on) return;
          if (!j.ok) return setErr(true);
          setStats(j.stats);
          setSummary(j.summary ?? null);
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

  const headline = [
    { label: "Completion", value: summary ? pct(summary.completionRate) : "-", tone: summary ? rateTone(summary.completionRate) : "" },
    { label: "Jobs sampled", value: fmt(sampled, 0) },
    { label: "Incomplete", value: summary ? fmt(summary.incomplete, 0) : "-", tone: summary && summary.incomplete > 0 ? "text-destructive" : "" },
    { label: "Earnings", value: summary ? `${fmt(summary.earnings, 2)} LCAI` : "-", tone: "text-success" },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bdr-soft px-5 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-content-primary">Model performance</h2>
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

      {/* Network headline */}
      {summary && (
        <div className="grid grid-cols-2 gap-px border-b border-bdr-soft bg-bdr-soft sm:grid-cols-4">
          {headline.map((h) => (
            <div key={h.label} className="bg-card px-5 py-3">
              <div className="text-[11px] text-content-soft">{h.label}</div>
              <div className={cn("text-xl font-semibold tabular-nums", h.tone || "text-content-primary")}>{h.value}</div>
            </div>
          ))}
        </div>
      )}

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
                <th className="px-3 py-2.5">Completion</th>
                <th className="px-3 py-2.5 text-right">p50</th>
                <th className="px-3 py-2.5 text-right">p95</th>
                <th className="px-3 py-2.5 text-right">Incomplete</th>
                <th className="px-3 py-2.5 text-right">Disputed</th>
                <th className="px-5 py-2.5 text-right">Earnings</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.modelId} className="border-b border-bdr-soft/60 last:border-0">
                  <td className="px-5 py-3 font-medium text-content-primary">{s.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-default">{fmt(s.total, 0)}</td>
                  <td className="min-w-[8rem] px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("w-9 shrink-0 text-right font-semibold tabular-nums", rateTone(s.completionRate))}>
                        {pct(s.completionRate)}
                      </span>
                      <CompletionBar s={s} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p50)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p95)}</td>
                  <td
                    className={cn("px-3 py-3 text-right tabular-nums", s.incomplete > 0 ? "text-destructive" : "text-content-soft")}
                    title={`${s.timedOut} timed out + ${s.stuck} acked-but-never-finished`}
                  >
                    {s.incomplete}
                  </td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", s.disputed > 0 ? "text-warning" : "text-content-soft")}>
                    {s.disputed}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-success">{fmt(s.earnings, 3)} LCAI</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-start gap-1.5 px-5 py-3 text-[11px] leading-relaxed text-content-soft">
        <Info className="mt-0.5 size-3 shrink-0" />
        Completion = succeeded / resolved. <span className="text-content-default">Incomplete</span> counts jobs taken but
        never finished in time: explicit timeouts plus jobs the indexer left in &quot;Acknowledged&quot; for over 10
        minutes (it rarely marks them timed-out, so these would otherwise be missed). Latency is acknowledged to
        completed; earnings are settled worker share over the sampled window.
      </p>
    </Card>
  );
}
