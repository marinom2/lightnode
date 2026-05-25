"use client";

import { CheckCircle2, Coins, ShieldCheck, Activity, Cpu } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS, DEFAULT_MODEL } from "@/lib/network";
import { workerSharePerJob } from "@/lib/hardware";
import { compact, fmt } from "@/lib/utils";
import type { NetworkId } from "@/lib/network";

/** Representative (illustrative) worker numbers, per network. Stake + per-job
 * rate are derived from the live network config, not hardcoded here. */
interface PreviewData {
  worker: string;
  jobsCompleted: number;
  earned: number;
  lastSeen: string;
  feed: { id: string; t: string }[];
}

const DEMO: Record<NetworkId, PreviewData> = {
  mainnet: {
    worker: "0x1F89...5EB5",
    jobsCompleted: 1284,
    earned: 20.54,
    lastSeen: "8s ago",
    feed: [
      { id: "#617", t: "8s" },
      { id: "#613", t: "1m" },
      { id: "#608", t: "2m" },
    ],
  },
  testnet: {
    worker: "0x7A3C...9D21",
    jobsCompleted: 348,
    earned: 5.57,
    lastSeen: "12s ago",
    feed: [
      { id: "#2041", t: "12s" },
      { id: "#2037", t: "1m" },
      { id: "#2033", t: "3m" },
    ],
  },
};

/**
 * Stylized product preview for the hero - a faux app window showing the worker
 * dashboard. Illustrative data, but switches with the active network so it stays
 * consistent with the rest of the site's mainnet/testnet toggle.
 */
export function HeroPreview() {
  const { network } = useNetwork();
  const net = NETWORKS[network];
  const data = DEMO[network];

  const tiles = [
    { icon: CheckCircle2, label: "Jobs completed", value: fmt(data.jobsCompleted, 0), tone: "text-content-primary" },
    { icon: Coins, label: "LCAI earned", value: fmt(data.earned), tone: "text-success" },
    { icon: ShieldCheck, label: "Stake", value: compact(net.minStakeLcai), tone: "text-content-primary" },
    { icon: Activity, label: "Last seen", value: data.lastSeen, tone: "text-success" },
  ];
  return (
    <div className="relative mx-auto mt-14 max-w-3xl">
      <div className="absolute -inset-x-10 -top-10 h-40 glow-radial" />
      <div className="relative overflow-hidden rounded-2xl border border-bdr-soft bg-card/70 shadow-[0_24px_80px_-20px_rgba(112,100,233,0.35)] backdrop-blur-sm">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-bdr-soft px-4 py-3">
          <span className="size-3 rounded-full bg-destructive/70" />
          <span className="size-3 rounded-full bg-warning/70" />
          <span className="size-3 rounded-full bg-success/70" />
          <div className="ml-3 flex items-center gap-2 rounded-md bg-surface-base-faint px-2.5 py-1 text-xs text-content-soft">
            <Cpu className="size-3" /> lightnode · {net.label.toLowerCase()}
          </div>
        </div>

        <div className="p-5">
          {/* worker header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bdr-soft bg-surface-base-subtle p-4">
            <div className="flex items-center gap-2.5">
              <span className="dot dot-live" />
              <span className="font-mono text-sm text-content-primary">{data.worker}</span>
              <span className="rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                Live
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                {DEFAULT_MODEL}
              </span>
            </div>
            <span className="text-xs text-content-soft">earning · {workerSharePerJob} LCAI / job</span>
          </div>

          {/* stat tiles */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-bdr-soft bg-card/60 p-3.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-content-soft">
                  <t.icon className="size-3.5" />
                  <span className="text-[11px] font-medium">{t.label}</span>
                </div>
                <div className={`text-xl font-semibold tracking-tight ${t.tone}`}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* faux jobs feed */}
          <div className="mt-3 space-y-1.5">
            {data.feed.map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-lg bg-surface-base-faint px-3 py-2 text-xs">
                <span className="font-mono text-content-soft">job {j.id}</span>
                <span className="inline-flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-3.5" /> completed
                </span>
                <span className="text-content-soft">{j.t} ago</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
