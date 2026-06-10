"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";
import { GOVERNOR_ABI, VOTES_ABI } from "lightnode-sdk";
import { humanizeError } from "@/lib/humanize-error";
import { cn } from "@/lib/utils";
import {
  DAO_EXPLORER,
  GOVERNOR,
  VOTE_TOKEN,
  daoPublicClient,
  pinnedFees,
  readHasVoted,
  type DaoChain,
} from "./dao-chain";
import { useDaoWallet } from "./use-dao-wallet";

type Support = 0 | 1 | 2;
type Vote = { phase: "idle" | "working" | "submitted" | "confirmed" | "error"; support?: Support; msg?: string; tx?: `0x${string}` };

const CHOICES: { label: string; support: Support; cls: string }[] = [
  { label: "For", support: 1, cls: "text-success border-success/40 hover:bg-success/10" },
  { label: "Against", support: 0, cls: "text-destructive border-destructive/40 hover:bg-destructive/10" },
  { label: "Abstain", support: 2, cls: "text-content-default border-bdr-soft hover:bg-surface-base-faint" },
];

export function CastVote({ chain, proposalId, onVoted }: { chain: DaoChain; proposalId: string; onVoted?: () => void }) {
  const { address, isConnected, open, getSigner } = useDaoWallet(chain);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [powerWei, setPowerWei] = useState<bigint | null>(null);
  const [vote, setVote] = useState<Vote>({ phase: "idle" });

  const check = useCallback(async () => {
    if (!address) return;
    const pub = daoPublicClient(chain);
    try {
      const [hasVoted, power] = await Promise.all([
        readHasVoted(chain, BigInt(proposalId), address),
        pub.readContract({ address: VOTE_TOKEN[chain], abi: VOTES_ABI, functionName: "getVotes", args: [address] }) as Promise<bigint>,
      ]);
      setVoted(hasVoted);
      setPowerWei(power);
    } catch {
      setVoted(null);
      setPowerWei(null);
    }
  }, [chain, proposalId, address]);

  useEffect(() => {
    setVote({ phase: "idle" });
    setVoted(null);
    setPowerWei(null);
    if (isConnected && address) void check();
  }, [isConnected, address, chain, proposalId, check]);

  const castVote = async (support: Support) => {
    if (!isConnected || !address) return open();
    setVote({ phase: "working", support, msg: "Confirm in your wallet (you may be asked to switch network first)..." });
    try {
      const signer = await getSigner();
      const fees = chain === "lightchain" ? await pinnedFees(daoPublicClient(chain)) : undefined;
      const hash = await signer.writeContract({
        address: GOVERNOR[chain],
        abi: GOVERNOR_ABI,
        functionName: "castVote",
        args: [BigInt(proposalId), support],
        ...(fees ?? {}),
      });
      setVote({ phase: "submitted", support, msg: "Vote submitted - confirming...", tx: hash });
      await daoPublicClient(chain).waitForTransactionReceipt({ hash });
      setVote({ phase: "confirmed", support, msg: "Vote confirmed on-chain.", tx: hash });
      setVoted(true);
      onVoted?.();
    } catch (e) {
      setVote({ phase: "error", support, msg: humanizeError(e, { action: "casting your vote" }) });
    }
  };

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/6 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-content-soft">Cast your vote</p>
      <CastBody
        connected={isConnected && !!address}
        voted={voted}
        powerWei={powerWei}
        busy={vote.phase === "working" || vote.phase === "submitted"}
        activeSupport={vote.support}
        onConnect={() => open()}
        onVote={castVote}
      />
      {vote.phase !== "idle" && <VoteStatus chain={chain} vote={vote} />}
    </div>
  );
}

function CastBody({
  connected,
  voted,
  powerWei,
  busy,
  activeSupport,
  onConnect,
  onVote,
}: {
  connected: boolean;
  voted: boolean | null;
  powerWei: bigint | null;
  busy: boolean;
  activeSupport?: Support;
  onConnect: () => void;
  onVote: (s: Support) => void;
}) {
  if (!connected) {
    return (
      <button type="button" onClick={onConnect} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
        <Wallet className="size-3.5" /> Connect wallet to vote
      </button>
    );
  }
  if (voted) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success">
        <CheckCircle2 className="size-3.5" /> You already voted on this proposal.
      </p>
    );
  }
  const noPower = powerWei === 0n;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => onVote(c.support)}
            disabled={busy || noPower}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg border bg-surface-base-faint/40 px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40",
              c.cls,
            )}
          >
            {busy && activeSupport === c.support && <Loader2 className="size-3.5 animate-spin" />}
            {c.label}
          </button>
        ))}
      </div>
      {noPower && (
        <p className="mt-2 text-[11px] text-content-soft">
          No voting power at this proposal&apos;s snapshot. Delegate before the next proposal opens to vote.
        </p>
      )}
    </>
  );
}

function VoteStatus({ chain, vote }: { chain: DaoChain; vote: Vote }) {
  if (vote.phase === "working") return <p className="mt-2 text-[11px] text-content-soft">{vote.msg}</p>;
  if (vote.phase === "error") {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {vote.msg}
      </p>
    );
  }
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
      <span className={cn("flex items-center gap-1.5", vote.phase === "confirmed" ? "text-success" : "text-content-soft")}>
        {vote.phase === "submitted" && <Loader2 className="size-3.5 animate-spin" />}
        {vote.phase === "confirmed" && <CheckCircle2 className="size-3.5" />}
        {vote.msg}
      </span>
      {vote.tx && (
        <a href={`${DAO_EXPLORER[chain]}/tx/${vote.tx}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          tx <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
