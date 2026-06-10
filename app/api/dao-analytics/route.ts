/**
 * Governance analytics: scans EVERY proposal for a governor and returns outcome
 * stats (pass rate, quorum-hit rate, state breakdown) plus the timeline of what
 * the DAO has actually executed, decoded into plain English. This is the
 * registry intelligence the official tools don't surface; lightnode reads it.
 */
import { NextResponse } from "next/server";
import type { createPublicClient } from "viem";
import { DAO_ADDRESSES, PROPOSAL_STATE_LABEL, GOVERNOR_ABI, decodeGovernanceAction, type ProposalState } from "lightnode-sdk";
import { findGovernorEvents, mapBatched, type GovernorChain } from "@/lib/dao-governor-scan";
import { computeOutcomeStats, type ProposalOutcome } from "@/lib/dao-analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Pub = ReturnType<typeof createPublicClient>;

interface EventArgs {
  proposalId: bigint;
  description: string;
  targets?: `0x${string}`[];
  values?: bigint[];
  calldatas?: `0x${string}`[];
}

function deriveTitle(description: string): string {
  const first = description.split(/\r?\n/)[0]?.trim() ?? "";
  const cleaned = first.replace(/^#+\s*/, "").replace(/^Proposal[:\-]?\s*/i, "").replace(/\.$/, "");
  return cleaned.length ? cleaned.slice(0, 100) : "Untitled proposal";
}

// Read state + votes + quorum for one proposal. Each read defaults safely so a
// throttled RPC degrades the stats rather than failing the whole scan.
async function readOutcome(pub: Pub, governor: `0x${string}`, id: bigint): Promise<ProposalOutcome> {
  const [stateRaw, votes, snapshot] = (await Promise.all([
    pub.readContract({ address: governor, abi: GOVERNOR_ABI, functionName: "state", args: [id] }).catch(() => -1),
    pub.readContract({ address: governor, abi: GOVERNOR_ABI, functionName: "proposalVotes", args: [id] }).catch(() => [0n, 0n, 0n]),
    pub.readContract({ address: governor, abi: GOVERNOR_ABI, functionName: "proposalSnapshot", args: [id] }).catch(() => 0n),
  ])) as [number, [bigint, bigint, bigint], bigint];
  const quorumWei =
    snapshot > 0n
      ? ((await pub.readContract({ address: governor, abi: GOVERNOR_ABI, functionName: "quorum", args: [snapshot] }).catch(() => 0n)) as bigint)
      : 0n;
  return {
    stateLabel: PROPOSAL_STATE_LABEL[stateRaw as ProposalState] ?? "unknown",
    votesForWei: votes[1],
    votesAbstainWei: votes[2],
    quorumWei,
  };
}

export async function GET(req: Request) {
  try {
    const chain = ((new URL(req.url).searchParams.get("chain") ?? "ethereum") === "lightchain" ? "lightchain" : "ethereum") as GovernorChain;
    const addresses = DAO_ADDRESSES[chain];
    const { pub, events } = await findGovernorEvents(addresses.governor, chain);
    const ordered = events.slice().reverse(); // newest first

    const argsList = ordered.map((log) => (log as unknown as { args: EventArgs }).args);
    const outcomes = await mapBatched(argsList, 6, (a) => readOutcome(pub, addresses.governor, a.proposalId));
    const stats = computeOutcomeStats(outcomes);

    // Executed timeline: what governance actually enacted, decoded to English.
    const executed = argsList
      .map((a, i) => ({ a, state: outcomes[i].stateLabel }))
      .filter((x) => x.state === "executed")
      .slice(0, 12)
      .map(({ a }) => ({
        id: a.proposalId.toString(),
        title: deriveTitle(a.description),
        actions: (a.targets ?? []).map((target, i) =>
          decodeGovernanceAction({ target, value: a.values?.[i] ?? 0n, calldata: a.calldatas?.[i] ?? "0x" }),
        ),
      }));

    return NextResponse.json({ chain, governor: addresses.governor, explorer: addresses.explorer, stats, executed, fetchedAt: Date.now() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
