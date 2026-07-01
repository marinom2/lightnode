/**
 * In-wallet governance: list LCAI Governor proposals on Ethereum AND LightChain
 * and vote from the wallet. Proposal discovery uses each chain's Blockscout
 * logs API (no RPC getLogs range limits, open CORS), decoded with viem; state
 * and tallies are read from the governor directly. Inlined, no SDK dependency.
 */
import { createPublicClient, decodeEventLog, encodeFunctionData, formatEther, http, parseAbi, parseAbiItem, toEventSelector } from "viem";
import { chainById } from "./chains";
import { BLOCKSCOUT } from "./history";
import { LCAI_ERC20 } from "./bridge";
import { decodeDangerousCall } from "../provider/decode-call";

export const GOVERNORS: Record<number, `0x${string}`> = {
  1: "0x6dfa413B5900a1a7947BC75E68AbBA093cB2492d",
  // Live LightChainGovernor (verified on-chain; supersedes 0x262E9f).
  9200: "0xD216A0c0050EdC3a9E0449EcFDf178A1652b4b68",
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

export interface ProposalAction {
  target: string;
  valueLcai: number;
  label: string; // decoded calldata meaning ("Token transfer", "Contract call"...)
  dangerous: boolean;
}

export interface ProposalView {
  id: string; // uint256 as decimal string
  title: string;
  description: string; // full on-chain text, clamped
  proposer: string;
  state: ProposalState;
  forVotes: number; // LCAI
  againstVotes: number;
  abstainVotes: number;
  deadlineBlock: string;
  blocksLeft: number | null; // null when not active
  youVoted: boolean;
  yourWeight: number; // voting power at the proposal snapshot (LCAI)
  actions: ProposalAction[];
}

const DESCRIPTION_CAP = 4000;
const stripControls = (t: string): string => t.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u0008\u000E-\u001F\u007F]/g, "");

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
export interface RawProposal {
  id: string;
  proposer: string;
  description: string;
  targets: string[];
  values: bigint[];
  calldatas: `0x${string}`[];
}

export function parseProposalLogs(json: unknown): RawProposal[] {
  const items = ((json ?? {}) as { items?: BsLog[] }).items;
  if (!Array.isArray(items)) return [];
  const out: RawProposal[] = [];
  for (const it of items) {
    const data = typeof it?.data === "string" ? (it.data as `0x${string}`) : null;
    const topics = Array.isArray(it?.topics) ? (it.topics.filter((t) => typeof t === "string" && t !== null) as `0x${string}`[]) : [];
    if (!data || topics[0]?.toLowerCase() !== PROPOSAL_CREATED_TOPIC.toLowerCase()) continue;
    try {
      const dec = decodeEventLog({ abi: [PROPOSAL_CREATED], data, topics: topics as [`0x${string}`, ...`0x${string}`[]] });
      const a = dec.args as unknown as { proposalId: bigint; proposer: string; targets: readonly string[]; values: readonly bigint[]; calldatas: readonly `0x${string}`[]; description: string };
      out.push({
        id: a.proposalId.toString(),
        proposer: a.proposer,
        description: typeof a.description === "string" ? stripControls(a.description).slice(0, DESCRIPTION_CAP) : "",
        targets: Array.isArray(a.targets) ? [...a.targets] : [],
        values: Array.isArray(a.values) ? [...a.values] : [],
        calldatas: Array.isArray(a.calldatas) ? [...a.calldatas] : [],
      });
    } catch {
      continue; // malformed log
    }
  }
  return out;
}

/** Decode what a proposal would EXECUTE, reusing the wallet's calldata decoder. */
export function decodeActions(p: RawProposal): ProposalAction[] {
  return p.targets.slice(0, 10).map((target, i) => {
    const calldata = p.calldatas[i];
    const value = p.values[i] ?? 0n;
    const dec = calldata && calldata.length > 2 ? decodeDangerousCall(calldata) : null;
    return {
      target,
      valueLcai: Number(formatEther(value)),
      label: dec && dec.kind !== "empty" ? `${dec.label}. ${dec.detail}` : value > 0n ? "Native transfer" : "Contract call",
      dangerous: dec?.severity === "danger",
    };
  });
}

