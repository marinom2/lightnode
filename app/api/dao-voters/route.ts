/**
 * "Who actually decides": scans the governor's VoteCast events into a voter
 * participation leaderboard, and the vote-token's DelegateVotesChanged events
 * into a delegate voting-power leaderboard + a concentration metric. Registry
 * intelligence the official DAO doesn't surface.
 */
import { NextResponse } from "next/server";
import { parseAbiItem } from "viem";
import { DAO_ADDRESSES } from "lightnode-sdk";
import { findEvents, type GovernorChain } from "@/lib/dao-governor-scan";
import { aggregateVoters, latestDelegateWeights, concentrationPct, type VoteEvent, type DelegateEvent } from "@/lib/dao-votes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const VOTE_CAST = parseAbiItem(
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
);
const DELEGATE_VOTES_CHANGED = parseAbiItem(
  "event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes)",
);

const TOP_N = 15;

export async function GET(req: Request) {
  try {
    const chain = ((new URL(req.url).searchParams.get("chain") ?? "ethereum") === "lightchain" ? "lightchain" : "ethereum") as GovernorChain;
    const addresses = DAO_ADDRESSES[chain];
    // The vote token (ballots) is where DelegateVotesChanged lives; LightChain's
    // is the native predeploy, which may not emit it (delegates list degrades to empty).
    const [voteScan, delegateScan] = await Promise.all([
      findEvents(addresses.governor, chain, VOTE_CAST).catch(() => null),
      findEvents(addresses.ballots as `0x${string}`, chain, DELEGATE_VOTES_CHANGED).catch(() => null),
    ]);

    const voteEvents: VoteEvent[] = (voteScan?.events ?? []).map((log) => {
      const a = (log as unknown as { args: { voter: `0x${string}`; support: number; weight: bigint } }).args;
      return { voter: a.voter, support: Number(a.support), weightWei: a.weight };
    });
    const delegateEvents: DelegateEvent[] = (delegateScan?.events ?? []).map((log) => {
      const a = (log as unknown as { args: { delegate: `0x${string}`; newVotes: bigint } }).args;
      return { delegate: a.delegate, newVotesWei: a.newVotes };
    });

    const { rows, uniqueVoters, totalVotes } = aggregateVoters(voteEvents);
    const delegates = latestDelegateWeights(delegateEvents);

    return NextResponse.json({
      chain,
      explorer: addresses.explorer,
      totalVotes,
      uniqueVoters,
      delegateCount: delegates.length,
      top5ConcentrationPct: concentrationPct(delegates, 5),
      voters: rows.slice(0, TOP_N).map((r) => ({
        voter: r.voter,
        votes: r.votes,
        forVotes: r.forVotes,
        against: r.against,
        abstain: r.abstain,
        lastWeightWei: r.lastWeightWei.toString(),
      })),
      delegates: delegates.slice(0, TOP_N).map((d) => ({ delegate: d.delegate, weightWei: d.weightWei.toString() })),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
