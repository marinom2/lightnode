"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, ExternalLink, Wallet } from "lucide-react";
import { VOTES_ABI } from "lightnode-sdk";
import { humanizeError } from "@/lib/humanize-error";
import { short } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";
import {
  DAO_EXPLORER,
  VOTE_TOKEN,
  daoPublicClient,
  loadVotingPower,
  pinnedFees,
  type DaoChain,
  type VotingPowerReads,
} from "./dao-chain";
import { delegationStatus, formatLcaiWei } from "./dao-math";
import { useDaoWallet } from "./use-dao-wallet";

type Tx = { phase: "idle" | "working" | "submitted" | "confirmed" | "error"; msg?: string; tx?: `0x${string}` };

const SYMBOL: Record<DaoChain, string> = { ethereum: "LCAIB", lightchain: "LCAI" };

export function VotingPowerCard({ chain }: { chain: DaoChain }) {
  const { address, isConnected, open, getSigner } = useDaoWallet(chain);
  const [reads, setReads] = useState<VotingPowerReads | null>(null);
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState<Tx>({ phase: "idle" });

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
    setTx({ phase: "idle" });
    if (isConnected && address) void refresh();
  }, [isConnected, address, chain, refresh]);

  const delegateToSelf = async () => {
    if (!isConnected || !address) return open();
    setTx({ phase: "working", msg: "Confirm in your wallet (you may be asked to switch network first)..." });
    try {
      const signer = await getSigner();
      const fees = chain === "lightchain" ? await pinnedFees(daoPublicClient(chain)) : undefined;
      const hash = await signer.writeContract({
        address: VOTE_TOKEN[chain],
        abi: VOTES_ABI,
        functionName: "delegate",
        args: [address],
        ...(fees ?? {}),
      });
      setTx({ phase: "submitted", msg: "Delegation submitted - confirming...", tx: hash });
      await daoPublicClient(chain).waitForTransactionReceipt({ hash });
      setTx({ phase: "confirmed", msg: "Voting power activated.", tx: hash });
      await refresh();
    } catch (e) {
      setTx({ phase: "error", msg: humanizeError(e, { action: "delegating your votes" }) });
    }
  };

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
      {reads && <DelegationRow chain={chain} reads={reads} address={address} onDelegate={delegateToSelf} working={tx.phase === "working" || tx.phase === "submitted"} />}
      {tx.phase !== "idle" && tx.phase !== "working" && <TxLine chain={chain} tx={tx} />}
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

function DelegationRow({
  chain,
  reads,
  address,
  onDelegate,
  working,
}: {
  chain: DaoChain;
  reads: VotingPowerReads;
  address: `0x${string}`;
  onDelegate: () => void;
  working: boolean;
}) {
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
  // Nothing to delegate: holding zero balance on this chain. Don't push a
  // pointless "delegate to activate" prompt.
  if (reads.balanceWei === 0n) {
    return (
      <p className="mt-3 text-xs text-content-soft">
        You hold no {SYMBOL[chain]} on this chain, so you have no voting power here.
      </p>
    );
  }
  const msg =
    status.kind === "undelegated"
      ? `You hold ${formatLcaiWei(reads.balanceWei, 2)} ${SYMBOL[chain]} but 0 voting power. Delegate to yourself to activate it.`
      : `Delegated to ${short(reads.delegate)} - they hold your voting power. Reclaim it below.`;
  return (
    <div className="mt-3 space-y-2">
      <p className="flex items-start gap-1.5 text-xs text-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {msg}
      </p>
      <button
        type="button"
        onClick={onDelegate}
        disabled={working}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)] transition-all hover:brightness-110 disabled:opacity-50"
      >
        {working && <Loader2 className="size-3.5 animate-spin" />} Delegate to self
      </button>
    </div>
  );
}

function TxLine({ chain, tx }: { chain: DaoChain; tx: Tx }) {
  if (tx.phase === "error") {
    return (
      <p className="mt-2.5 flex items-start gap-1.5 text-xs text-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {tx.msg}
      </p>
    );
  }
  return (
    <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
      <span className={cn("flex items-center gap-1.5", tx.phase === "confirmed" ? "text-success" : "text-content-soft")}>
        {tx.phase === "submitted" && <Loader2 className="size-3.5 animate-spin" />}
        {tx.phase === "confirmed" && <ShieldCheck className="size-3.5" />}
        {tx.msg}
      </span>
      {tx.tx && (
        <a
          href={`${DAO_EXPLORER[chain]}/tx/${tx.tx}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          tx <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
