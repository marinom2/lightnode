"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeDuration, quorumPercent, formatLcaiWei } from "./dao-math";
import type { DaoChain } from "./dao-chain";

interface ChainStats {
  votingPeriod: string;
  votingDelay: string;
  timelockQueue: string;
  quorum: string;
  threshold: string;
  proposals: string;
  treasury: string;
}

const CHAIN_META: Record<DaoChain, { label: string; icon: string }> = {
  ethereum: { label: "Ethereum", icon: "/logos/eth.svg" },
  lightchain: { label: "LightChain", icon: "/logos/lcai.png" },
};
const fmtPct = (p: number) => (p % 1 === 0 ? `${p}%` : `${p.toFixed(1)}%`);

// Proposal counts come from a full-history governor scan, which is expensive.
// Remember each chain's total for the session so revisits to /build/dao reuse
// it (or the total the page already scanned) instead of rescanning.
const proposalTotalCache = new Map<DaoChain, number>();

function seedProposalTotals(totals?: Partial<Record<DaoChain, number>>): void {
  if (!totals) return;
  for (const chain of ["ethereum", "lightchain"] as const) {
    const total = totals[chain];
    if (total != null) proposalTotalCache.set(chain, total);
  }
}

async function fetchProposalTotal(chain: DaoChain): Promise<number> {
  const cached = proposalTotalCache.get(chain);
  if (cached != null) return cached;
  const res = await fetch(`/api/dao-proposals?chain=${chain}&limit=1`);
  const prop = (await res.json()) as { total?: number; error?: string };
  if (!res.ok || prop.error) throw new Error(prop.error ?? "proposal scan failed");
  const total = Number(prop.total ?? 0);
  proposalTotalCache.set(chain, total);
  return total;
}

async function loadChain(chain: DaoChain): Promise<ChainStats | null> {
  try {
    const [ov, total] = await Promise.all([
      fetch(`/api/dao-overview?chain=${chain}`).then((r) => r.json()),
      fetchProposalTotal(chain),
    ]);
    if (ov.error || !ov.schedule) return null;
    const s = ov.schedule;
    const sym = chain === "ethereum" ? "LCAIB" : "LCAI";
    return {
      votingDelay: humanizeDuration(s.votingDelaySeconds),
      votingPeriod: humanizeDuration(s.votingPeriodSeconds),
      timelockQueue: humanizeDuration(s.timelockSeconds),
      quorum: fmtPct(quorumPercent(ov.quorum.numerator, ov.quorum.denominator)),
      threshold: `${formatLcaiWei(BigInt(s.proposalThresholdWei), 0)} ${sym}`,
      proposals: String(total),
      treasury: `${formatLcaiWei(BigInt(ov.treasuryWei), 2)} LCAI`,
    };
  } catch {
    return null;
  }
}

const ROWS: { key: keyof ChainStats; label: string }[] = [
  { key: "proposals", label: "Proposals created" },
  { key: "votingPeriod", label: "Voting period" },
  { key: "votingDelay", label: "Voting delay" },
  { key: "timelockQueue", label: "Timelock queue" },
  { key: "quorum", label: "Quorum" },
  { key: "threshold", label: "Propose threshold" },
  { key: "treasury", label: "Treasury balance" },
];

function ChainHead({ chain }: { chain: DaoChain }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Image src={CHAIN_META[chain].icon} alt="" width={14} height={14} className="size-3.5 rounded-full object-contain" />
      <span className="text-xs font-semibold text-content-primary">{CHAIN_META[chain].label}</span>
    </div>
  );
}

function withTotal(stats: ChainStats, total?: number): ChainStats {
  return total == null ? stats : { ...stats, proposals: String(total) };
}

interface GovernorDriftProps {
  /** Proposal totals the page has already scanned - reused instead of rescanning. */
  knownTotals?: Partial<Record<DaoChain, number>>;
  /** Hold our scans until the page's own scan settles (it feeds knownTotals). */
  ready?: boolean;
}

export function GovernorDrift({ knownTotals, ready = true }: GovernorDriftProps) {
  const [ethStats, setEthStats] = useState<ChainStats | null>(null);
  const [lcStats, setLcStats] = useState<ChainStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Seed the session cache with totals the page already paid for. Declared
  // before the load effect so the seed lands first within the same commit.
  useEffect(() => {
    seedProposalTotals(knownTotals);
  }, [knownTotals]);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    Promise.all([loadChain("ethereum"), loadChain("lightchain")])
      .then(([e, l]) => {
        if (!live) return;
        setEthStats(e);
        setLcStats(l);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [ready]);

  if (loading) return <div className="h-64 animate-pulse rounded-2xl border border-bdr-soft bg-surface-base-faint" />;
  if (!ethStats || !lcStats) return null;

  // Prefer the freshest totals the page has scanned (e.g. after a chain switch).
  const eth = withTotal(ethStats, knownTotals?.ethereum);
  const lc = withTotal(lcStats, knownTotals?.lightchain);
  const driftCount = ROWS.filter((r) => eth[r.key] !== lc[r.key]).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-bdr-soft bg-card/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-bdr-soft px-4 py-3">
        <ArrowLeftRight className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-content-primary">Governor drift</h3>
        <span className="ml-auto text-[11px] text-content-soft">{driftCount} of {ROWS.length} parameters differ</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-0 px-4 py-2 sm:gap-x-8">
        <span />
        <ChainHead chain="ethereum" />
        <ChainHead chain="lightchain" />
        {ROWS.map((r) => {
          const differs = eth[r.key] !== lc[r.key];
          return (
            <Row key={r.key} label={r.label} eth={eth[r.key]} lc={lc[r.key]} differs={differs} />
          );
        })}
      </div>

      <DriftFooter eth={eth} lc={lc} />
    </div>
  );
}

function DriftFooter({ eth, lc }: { eth: ChainStats; lc: ChainStats }) {
  return (
    <p className="border-t border-bdr-soft px-4 py-3 text-[11px] leading-relaxed text-content-soft">
      Governance is live on <span className="text-content-default">Ethereum</span> ({eth.proposals} proposals, {eth.votingPeriod} voting). The
      LightChain native DAO is deployed but still on its initial {lc.votingPeriod}/{lc.quorum} settings - the
      migration onto LightChain is in progress, which is why the two governors drift.
    </p>
  );
}

function Row({ label, eth, lc, differs }: { label: string; eth: string; lc: string; differs: boolean }) {
  return (
    <>
      <div className={cn("border-t border-bdr-soft/60 py-2 text-xs", differs ? "text-content-primary" : "text-content-soft")}>
        {label}
        {differs && <span className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-warning">differs</span>}
      </div>
      <div className={cn("border-t border-bdr-soft/60 py-2 text-right text-xs tabular-nums", differs ? "font-semibold text-content-primary" : "text-content-default")}>{eth}</div>
      <div className={cn("border-t border-bdr-soft/60 py-2 text-right text-xs tabular-nums", differs ? "font-semibold text-content-primary" : "text-content-default")}>{lc}</div>
    </>
  );
}
