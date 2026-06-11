/**
 * Server-side reader for LCAIGovernor proposals on Ethereum mainnet.
 *
 * Returns a list of recent proposals + their state, vote tallies, and key
 * timestamps. Used by the interactive DAO card on /build so visitors see
 * real on-chain governance data without connecting a wallet.
 *
 * Strategy: pull `ProposalCreated` events from the Governor via getLogs,
 * then for each id do a multi-read (state, votes, deadline). Page size 12
 * by default to keep RPC pressure low.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { DAO_ADDRESSES, PROPOSAL_STATE_LABEL, GOVERNOR_ABI, decodeGovernanceAction, type ProposalState } from "lightnode-sdk";
import { findGovernorEvents, mapBatched, RPCS_BY_CHAIN } from "@/lib/dao-governor-scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The full-history scan fans out ~20 parallel getLogs; give it room beyond the
// default serverless budget.
export const maxDuration = 30;

function shortenDescription(s: string, max = 240): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

function deriveTitle(description: string): string {
  const first = description.split(/\r?\n/)[0]?.trim() ?? "";
  // OZ-style descriptions often begin with "# Title" or just "Title:". Strip
  // the markdown / leading "Proposal" prefix so the card surface stays clean.
  const cleaned = first
    .replace(/^#+\s*/, "")
    .replace(/^Proposal[:\-]?\s*/i, "")
    .replace(/\.$/, "");
  return cleaned.length ? cleaned.slice(0, 120) : "Untitled proposal";
}

// Read a proposal's current state as its lowercase label (for the ?state= filter).
async function readStateLabel(
  pub: ReturnType<typeof createPublicClient>,
  governor: `0x${string}`,
  id: bigint,
): Promise<string> {
  const raw = (await pub
    .readContract({ address: governor, abi: GOVERNOR_ABI, functionName: "state", args: [id] })
    .catch(() => -1)) as number;
  return (PROPOSAL_STATE_LABEL[raw as ProposalState] ?? "unknown").toLowerCase();
}

