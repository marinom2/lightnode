/**
 * In-wallet governance: list LCAI Governor proposals on Ethereum AND LightChain
 * and vote from the wallet. Proposal discovery uses each chain's Blockscout
 * logs API (no RPC getLogs range limits, open CORS), decoded with viem; state
 * and tallies are read from the governor directly. Inlined, no SDK dependency.
 */
import { createPublicClient, decodeEventLog, encodeFunctionData, formatEther, http, parseAbi, parseAbiItem, toEventSelector } from "viem";
import { chainById } from "./chains";
import { BLOCKSCOUT } from "./history";

export const GOVERNORS: Record<number, `0x${string}`> = {
  1: "0x6dfa413B5900a1a7947BC75E68AbBA093cB2492d",
  9200: "0x262E9f9232933E8565253918db703baD58DE93aB",
};

const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);
const PROPOSAL_CREATED_TOPIC = toEventSelector(
  "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)",
);
const GOV_ABI = parseAbi([
  "function state(uint256 proposalId) view returns (uint8)",
  "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function proposalDeadline(uint256 proposalId) view returns (uint256)",
  "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
  "function getVotes(address account, uint256 timepoint) view returns (uint256)",
  "function hasVoted(uint256 proposalId, address account) view returns (bool)",
  "function castVote(uint256 proposalId, uint8 support) returns (uint256)",
]);

export const STATE_LABELS = ["pending", "active", "canceled", "defeated", "succeeded", "queued", "expired", "executed"] as const;
export type ProposalState = (typeof STATE_LABELS)[number];

export interface ProposalView {
  id: string; // uint256 as decimal string
  title: string;
  proposer: string;
  state: ProposalState;
  forVotes: number; // LCAI
  againstVotes: number;
  abstainVotes: number;
  deadlineBlock: string;
  blocksLeft: number | null; // null when not active
  youVoted: boolean;
  yourWeight: number; // voting power at the proposal snapshot (LCAI)
}

/** First non-empty line of the on-chain description, control chars stripped. */
export function titleFrom(description: string, id: string): string {
  const line = description
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u001F\u007F]/g, "").trim())
    .find((l) => l.length > 0);
  const t = line || `Proposal #${id.slice(0, 8)}`;
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

interface BsLog {
  data?: unknown;
  topics?: unknown;
  index?: unknown;
}

/**
 * Decode ProposalCreated events out of raw Blockscout log items. Pre-filtered by
 * topic0 so we never waste a decode on the VoteCast logs that dominate the feed.
 */
export function parseProposalLogs(json: unknown): { id: string; proposer: string; description: string }[] {
  const items = ((json ?? {}) as { items?: BsLog[] }).items;
  if (!Array.isArray(items)) return [];
  const out: { id: string; proposer: string; description: string }[] = [];
  for (const it of items) {
    const data = typeof it?.data === "string" ? (it.data as `0x${string}`) : null;
    const topics = Array.isArray(it?.topics) ? (it.topics.filter((t) => typeof t === "string" && t !== null) as `0x${string}`[]) : [];
    if (!data || topics[0]?.toLowerCase() !== PROPOSAL_CREATED_TOPIC.toLowerCase()) continue;
    try {
      const dec = decodeEventLog({ abi: [PROPOSAL_CREATED], data, topics: topics as [`0x${string}`, ...`0x${string}`[]] });
      const a = dec.args as unknown as { proposalId: bigint; proposer: string; description: string };
      out.push({ id: a.proposalId.toString(), proposer: a.proposer, description: typeof a.description === "string" ? a.description : "" });
    } catch {
      continue; // malformed log
    }
  }
  return out;
}

const LIST_TIMEOUT_MS = 12000;
const MAX_PROPOSALS = 8;

/**
 * Topic-filtered, full-range log query (Blockscout v1 getLogs). The v2 address
 * feed pages 50 newest logs of ALL kinds: on a live governor VoteCast events
 * bury ProposalCreated entirely (the bug that showed "no proposals" while the
 * Ethereum governor held 30). topic0 filtering pushes the search server-side.
 */
async function fetchProposalLogs(base: string, governor: string): Promise<{ id: string; proposer: string; description: string }[]> {
  const url = `${base}/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${governor}&topic0=${PROPOSAL_CREATED_TOPIC}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const json = (await res.json()) as { result?: unknown };
  const items = Array.isArray(json.result) ? json.result : [];
  // v1 returns ascending block order: the NEWEST proposals are at the end.
  const decoded = parseProposalLogs({ items: items as never });
  return decoded.slice(-MAX_PROPOSALS).reverse();
}

export async function listProposals(chainId: number, voter?: string): Promise<ProposalView[] | null> {
  const governor = GOVERNORS[chainId];
  const base = BLOCKSCOUT[chainId];
  if (!governor || !base) return null;
  let created: { id: string; proposer: string; description: string }[];
  try {
    created = await fetchProposalLogs(base, governor);
  } catch {
    return null;
  }
  const pub = createPublicClient({ chain: chainById(chainId), transport: http() });
  const latest = await pub.getBlockNumber().catch(() => null);
  const me = voter && /^0x[0-9a-fA-F]{40}$/.test(voter) ? (voter as `0x${string}`) : null;
  const views = await Promise.all(
    created.map(async (p): Promise<ProposalView | null> => {
      try {
        const id = BigInt(p.id);
        const [state, votes, deadline] = await Promise.all([
          pub.readContract({ address: governor, abi: GOV_ABI, functionName: "state", args: [id] }) as Promise<number>,
          pub.readContract({ address: governor, abi: GOV_ABI, functionName: "proposalVotes", args: [id] }) as Promise<readonly [bigint, bigint, bigint]>,
          pub.readContract({ address: governor, abi: GOV_ABI, functionName: "proposalDeadline", args: [id] }) as Promise<bigint>,
        ]);
        const label = STATE_LABELS[state] ?? "pending";
        // Snapshot weight + hasVoted only matter for live proposals the user can act on.
        let youVoted = false;
        let yourWeight = 0;
        if (me && label === "active") {
          const snapshot = (await pub.readContract({ address: governor, abi: GOV_ABI, functionName: "proposalSnapshot", args: [id] }).catch(() => 0n)) as bigint;
          const [voted, weight] = await Promise.all([
            pub.readContract({ address: governor, abi: GOV_ABI, functionName: "hasVoted", args: [id, me] }).catch(() => false) as Promise<boolean>,
            pub.readContract({ address: governor, abi: GOV_ABI, functionName: "getVotes", args: [me, snapshot] }).catch(() => 0n) as Promise<bigint>,
          ]);
          youVoted = voted;
          yourWeight = Number(formatEther(weight));
        }
        return {
          id: p.id,
          title: titleFrom(p.description, p.id),
          proposer: p.proposer,
          state: label,
          againstVotes: Number(formatEther(votes[0])),
          forVotes: Number(formatEther(votes[1])),
          abstainVotes: Number(formatEther(votes[2])),
          deadlineBlock: deadline.toString(),
          blocksLeft: label === "active" && latest !== null ? Math.max(0, Number(deadline - latest)) : null,
          youVoted,
          yourWeight,
        };
      } catch {
        return null; // a single bad proposal must not blank the list
      }
    }),
  );
  return views.filter((v): v is ProposalView => v !== null);
}

export function castVoteData(proposalId: string, support: 0 | 1 | 2): `0x${string}` {
  return encodeFunctionData({ abi: GOV_ABI, functionName: "castVote", args: [BigInt(proposalId), support] });
}
