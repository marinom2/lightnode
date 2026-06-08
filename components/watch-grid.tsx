"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Coins, Star } from "lucide-react";
import { fromWei, fmt, compact, timeAgo, shortAddr, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { NetworkId } from "@/lib/network";
import type { Worker } from "@/lib/subgraph";
import type { WorkerActionCenter } from "lightnode-sdk";

type Loaded = { worker: Worker | null; live: boolean; actions: WorkerActionCenter | null };

/** The at-a-glance alert chips for one worker, most urgent first. Empty when the
 *  worker is healthy with nothing pending - so a clean watchlist stays quiet. */
function workerChips(a: WorkerActionCenter | null): Array<{ tone: "danger" | "warning" | "success" | "brand"; label: string }> {
  if (!a) return [];
  const chips: Array<{ tone: "danger" | "warning" | "success" | "brand"; label: string }> = [];
  if (a.outOfGas && a.actions.some((x) => x.kind === "fund-gas")) chips.push({ tone: "danger", label: "no gas" });
  const stuck = a.liveness.stuckJobs.length;
  if (stuck > 0) chips.push({ tone: "warning", label: `${stuck} stuck` });
  if (a.settlement.releasableNowCount > 0) chips.push({ tone: "brand", label: `settle ${a.settlement.releasableNowCount}` });
  if (a.claimableLcai > 0) chips.push({ tone: "success", label: `claim ${fmt(a.claimableLcai, 3)}` });
  return chips;
}

/** Compact overview of every watched worker at once. */
export function WatchGrid({
  addresses,
  network,
  active,
  onSelect,
}: {
  addresses: string[];
  network: NetworkId;
  active?: string;
  onSelect: (addr: string) => void;
}) {
  const [data, setData] = useState<Record<string, Loaded>>({});

  useEffect(() => {
    let on = true;
    const load = () => {
      addresses.forEach((addr) => {
        fetch(`/api/worker?net=${network}&address=${addr}`)
          .then((r) => r.json())
          .then((j) => {
            if (!on || !j.ok) return;
            setData((d) => ({ ...d, [addr.toLowerCase()]: { worker: j.worker, live: !!j.live, actions: j.actions ?? null } }));
          })
          .catch(() => {});
      });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [addresses, network]);

  // Show a watched worker while it's loading, or once confirmed on THIS network.
  // Hide ones that resolve to "not on this network" (e.g. a testnet worker while
  // viewing mainnet) - they reappear when you switch to their network.
  const visible = addresses.filter((a) => {
    const d = data[a.toLowerCase()];
    return !d || d.worker;
  });
  if (visible.length === 0) return null; // nothing on this network -> no empty header

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <Star className="size-4 fill-warning text-warning" />
        <h2 className="text-sm font-semibold text-content-primary">Your watchlist</h2>
        <span className="text-xs text-content-soft">live overview, click any to open</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((addr) => {
        const d = data[addr.toLowerCase()];
        const w = d?.worker;
        const isActive = active?.toLowerCase() === addr.toLowerCase();
        const chips = workerChips(d?.actions ?? null);
        const needsAttention = chips.some((c) => c.tone === "danger" || c.tone === "warning");
        // A problem (no gas / stuck) tints the dot amber regardless of last_seen;
        // else registered-but-not-live shows amber, deregistered/missing shows red.
        const dot = !w
          ? "dot-idle"
          : needsAttention
            ? "dot-warn"
            : d.live
              ? "dot-live"
              : w.status !== "deregistered"
                ? "dot-warn"
                : "dot-down";
        return (
          <button
            key={addr}
            onClick={() => onSelect(addr)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              isActive ? "border-primary/40 bg-primary/10" : "border-bdr-soft bg-card/50 hover:border-bdr-light",
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn("dot", dot)} />
              <span className="font-mono text-sm text-content-primary">{shortAddr(addr)}</span>
            </div>
            {w ? (
              <>
                <div className="mt-3 flex items-center justify-between text-xs text-content-soft">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3.5" /> {compact(w.jobs_completed ?? 0)} jobs
                  </span>
                  <span className="inline-flex items-center gap-1 text-success">
                    <Coins className="size-3.5" /> {fmt(fromWei(w.total_earned), 2)}
                  </span>
                  <span>{timeAgo(w.last_seen_at)}</span>
                </div>
                {/* Proactive alerts: surface stuck jobs / no gas / claimable across
                    EVERY watched worker, so nothing is missed without opening each. */}
                {chips.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <Badge key={c.label} tone={c.tone}>
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="mt-3 text-xs text-content-soft">{d ? "not registered" : "loading..."}</div>
            )}
          </button>
        );
      })}
      </div>
    </div>
  );
}
