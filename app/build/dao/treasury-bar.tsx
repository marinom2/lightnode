"use client";

import { useEffect, useState } from "react";
import { Landmark, Coins, Target, ExternalLink } from "lucide-react";
import { formatLcaiWei, quorumPercent, humanizeDuration } from "./dao-math";
import type { DaoChain } from "./dao-chain";

interface Schedule {
  votingDelaySeconds: number;
  votingPeriodSeconds: number;
  timelockSeconds: number;
  proposalThresholdWei: string;
}
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
  // LightChain only: the actual on-chain quorum threshold + the staked-excluded
  // base it applies to (worker + validator stake are not in the votable supply).
  quorumWei?: string | null;
  votableSupplyWei?: string | null;
  stakeExcludedFromQuorum?: boolean;
  schedule?: Schedule;
  error?: string;
}

const VOTE_SYMBOL: Record<DaoChain, string> = { ethereum: "LCAIB", lightchain: "LCAI" };

function ScheduleLine({ chain, schedule }: { chain: DaoChain; schedule: Schedule }) {
  const vote = humanizeDuration(schedule.votingPeriodSeconds);
  const delay = humanizeDuration(schedule.votingDelaySeconds);
  const queue = humanizeDuration(schedule.timelockSeconds);
  const threshold = formatLcaiWei(BigInt(schedule.proposalThresholdWei), 0);
  return (
    <p className="px-1 text-[11px] leading-relaxed text-content-soft">
      <span className="font-medium text-content-default">Lifecycle:</span> {delay} delay → <span className="text-content-default">{vote} voting</span> → {queue} timelock queue before execution.
      {schedule.proposalThresholdWei !== "0" && (
        <> Proposing needs {threshold} {VOTE_SYMBOL[chain]}.</>
      )}
    </p>
  );
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

  const pctLabel = qPct ? `${qPct % 1 === 0 ? qPct : qPct.toFixed(1)}%` : "3%";
  // LightChain reports the REAL quorum (quorumWei): 3% of the staked-excluded
  // votable supply, not "% of supply". Worker + validator stake are not in the
  // votable base. Fall back to the "% of supply" label only where no real quorum
  // amount is available (e.g. Ethereum's ERC20Votes reads).
  const quorumValue = data.quorumWei
    ? `${formatLcaiWei(BigInt(data.quorumWei), 0)} ${VOTE_SYMBOL[chain]}`
    : qPct
      ? `${pctLabel} of supply`
      : "n/a";
  const quorumHint = data.quorumWei
    ? `${pctLabel} of the votable supply${data.stakeExcludedFromQuorum ? " (staked LCAI excluded)" : ""}${data.votableSupplyWei ? ` = ${formatLcaiWei(BigInt(data.votableSupplyWei), 0)} ${VOTE_SYMBOL[chain]} base` : ""} - needs this much For+Abstain to pass`
    : data.voteToken.totalSupplyWei
      ? `${quorumValue} - needs ${formatLcaiWei((BigInt(data.voteToken.totalSupplyWei) * BigInt(data.quorum.numerator)) / BigInt(data.quorum.denominator || "1"), 0)} ${VOTE_SYMBOL[chain]} of For+Abstain to be valid`
      : `${quorumValue} of the native vote supply`;
  return (
    <div className="space-y-3 rounded-2xl border border-bdr-soft bg-card/60 px-4 py-3.5 backdrop-blur-sm">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat icon={<Landmark className="size-4" />} label="Treasury" value={`${formatLcaiWei(BigInt(data.treasuryWei), 2)} LCAI`} href={`${data.explorer}/address/${data.treasury}`} />
        {data.feePoolWei != null && data.feePool ? (
          <Stat icon={<Coins className="size-4" />} label="Fee pool" value={`${formatLcaiWei(BigInt(data.feePoolWei), 2)} LCAI`} href={`${data.explorer}/address/${data.feePool}`} />
        ) : (
          <Stat icon={<Coins className="size-4" />} label="Vote supply" value={supply} />
        )}
        <div title={quorumHint}>
          <Stat icon={<Target className="size-4" />} label="Quorum" value={quorumValue} />
        </div>
        <Stat icon={<Landmark className="size-4" />} label="Governor" value={shortAddr(data.governor)} href={`${data.explorer}/address/${data.governor}`} />
      </div>
      {data.schedule && <ScheduleLine chain={chain} schedule={data.schedule} />}
    </div>
  );
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}