const LIST_TIMEOUT_MS = 12000;
const MAX_PROPOSALS = 8;

/**
 * Topic-filtered, full-range log query (Blockscout v1 getLogs). The v2 address
 * feed pages 50 newest logs of ALL kinds: on a live governor VoteCast events
 * bury ProposalCreated entirely (the bug that showed "no proposals" while the
 * Ethereum governor held 30). topic0 filtering pushes the search server-side.
 */
async function fetchProposalLogs(base: string, governor: string): Promise<RawProposal[]> {
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
  let created: RawProposal[];
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
          description: p.description,
          actions: decodeActions(p),
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

// ---- DAO stats (treasury + quorum) ---------------------------------------------

const TREASURIES: Record<number, `0x${string}`> = {
  1: "0x07A716a551E5f4CA7D6C71Da9dF1cb1429Dba826",
  9200: "0x786eDe8C42Ca54E54c9dCECa9b30052CF4743389",
};
const QUORUM_ABI = parseAbi([
  "function quorumNumerator() view returns (uint256)",
  "function quorumDenominator() view returns (uint256)",
]);
const BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
// LightChain: the Governor's quorum() is overridden to use getTotalVotingPower
// (staked LCAI excluded), so the real quorum is 3% of the votable base, not 3%
// of raw supply. Read the resolved threshold directly.
const NATIVE_QUORUM_ABI = parseAbi([
  "function quorum(uint256 timepoint) view returns (uint256)",
  "function clock() view returns (uint48)",
]);

export interface DaoStatsView {
  treasuryLcai: number | null; // null = unreadable right now
  quorumPct: number | null;
  // LightChain: the real quorum threshold in LCAI (3% of the staked-excluded
  // votable supply) + a flag that staked LCAI is excluded from the base.
  quorumLcai?: number | null;
  stakeExcluded?: boolean;
}

/** Treasury holds the ERC-20 on Ethereum and native LCAI on LightChain. */
export async function readDaoStats(chainId: number): Promise<DaoStatsView> {
  const governor = GOVERNORS[chainId];
  const treasury = TREASURIES[chainId];
  if (!governor || !treasury) return { treasuryLcai: null, quorumPct: null };
  const pub = createPublicClient({ chain: chainById(chainId), transport: http() });
  const [bal, num, den] = await Promise.all([
    chainId === 1
      ? (pub.readContract({ address: LCAI_ERC20, abi: BALANCE_ABI, functionName: "balanceOf", args: [treasury] }).catch(() => null) as Promise<bigint | null>)
      : pub.getBalance({ address: treasury }).then((b): bigint | null => b).catch(() => null),
    pub.readContract({ address: governor, abi: QUORUM_ABI, functionName: "quorumNumerator" }).catch(() => null) as Promise<bigint | null>,
    pub.readContract({ address: governor, abi: QUORUM_ABI, functionName: "quorumDenominator" }).catch(() => 100n) as Promise<bigint | null>,
  ]);
  const base: DaoStatsView = {
    treasuryLcai: bal === null ? null : Number(formatEther(bal)),
    quorumPct: num === null || den === null || den === 0n ? null : Number((num * 10000n) / den) / 100,
  };
  // LightChain reports the REAL quorum: 3% of the staked-excluded votable supply.
  if (chainId !== 9200) return base;
  try {
    const clock = BigInt(await pub.readContract({ address: governor, abi: NATIVE_QUORUM_ABI, functionName: "clock" }));
    const ref = clock > 0n ? clock - 1n : 0n;
    const quorumWei = (await pub.readContract({ address: governor, abi: NATIVE_QUORUM_ABI, functionName: "quorum", args: [ref] }).catch(() => null)) as bigint | null;
    return { ...base, quorumLcai: quorumWei === null ? null : Number(formatEther(quorumWei)), stakeExcluded: true };
  } catch {
    return base;
  }
}
