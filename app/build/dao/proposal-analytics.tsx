"use client";

import { useEffect, useState } from "react";
import { BarChart3, CheckCircle2, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { short } from "@/components/build/console/panel-kit";
import type { DaoChain } from "./dao-chain";

interface DecodedAction {
  target: string;
  valueLcai: number;
  label: string;
  dangerous: boolean;
}
interface Executed {
  id: string;
  title: string;
  actions: DecodedAction[];
}
interface Stats {
  total: number;
  byState: Record<string, number>;
  decided: number;
  passed: number;
  passRatePct: number;
  quorumChecked: number;
  quorumReached: number;
  quorumHitRatePct: number;
}
interface AnalyticsResp {
  stats: Stats;
  executed: Executed[];
  explorer: string;
  error?: string;
}

const STATE_TONE: Record<string, string> = {
  executed: "text-success",
  succeeded: "text-success",
  queued: "text-warning",
  active: "text-primary",
  pending: "text-warning",
  defeated: "text-destructive",
  canceled: "text-destructive",
  expired: "text-destructive",
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-content-soft">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-content-primary">{value}</p>
      {sub && <p className="text-[11px] text-content-soft">{sub}</p>}
    </div>
  );
}

export function ProposalAnalytics({
  chain,
  activeFilter,
  onFilter,
}: {
  chain: DaoChain;
  activeFilter?: string | null;
  onFilter?: (state: string) => void;
}) {
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setData(null);
    fetch(`/api/dao-analytics?chain=${chain}`)
      .then((r) => r.json())
      .then((d: AnalyticsResp) => {
        if (live && !d.error) setData(d);
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [chain]);

  if (loading) return <div className="h-40 animate-pulse rounded-2xl border border-bdr-soft bg-surface-base-faint" />;
  if (!data) return null;
  const s = data.stats;
  if (s.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
        No proposals on {chain} yet - nothing to analyze.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Proposals" value={String(s.total)} sub={`${s.decided} decided`} />
        <Tile label="Pass rate" value={`${s.passRatePct}%`} sub={`${s.passed} of ${s.decided} decided`} />
        <Tile label="Quorum hit" value={`${s.quorumHitRatePct}%`} sub={`${s.quorumReached} of ${s.quorumChecked} reached`} />
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(s.byState)
          .sort((a, b) => b[1] - a[1])
          .map(([state, count]) => {
            const active = activeFilter === state;
            return (
              <button
                key={state}
                type="button"
                onClick={() => onFilter?.(state)}
                aria-pressed={active}
                title={`Show only ${state} proposals`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  active ? "border-primary/50 bg-primary/15" : "border-bdr-soft bg-card/60 hover:border-primary/40",
                )}
              >
                <span className={cn("font-semibold tabular-nums", STATE_TONE[state] ?? "text-content-default")}>{count}</span>
                <span className="capitalize text-content-soft">{state}</span>
              </button>
            );
          })}
      </div>

      <ExecutedTimeline executed={data.executed} explorer={data.explorer} chain={chain} />
    </div>
  );
}

function ExecutedTimeline({ executed, explorer, chain }: { executed: Executed[]; explorer: string; chain: DaoChain }) {
  if (executed.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-content-soft">
        <ScrollText className="size-3.5" /> Nothing executed on {chain} yet.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-soft">
        <ScrollText className="size-3.5" /> What governance has executed
      </p>
      <div className="space-y-2">
        {executed.map((p) => (
          <div key={p.id} className="rounded-xl border border-bdr-soft bg-card/60 p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              <p className="text-xs font-medium text-content-primary">{p.title}</p>
            </div>
            {p.actions.length > 0 && (
              <div className="mt-1.5 space-y-1 pl-5.5">
                {p.actions.map((act, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", act.dangerous ? "bg-warning" : "bg-content-soft/40")} />
                    <span className="break-all text-content-default">{act.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
