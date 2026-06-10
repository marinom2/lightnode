"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { short } from "@/components/build/console/panel-kit";
import { DAO_VOTE_UI, DELEGATION_UI, loadVotingPower, type DaoChain, type VotingPowerReads } from "./dao-chain";
import { delegationStatus, formatLcaiWei } from "./dao-math";

const SYMBOL: Record<DaoChain, string> = { ethereum: "LCAIB", lightchain: "LCAI" };

/**
 * Read-only "your standing" card. lightnode surfaces voting power + delegation
 * state from the on-chain registries; the actual delegate transaction happens on
 * LightChain's official UI, so we link out rather than sign here.
 */
export function VotingPowerCard({ chain }: { chain: DaoChain }) {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [reads, setReads] = useState<VotingPowerReads | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      setReads(await loadVotingPower(chain, address));
    } catch {
      setReads(null);
    } finally {
      setLoading(false);
    }
  }, [chain, address]);

  useEffect(() => {
    setReads(null);
    if (isConnected && address) void refresh();
  }, [isConnected, address, chain, refresh]);

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={() => open()}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-bdr-soft bg-card/60 px-4 py-3.5 text-left backdrop-blur-sm transition-colors hover:border-primary/40"
      >
        <span className="flex items-center gap-2.5 text-sm text-content-soft">
          <Wallet className="size-4 text-primary" /> Connect your wallet to see your voting power
        </span>
        <span className="rounded-lg bg-gradient-primary px-2.5 py-1 text-xs font-semibold text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)]">Connect</span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-bdr-soft bg-card/60 p-4 backdrop-blur-sm">
      <PowerHeader chain={chain} reads={reads} loading={loading} />
      {reads && <DelegationRow chain={chain} reads={reads} address={address} />}
    </div>
  );
}

function PowerHeader({ chain, reads, loading }: { chain: DaoChain; reads: VotingPowerReads | null; loading: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-content-soft">Your voting power</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums text-content-primary">
          {loading && !reads ? "..." : reads ? formatLcaiWei(reads.votesWei, 2) : "0"}
          <span className="ml-1.5 text-sm font-medium text-content-soft">{SYMBOL[chain]}</span>
        </p>
      </div>
      {reads && (
        <p className="text-right text-[11px] text-content-soft">
          Balance
          <br />
          <span className="tabular-nums text-content-default">{formatLcaiWei(reads.balanceWei, 2)}</span>
        </p>
      )}
    </div>
  );
}

function DelegationRow({ chain, reads, address }: { chain: DaoChain; reads: VotingPowerReads; address: `0x${string}` }) {
  const status = delegationStatus(reads.votesWei, reads.balanceWei, reads.delegate, address);
  if (status.kind === "self") {
    const gap = formatLcaiWei(status.gapWei, 2);
    return (
      <p className="mt-3 flex items-start gap-1.5 text-xs text-success">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Self-delegated - your {SYMBOL[chain]} is active.
        {status.gapWei > 0n && <span className="text-content-soft">({gap} pending next checkpoint)</span>}
      </p>
    );
  }
  if (reads.balanceWei === 0n) {
    return (
      <p className="mt-3 text-xs text-content-soft">
        You hold no {SYMBOL[chain]} on this chain, so you have no voting power here.
      </p>
    );
  }
  const msg =
    status.kind === "undelegated"
      ? `You hold ${formatLcaiWei(reads.balanceWei, 2)} ${SYMBOL[chain]} but 0 voting power. Activate it by delegating.`
      : `Delegated to ${short(reads.delegate)} - they hold your voting power.`;
  const href = DELEGATION_UI[chain] ?? DAO_VOTE_UI;
  return (
    <div className="mt-3 space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {msg}
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)] transition-all hover:brightness-110"
      >
        Manage delegation <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
