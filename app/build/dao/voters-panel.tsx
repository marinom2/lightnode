"use client";

import { useEffect, useState } from "react";
import { Users, Crown, ExternalLink, RefreshCw } from "lucide-react";
import { short } from "@/components/build/console/panel-kit";
import { formatLcaiWei } from "./dao-math";
import type { DaoChain } from "./dao-chain";

interface VoterRow {
  voter: string;
  votes: number;
  forVotes: number;
  against: number;
  abstain: number;
  lastWeightWei: string;
}
interface DelegateRow {
  delegate: string;
  weightWei: string;
}
interface VotersResp {
  explorer: string;
  totalVotes: number;
  uniqueVoters: number;
  delegateCount: number;
  top5ConcentrationPct: number;
  voters: VoterRow[];
  delegates: DelegateRow[];
  error?: string;
}

const SYMBOL: Record<DaoChain, string> = { ethereum: "LCAIB", lightchain: "LCAI" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bdr-soft bg-surface-base-faint/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-content-soft">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-content-primary">{value}</p>
    </div>
  );
}

export function VotersPanel({ chain }: { chain: DaoChain }) {
  // Tri-state: undefined = loading, null = fetch failed, otherwise loaded
  // (possibly genuinely empty) - a failed read must not look like "no votes".
  const [data, setData] = useState<VotersResp | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setData(undefined);
    fetch(`/api/dao-voters?chain=${chain}`)
      .then((r) => r.json())
      .then((d: VotersResp) => {
        if (live) setData(d.error ? null : d);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [chain, attempt]);

  if (data === undefined) return <div className="h-56 animate-pulse rounded-2xl border border-bdr-soft bg-surface-base-faint" />;
  if (data === null) return <VotesLoadError chain={chain} onRetry={() => setAttempt((n) => n + 1)} />;
  if (data.totalVotes === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
        No votes recorded on {chain} yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Votes cast" value={data.totalVotes.toLocaleString()} />
        <Stat label="Unique voters" value={data.uniqueVoters.toLocaleString()} />
        <Stat label="Delegates" value={data.delegateCount.toLocaleString()} />
        <Stat label="Top-5 power" value={`${data.top5ConcentrationPct}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DelegateBoard rows={data.delegates} explorer={data.explorer} chain={chain} />
        <VoterBoard rows={data.voters} explorer={data.explorer} chain={chain} />
      </div>
    </div>
  );
}

function VotesLoadError({ chain, onRetry }: { chain: DaoChain; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
      <p>Could not load votes for {chain}.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:underline"
      >
        <RefreshCw className="size-3.5" /> Retry
      </button>
    </div>
  );
}

function DelegateBoard({ rows, explorer, chain }: { rows: DelegateRow[]; explorer: string; chain: DaoChain }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-bdr-soft bg-card/60 p-4 text-xs text-content-soft">
        No delegate weight events on this chain (native voting reports power without a delegation log).
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-bdr-soft bg-card/60 p-4 backdrop-blur-sm">
      <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-soft">
        <Crown className="size-3.5 text-primary" /> Top delegates by voting power
      </p>
      <div className="space-y-1.5">
        {rows.map((d, i) => (
          <a
            key={d.delegate}
            href={`${explorer}/address/${d.delegate}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-surface-base-faint/50"
          >
            <span className="w-4 shrink-0 text-right tabular-nums text-content-soft">{i + 1}</span>
            <span className="font-mono text-content-primary">{short(d.delegate)}</span>
            <span className="ml-auto tabular-nums text-content-default">{formatLcaiWei(BigInt(d.weightWei), 0)}</span>
            <span className="text-[10px] text-content-soft">{SYMBOL[chain]}</span>
            <ExternalLink className="size-3 shrink-0 text-content-soft" />
          </a>
        ))}
      </div>
    </div>
  );
}

function VoterBoard({ rows, explorer, chain }: { rows: VoterRow[]; explorer: string; chain: DaoChain }) {
  return (
    <div className="rounded-2xl border border-bdr-soft bg-card/60 p-4 backdrop-blur-sm">
      <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-content-soft">
        <Users className="size-3.5 text-primary" /> Most active voters
      </p>
      <div className="space-y-1.5">
        {rows.map((v, i) => (
          <a
            key={v.voter}
            href={`${explorer}/address/${v.voter}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-surface-base-faint/50"
          >
            <span className="w-4 shrink-0 text-right tabular-nums text-content-soft">{i + 1}</span>
            <span className="font-mono text-content-primary">{short(v.voter)}</span>
            <span className="ml-auto tabular-nums text-content-default">{v.votes} votes</span>
            <span className="hidden text-[10px] text-content-soft sm:inline">
              <span className="text-success">{v.forVotes}F</span> / <span className="text-destructive">{v.against}A</span> / {v.abstain}Ab
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