// Read the quorum requirement (in vote-token wei) at a proposal's snapshot block.
// quorum(timepoint) reverts for timepoint 0, so guard on a real snapshot and
// fall back to 0n ("quorum unknown") on any failure rather than throwing.
async function readQuorum(
  pub: ReturnType<typeof createPublicClient>,
  governor: `0x${string}`,
  snapshot: bigint,
): Promise<bigint> {
  if (snapshot <= 0n) return 0n;
  try {
    const q = await pub.readContract({
      address: governor,
      abi: GOVERNOR_ABI,
      functionName: "quorum",
      args: [snapshot],
    });
    return q as bigint;
  } catch {
    return 0n;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chainParam = (url.searchParams.get("chain") ?? "ethereum") as "ethereum" | "lightchain";
    const chain = chainParam === "lightchain" ? "lightchain" : "ethereum";
    // `limit` paginates the per-call slice. Default 12 keeps initial page
    // load cheap; max 100 protects free RPCs from getting hammered when a
    // visitor clicks 'See more' a few times.
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "12")));
    // Optional state filter (e.g. ?state=executed). When set we read state for
    // EVERY proposal (cheap single read each) and keep only matches, so the
    // filter spans all proposals, not just the loaded page.
    const stateParam = url.searchParams.get("state");
    const stateFilter = stateParam ? stateParam.toLowerCase() : null;
    const addresses = DAO_ADDRESSES[chain];
    const abi = GOVERNOR_ABI;
    // `head` comes back from the scan so the client can turn each proposal's
    // deadline block into a human "voting ends in ~X" countdown.
    const { pub, events, head: headBlock } = await findGovernorEvents(addresses.governor, chain);

    let ordered = events.slice().reverse(); // newest first
    if (stateFilter) {
      const labels = await mapBatched(ordered, 8, (log) =>
        readStateLabel(pub, addresses.governor, (log as unknown as { args: { proposalId: bigint } }).args.proposalId),
      );
      ordered = ordered.filter((_, i) => labels[i] === stateFilter);
    }
    const total = ordered.length;
    const recent = ordered.slice(0, limit);
    const proposals = await Promise.all(
      recent.map(async (log) => {
        const args = (log as unknown as {
          args: {
            proposalId: bigint;
            description: string;
            proposer: `0x${string}`;
            voteStart: bigint;
            voteEnd: bigint;
            targets?: `0x${string}`[];
            values?: bigint[];
            calldatas?: `0x${string}`[];
          };
        }).args;
        const id = args.proposalId;
        // Decode the executing calldata into plain-English, danger-flagged actions.
        const targets = args.targets ?? [];
        const actions = targets.map((target, i) =>
          decodeGovernanceAction({ target, value: args.values?.[i] ?? 0n, calldata: args.calldatas?.[i] ?? "0x" }),
        );
        const [stateRaw, votes, deadline, snapshot] = (await Promise.all([
          pub.readContract({ address: addresses.governor, abi, functionName: "state", args: [id] }).catch(() => -1),
          pub.readContract({ address: addresses.governor, abi, functionName: "proposalVotes", args: [id] }).catch(() => [0n, 0n, 0n]),
          pub.readContract({ address: addresses.governor, abi, functionName: "proposalDeadline", args: [id] }).catch(() => 0n),
          pub.readContract({ address: addresses.governor, abi, functionName: "proposalSnapshot", args: [id] }).catch(() => 0n),
        ])) as [number, [bigint, bigint, bigint], bigint, bigint];
        // Quorum is a fraction of the vote-token supply at the snapshot block, so
        // it must be read with that timepoint. snapshot===0 means the read failed;
        // report 0 (UI shows "quorum unknown") rather than calling quorum(0).
        const quorumWei = await readQuorum(pub, addresses.governor, snapshot);
        const state = stateRaw as ProposalState;
        return {
          id: id.toString(),
          title: deriveTitle(args.description),
          descriptionPreview: shortenDescription(args.description),
          // Full text for the expand/detail view (capped so a huge markdown body
          // can't bloat the list response).
          description: args.description.slice(0, 6000),
          proposer: args.proposer,
          state,
          stateLabel: PROPOSAL_STATE_LABEL[state] ?? "unknown",
          voteStart: args.voteStart.toString(),
          voteEnd: args.voteEnd.toString(),
          deadlineBlock: deadline.toString(),
          votesFor: votes[1].toString(),
          votesAgainst: votes[0].toString(),
          votesAbstain: votes[2].toString(),
          snapshotBlock: snapshot.toString(),
          quorumWei: quorumWei.toString(),
          actions,
        };
      }),
    );
    return NextResponse.json({
      chain,
      addresses,
      proposals,
      total,
      headBlock: headBlock.toString(),
      hasMore: total > proposals.length,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    // Log the real error server-side; raw messages can embed RPC endpoints.
    console.error("dao-proposals GET:", e);
    return NextResponse.json({ error: "upstream unavailable" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Drill-down: details for a single proposal id.
  let body: { id?: string; chain?: "ethereum" | "lightchain" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const chain: "ethereum" | "lightchain" = body.chain === "lightchain" ? "lightchain" : "ethereum";
    const addresses = DAO_ADDRESSES[chain];
    // Same RPC-chain pattern: try each one until one answers.
    let pub: ReturnType<typeof createPublicClient> | null = null;
    for (const rpc of RPCS_BY_CHAIN[chain]) {
      try {
        const client = createPublicClient({ transport: http(rpc) });
        await client.getBlockNumber();
        pub = client;
        break;
      } catch {
        continue;
      }
    }
    if (!pub) throw new Error(`no ${chain} RPC reachable`);
    const abi = GOVERNOR_ABI;
    const id = BigInt(body.id);
    const [stateRaw, votes, snapshot, deadline, proposer] = (await Promise.all([
      pub.readContract({ address: addresses.governor, abi, functionName: "state", args: [id] }).catch(() => -1),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalVotes", args: [id] }).catch(() => [0n, 0n, 0n]),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalSnapshot", args: [id] }).catch(() => 0n),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalDeadline", args: [id] }).catch(() => 0n),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalProposer", args: [id] }).catch(() => null),
    ])) as [number, [bigint, bigint, bigint], bigint, bigint, `0x${string}` | null];
    const quorumWei = await readQuorum(pub, addresses.governor, snapshot);
    const state = stateRaw as ProposalState;
    return NextResponse.json({
      id: id.toString(),
      state,
      stateLabel: PROPOSAL_STATE_LABEL[state] ?? "unknown",
      proposer,
      snapshot: snapshot.toString(),
      deadline: deadline.toString(),
      votesFor: votes[1].toString(),
      votesAgainst: votes[0].toString(),
      votesAbstain: votes[2].toString(),
      quorumWei: quorumWei.toString(),
    });
  } catch (e) {
    // Log the real error server-side; raw messages can embed RPC endpoints.
    console.error("dao-proposals POST:", e);
    return NextResponse.json({ error: "upstream unavailable" }, { status: 500 });
  }
}
