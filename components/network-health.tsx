"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { fmt } from "@/lib/utils";

interface Stats {
  live: number;
  active: number;
  jobsCompleted: number;
}

/** A confidence signal before staking: is the network actually live and earning? */
export function NetworkHealth() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<Stats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");

  useEffect(() => {
    let on = true;
    setState("loading");
    fetch(`/api/network?net=${network}`)
      .then((r) => r.json())
      .then((j) => {
        if (!on) return;
        if (j.ok) {
          setStats(j.stats);
          setState("ok");
        } else setState("err");
      })
      .catch(() => on && setState("err"));
    return () => {
      on = false;
    };
  }, [network]);

  if (state === "loading")
    return (
      <div className="flex items-center gap-2 rounded-xl border border-bdr-soft bg-surface-base-subtle px-4 py-3 text-sm text-content-soft">
        <Loader2 className="size-4 animate-spin" /> Checking network health...
      </div>
    );

  if (state === "err" || !stats)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-content-default">
        <AlertTriangle className="size-4 text-warning" /> Couldn&apos;t reach the network feed right now.
      </div>
    );

  const healthy = stats.active > 0;
  const tone = healthy ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10";
  const dot = healthy ? "bg-success animate-pulse-dot" : "bg-warning";

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border ${tone} px-4 py-3 text-sm`}>
      <span className="inline-flex items-center gap-2 font-medium text-content-primary">
        <span className={`size-2 rounded-full ${dot}`} />
        {healthy ? "Network is live" : "Network is quiet right now"}
      </span>
      <span className="inline-flex items-center gap-3 text-content-soft">
        <Activity className="size-3.5" />
        <span>
          <span className="font-semibold tabular-nums text-content-primary">{fmt(stats.active, 0)}</span> online
        </span>
        <span aria-hidden className="h-3 w-px bg-bdr-soft" />
        <span>
          <span className="font-semibold tabular-nums text-content-primary">{fmt(stats.jobsCompleted, 0)}</span> jobs done
        </span>
        {stats.live > 0 && (
          <>
            <span aria-hidden className="h-3 w-px bg-bdr-soft" />
            <span>
              <span className="font-semibold tabular-nums text-content-primary">{fmt(stats.live, 0)}</span> serving
            </span>
          </>
        )}
      </span>
    </div>
  );
}
