import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { quorumStatus, formatLcaiWei } from "./dao-math";
import type { DaoChain } from "./dao-chain";

const SYMBOL: Record<DaoChain, string> = { ethereum: "LCAIB", lightchain: "LCAI" };

function toBig(s?: string): bigint {
  try {
    return BigInt(s ?? "0");
  } catch {
    return 0n;
  }
}

/** Per-proposal quorum distance: For + Abstain vs quorum(snapshot). */
export function QuorumLine({
  chain,
  votesFor,
  votesAbstain,
  quorumWei,
}: {
  chain: DaoChain;
  votesFor: string;
  votesAbstain: string;
  quorumWei?: string;
}) {
  const status = quorumStatus(toBig(votesFor), toBig(votesAbstain), toBig(quorumWei));
  if (!status.known) {
    return <p className="text-[11px] text-content-soft">Quorum requirement unknown for this snapshot.</p>;
  }
  const sym = SYMBOL[chain];
  const progress = formatLcaiWei(status.progressWei, 0);
  const quorum = formatLcaiWei(status.quorumWei, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-base-light">
        <div className={cn("transition-all", status.met ? "bg-success" : "bg-primary")} style={{ width: `${status.pct}%` }} />
      </div>
      {status.met ? (
        <p className="flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="size-3.5" /> Quorum met ({progress} of {quorum} {sym}).
        </p>
      ) : (
        <p className="text-[11px] text-warning">
          Needs {formatLcaiWei(status.distanceWei, 0)} more {sym} to reach quorum ({progress} / {quorum}).
        </p>
      )}
    </div>
  );
}
