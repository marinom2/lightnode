/**
 * Shared server-side scan for OZ Governor `ProposalCreated` history. Used by the
 * DAO proposals + analytics routes so the chunked, multi-RPC getLogs strategy
 * lives in one place.
 *
 * Free public RPCs cap getLogs at ~50k blocks per call and rate-limit large
 * ranges, so we chunk from the Governor's deployment block (the only way to
 * surface EVERY proposal, not just a recent window) and race a per-attempt
 * deadline across a list of endpoints.
 */
import { createPublicClient, http, parseAbiItem } from "viem";

export type GovernorChain = "ethereum" | "lightchain";

export const RPCS_BY_CHAIN: Record<GovernorChain, string[]> = {
  ethereum: process.env.LIGHTNODE_ETH_RPC
    ? [process.env.LIGHTNODE_ETH_RPC]
    : ["https://ethereum-rpc.publicnode.com", "https://eth.merkle.io", "https://rpc.ankr.com/eth", "https://eth.drpc.org"],
  lightchain: ["https://rpc.mainnet.lightchain.ai"],
};

// Governor deployment blocks. Ethereum mainnet LCAIGovernor 0x6dfa... deployed at
// ~24,350,285 (verified on-chain); LightChain's is young so genesis is cheap.
export const DEPLOY_BLOCK: Record<GovernorChain, bigint> = {
  ethereum: 24_350_000n,
  lightchain: 0n,
};

export const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)",
);

const RPC_ATTEMPT_TIMEOUT_MS = 9000;
const CHUNK = 50_000n;

/** Run `fn` over `items` in small concurrent batches to keep free-RPC load sane. */
export async function mapBatched<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map((item, j) => fn(item, i + j)))));
  }
  return out;
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

/**
 * Scan every `ProposalCreated` event for a governor. Returns the public client
 * that answered (reuse it for follow-up reads), the events, and the head block.
 */
export async function findGovernorEvents(governor: `0x${string}`, chain: GovernorChain) {
  const errors: string[] = [];
  for (const rpc of RPCS_BY_CHAIN[chain]) {
    try {
      return await withTimeout(
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
            windows.map((w) => pub.getLogs({ address: governor, event: PROPOSAL_CREATED, fromBlock: w.from, toBlock: w.to })),
          );
          return { pub, events: chunks.flat(), head };
        })(),
        RPC_ATTEMPT_TIMEOUT_MS,
        `${chain} RPC ${rpc.replace(/^https?:\/\//, "").slice(0, 24)}`,
      );
    } catch (e) {
      errors.push(`${rpc.replace(/^https?:\/\//, "").slice(0, 24)}: ${(e as Error).message?.split("\n")[0]?.slice(0, 80)}`);
      continue;
    }
  }
  throw new Error("all RPCs failed: " + errors.join(" | "));
}
