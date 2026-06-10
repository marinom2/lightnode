"use client";

import { useEffect, useState } from "react";
import { Landmark, Coins, Target, ExternalLink } from "lucide-react";
import { formatLcaiWei, quorumPercent } from "./dao-math";
import type { DaoChain } from "./dao-chain";

interface Overview {
  chain: DaoChain;
  governor: string;
  treasury: string;
  feePool: string | null;
  explorer: string;
  treasuryWei: string;
  feePoolWei: string | null;
  voteToken: { address: string; symbol: string; totalSupplyWei: string | null };
  quorum: { numerator: string; denominator: string };
  error?: string;
}

function Stat({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const body = (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-soft">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums text-content-primary">{value}</p>
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group rounded-lg transition-colors hover:bg-surface-base-faint/40">
      <span className="flex items-center gap-1">
        {body}
        <ExternalLink className="size-3 shrink-0 text-content-soft opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </a>
  );
}

export function TreasuryBar({ chain }: { chain: DaoChain }) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/dao-overview?chain=${chain}`)
      .then((r) => r.json())
      .then((d: Overview) => {
        if (live && !d.error) setData(d);
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [chain]);

  if (loading && !data) return <div className="h-[68px] animate-pulse rounded-2xl border border-bdr-soft bg-surface-base-faint" />;
  if (!data) return null;

  const sym = data.voteToken.symbol;
  const qPct = quorumPercent(data.quorum.numerator, data.quorum.denominator);
  const supply = data.voteToken.totalSupplyWei ? `${formatLcaiWei(BigInt(data.voteToken.totalSupplyWei), 0)} ${sym}` : "native stake";

  return (
    <div className="grid grid-cols-2 gap-4 rounded-2xl border border-bdr-soft bg-card/60 px-4 py-3.5 backdrop-blur-sm sm:grid-cols-4">
      <Stat icon={<Landmark className="size-4" />} label="Treasury" value={`${formatLcaiWei(BigInt(data.treasuryWei), 2)} LCAI`} href={`${data.explorer}/address/${data.treasury}`} />
      {data.feePoolWei != null && data.feePool ? (
        <Stat icon={<Coins className="size-4" />} label="Fee pool" value={`${formatLcaiWei(BigInt(data.feePoolWei), 2)} LCAI`} href={`${data.explorer}/address/${data.feePool}`} />
      ) : (
        <Stat icon={<Coins className="size-4" />} label="Vote supply" value={supply} />
      )}
      <Stat icon={<Target className="size-4" />} label="Quorum" value={qPct ? `${qPct % 1 === 0 ? qPct : qPct.toFixed(1)}% of supply` : "n/a"} />
      <Stat icon={<Landmark className="size-4" />} label="Governor" value={shortAddr(data.governor)} href={`${data.explorer}/address/${data.governor}`} />
    </div>
  );
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}
