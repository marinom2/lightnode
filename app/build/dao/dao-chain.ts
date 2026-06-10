/**
 * Client-side DAO chain config + on-chain reads for the governance-intelligence
 * panel. lightnode reads + decodes governance state; the actual vote/delegate
 * transactions happen on LightChain's official UIs (see DAO_VOTE_UI), so there
 * are no writes here. The two chains share the OZ Governor surface but differ on
 * the vote token:
 *   - Ethereum  -> LCAIB, an ERC20Votes token (balanceOf works).
 *   - LightChain -> a native genesis predeploy (balanceOf reverts; voting weight
 *     tracks the native LCAI balance, so we read getBalance there instead).
 */
import { createPublicClient, http } from "viem";
import { DAO_ADDRESSES, VOTES_ABI } from "lightnode-sdk";
import { NETWORKS } from "@/lib/network";

export type DaoChain = "ethereum" | "lightchain";

export const DAO_RPC: Record<DaoChain, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  lightchain: NETWORKS.mainnet.rpc,
};

export const DAO_EXPLORER: Record<DaoChain, string> = {
  ethereum: "https://etherscan.io",
  lightchain: NETWORKS.mainnet.explorer,
};

/** The contract that holds voting power: ERC20Votes (ETH) or native predeploy (LC). */
export const VOTE_TOKEN: Record<DaoChain, `0x${string}`> = {
  ethereum: DAO_ADDRESSES.ethereum.ballots as `0x${string}`,
  lightchain: DAO_ADDRESSES.lightchain.ballots as `0x${string}`,
};

// Both governors count voting in BLOCKS (CLOCK_MODE=blocknumber), so block time
// is needed to turn votingDelay/votingPeriod + deadline distance into real time.
// Measured on mainnet: Ethereum ~12.04s (slot time), LightChain ~6.00s.
export const SECONDS_PER_BLOCK: Record<DaoChain, number> = {
  ethereum: 12,
  lightchain: 6,
};

// lightnode is an ecosystem intelligence layer, NOT a governance app: the actual
// vote / delegate / execute transactions happen on LightChain's own official UIs.
// We read + decode everything here and link out for the writes.
export const DAO_VOTE_UI = "https://dao.lightchain.ai";
export const DELEGATION_UI: Record<DaoChain, string | null> = {
  ethereum: "https://ballots.lightchain.ai", // wrap LCAI -> LCAIB + delegate
  lightchain: null, // native voting self-delegates; no wrapper UI
};

export function daoPublicClient(chain: DaoChain) {
  return createPublicClient({ transport: http(DAO_RPC[chain]) });
}

export interface VotingPowerReads {
  votesWei: bigint;
  balanceWei: bigint;
  delegate: `0x${string}`;
}

async function readBalance(
  pub: ReturnType<typeof daoPublicClient>,
  chain: DaoChain,
  token: `0x${string}`,
  address: `0x${string}`,
): Promise<bigint> {
  if (chain === "lightchain") return pub.getBalance({ address }).catch(() => 0n);
  return (
    pub.readContract({ address: token, abi: VOTES_ABI, functionName: "balanceOf", args: [address] }) as Promise<bigint>
  ).catch(() => 0n);
}

export async function loadVotingPower(chain: DaoChain, address: `0x${string}`): Promise<VotingPowerReads> {
  const pub = daoPublicClient(chain);
  const token = VOTE_TOKEN[chain];
  const [votesWei, delegate, balanceWei] = await Promise.all([
    pub.readContract({ address: token, abi: VOTES_ABI, functionName: "getVotes", args: [address] }) as Promise<bigint>,
    pub.readContract({ address: token, abi: VOTES_ABI, functionName: "delegates", args: [address] }) as Promise<`0x${string}`>,
    readBalance(pub, chain, token, address),
  ]);
  return { votesWei, delegate, balanceWei };
}
