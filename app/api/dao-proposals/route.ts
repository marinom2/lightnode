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
import { DAO_ADDRESSES, PROPOSAL_STATE_LABEL, GOVERNOR_ABI, decodeGovernanceAction, type ProposalState } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The full-history scan fans out ~20 parallel getLogs; give it room beyond the
// default serverless budget.
export const maxDuration = 30;

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

// Bound each RPC attempt so a slow-but-not-failing endpoint can't eat the whole
// Vercel budget before the loop tries the next one. The full-history scan fans
// out ~20 parallel getLogs, so allow a little more headroom than a recent window.
const RPC_ATTEMPT_TIMEOUT_MS = 9000;

// Governor deployment blocks. Scanning from here (not a recent window) is the
// only way to surface EVERY proposal. Ethereum mainnet LCAIGovernor 0x6dfa...
// deployed at ~24,350,285 (verified on-chain); LightChain's is young so genesis
// is cheap.
const DEPLOY_BLOCK: Record<"ethereum" | "lightchain", bigint> = {
  ethereum: 24_350_000n,
  lightchain: 0n,
};

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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function findEventsAcrossRpcs(
  addresses: { governor: `0x${string}` },
  chain: "ethereum" | "lightchain",
) {
  const errors: string[] = [];
  // Public RPCs (notably publicnode) cap getLogs at 50k blocks per call, so we
  // chunk. Scanning from the Governor's deployment block (not a recent window)
  // is what surfaces EVERY proposal. Parallel keeps it inside the budget.
  const CHUNK = 50_000n;
  for (const rpc of RPCS_BY_CHAIN[chain]) {
    try {
      // Wrap the whole per-RPC attempt (head read + chunked getLogs) in one
      // deadline so a single stalled socket fails fast and the loop moves on.
      const result = await withTimeout(
        (async () => {
          const pub = createPublicClient({ transport: http(rpc) });
          const head = await pub.getBlockNumber();
          const deploy = DEPLOY_BLOCK[chain];
          const fromBlock = head > deploy ? deploy : 0n;
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
          return { pub, events: chunks.flat() };
        })(),
        RPC_ATTEMPT_TIMEOUT_MS,
        `${chain} RPC ${rpc.replace(/^https?:\/\//, "").slice(0, 24)}`,
      );
      return result;
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
    // `limit` paginates the per-call slice. Default 6 keeps initial page
    // load cheap; max 30 protects free RPCs from getting hammered when a
    // visitor clicks 'See more' a few times.
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "12")));
    const addresses = DAO_ADDRESSES[chain];
    const { pub, events } = await findEventsAcrossRpcs(addresses, chain);
    const total = events.length;
    const recent = events.slice().reverse().slice(0, limit);
    const abi = GOVERNOR_ABI;
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
      hasMore: total > proposals.length,
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
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
