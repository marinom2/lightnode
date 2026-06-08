"use client";

/**
 * Model demand: a visual bar chart of how the network's recent jobs split across
 * models, with earnings per model. Complements the model-analytics TABLE with an
 * at-a-glance "what is in demand" read. Reads /api/analytics (per-model stats).
 */
import { useEffect, useState } from "react";
import { Layers, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { compact, fmt, cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";

interface ModelStat {
  modelId: string;
  name: string;
  total: number;
  completionRate: number | null;
  earnings: number;
}

export function ModelDemand() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<ModelStat[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let on = true;
    setStats(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => on && (j.ok ? setStats(j.stats ?? []) : setErr(true)))
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const rows = (stats ?? []).filter((s) => s.total > 0).slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const totalJobs = rows.reduce((s, r) => s + r.total, 0) || 1;

  return (
    <Card className="overflow-hidden p-6">
      <div className="mb-4 flex items-center gap-2">
        <Layers className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-content-primary">Model demand</h2>
        <span className="text-xs text-content-soft">recent job share per model</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-content-soft">
          <RefreshCw className="size-3" /> 30s
        </span>
      </div>

      {err && !stats ? (
        <p className="py-6 text-center text-sm text-content-soft">Analytics unavailable right now.</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-content-soft">{stats ? "No model activity in the recent sample." : "Loading..."}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((m) => (
            <div key={m.modelId}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium text-content-primary">{m.name || "unknown model"}</span>
                <span className="shrink-0 text-content-soft">
                  {compact(m.total)} jobs · {Math.round((m.total / totalJobs) * 100)}% ·{" "}
                  <span className="text-success">{fmt(m.earnings, 2)} LCAI</span>
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
                <div
                  className={cn("h-full rounded-full", m.completionRate != null && m.completionRate < 0.85 ? "bg-warning" : "bg-gradient-primary")}
                  style={{ width: `${Math.max(3, (m.total / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
