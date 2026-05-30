/**
 * Server-side reader for LCAIGovernor proposals on Ethereum mainnet.
 *
 * Returns a list of recent proposals + their state, vote tallies, and key
 * timestamps. Used by the interactive DAO card on /build so visitors see
 * real on-chain governance data without connecting a wallet.
 *
 * Strategy: pull `ProposalCreated` events from the Governor via getLogs,
 * then for each id do a multi-read (state, votes, deadline). Page size 5
 * by default to keep RPC pressure low.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbiItem } from "viem";
import { DAO_ADDRESSES, PROPOSAL_STATE_LABEL, GOVERNOR_ABI, type ProposalState } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Chain of public RPCs per network. We hit them in order until one returns
// something usable for getLogs. Free public endpoints get rate-limited or
// time out on large block ranges, so the first one to answer wins.
const RPCS_BY_CHAIN: Record<"ethereum" | "lightchain", string[]> = {
  ethereum: process.env.LIGHTNODE_ETH_RPC
    ? [process.env.LIGHTNODE_ETH_RPC]
    : [
        "https://ethereum-rpc.publicnode.com",
        "https://eth.merkle.io",
        "https://rpc.ankr.com/eth",
        "https://eth.drpc.org",
      ],
  lightchain: ["https://rpc.mainnet.lightchain.ai"],
};

const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);

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

async function findEventsAcrossRpcs(
  addresses: { governor: `0x${string}` },
  chain: "ethereum" | "lightchain",
) {
  const errors: string[] = [];
  // Public RPCs (notably publicnode) cap getLogs at 50k blocks per call. We
  // scan the last ~6 weeks (~300k blocks on Ethereum, much more on LightChain
  // where blocks are faster but the governor is younger so we can just scan
  // from genesis). Parallel keeps it under Vercel's 10s serverless cap.
  const WINDOW_BLOCKS = chain === "ethereum" ? 300_000n : 1_500_000n;
  const CHUNK = 50_000n;
  for (const rpc of RPCS_BY_CHAIN[chain]) {
    try {
      const pub = createPublicClient({ transport: http(rpc) });
      const head = await pub.getBlockNumber();
      const fromBlock = head > WINDOW_BLOCKS ? head - WINDOW_BLOCKS : 0n;
      const windows: Array<{ from: bigint; to: bigint }> = [];
      for (let start = fromBlock; start <= head; start += CHUNK) {
        const end = start + CHUNK - 1n > head ? head : start + CHUNK - 1n;
        windows.push({ from: start, to: end });
      }
      const chunks = await Promise.all(
        windows.map((w) =>
          pub.getLogs({
            address: addresses.governor,
            event: PROPOSAL_CREATED,
            fromBlock: w.from,
            toBlock: w.to,
          }),
        ),
      );
      const all = chunks.flat();
      return { pub, events: all };
    } catch (e) {
      errors.push(`${rpc.replace(/^https?:\/\//, "").slice(0, 24)}: ${(e as Error).message?.split("\n")[0]?.slice(0, 80)}`);
      continue;
    }
  }
  throw new Error("all RPCs failed: " + errors.join(" | "));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chainParam = (url.searchParams.get("chain") ?? "ethereum") as "ethereum" | "lightchain";
    const chain = chainParam === "lightchain" ? "lightchain" : "ethereum";
    const addresses = DAO_ADDRESSES[chain];
    const { pub, events } = await findEventsAcrossRpcs(addresses, chain);
    // Newest first; cap at 6 to keep the per-card RPC pressure modest.
    const recent = events.slice().reverse().slice(0, 6);
    const abi = GOVERNOR_ABI;
    const proposals = await Promise.all(
      recent.map(async (log) => {
        const args = (log as unknown as { args: { proposalId: bigint; description: string; proposer: `0x${string}`; voteStart: bigint; voteEnd: bigint } }).args;
        const id = args.proposalId;
        const [stateRaw, votes, deadline] = (await Promise.all([
          pub.readContract({ address: addresses.governor, abi, functionName: "state", args: [id] }).catch(() => -1),
          pub.readContract({ address: addresses.governor, abi, functionName: "proposalVotes", args: [id] }).catch(() => [0n, 0n, 0n]),
          pub.readContract({ address: addresses.governor, abi, functionName: "proposalDeadline", args: [id] }).catch(() => 0n),
        ])) as [number, [bigint, bigint, bigint], bigint];
        const state = stateRaw as ProposalState;
        return {
          id: id.toString(),
          title: deriveTitle(args.description),
          descriptionPreview: shortenDescription(args.description),
          proposer: args.proposer,
          state,
          stateLabel: PROPOSAL_STATE_LABEL[state] ?? "unknown",
          voteStart: args.voteStart.toString(),
          voteEnd: args.voteEnd.toString(),
          deadlineBlock: deadline.toString(),
          votesFor: votes[1].toString(),
          votesAgainst: votes[0].toString(),
          votesAbstain: votes[2].toString(),
        };
      }),
    );
    return NextResponse.json({
      chain,
      addresses,
      proposals,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
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
    if (!pub) throw new Error("no Ethereum RPC reachable");
    const abi = GOVERNOR_ABI;
    const id = BigInt(body.id);
    const [stateRaw, votes, snapshot, deadline, proposer] = (await Promise.all([
      pub.readContract({ address: addresses.governor, abi, functionName: "state", args: [id] }).catch(() => -1),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalVotes", args: [id] }).catch(() => [0n, 0n, 0n]),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalSnapshot", args: [id] }).catch(() => 0n),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalDeadline", args: [id] }).catch(() => 0n),
      pub.readContract({ address: addresses.governor, abi, functionName: "proposalProposer", args: [id] }).catch(() => null),
    ])) as [number, [bigint, bigint, bigint], bigint, bigint, `0x${string}` | null];
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
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
