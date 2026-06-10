/**
 * Client-side DAO chain config + on-chain reads shared by the voting-power and
 * cast-vote controls. Both governance chains expose the same OZ Governor surface
 * but different vote tokens:
 *   - Ethereum  -> LCAIB, an ERC20Votes token (balanceOf works).
 *   - LightChain -> a native genesis predeploy (balanceOf reverts; voting weight
 *     tracks the native LCAI balance, so we read getBalance there instead).
 */
import { createPublicClient, http } from "viem";
import { DAO_ADDRESSES, GOVERNOR_ABI, VOTES_ABI } from "lightnode-sdk";
import { NETWORKS } from "@/lib/network";

export type DaoChain = "ethereum" | "lightchain";

export const DAO_RPC: Record<DaoChain, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  lightchain: NETWORKS.mainnet.rpc,
};

export const DAO_CHAIN_ID: Record<DaoChain, number> = {
  ethereum: 1,
  lightchain: NETWORKS.mainnet.chainId,
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

export const GOVERNOR: Record<DaoChain, `0x${string}`> = {
  ethereum: DAO_ADDRESSES.ethereum.governor,
  lightchain: DAO_ADDRESSES.lightchain.governor,
};

// Both governors count voting in BLOCKS (CLOCK_MODE=blocknumber), so block time
// is needed to turn votingDelay/votingPeriod + deadline distance into real time.
// Measured on mainnet: Ethereum ~12.04s (slot time), LightChain ~6.00s.
export const SECONDS_PER_BLOCK: Record<DaoChain, number> = {
  ethereum: 12,
  lightchain: 6,
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

// LightChain's gas is tiny enough that MetaMask renders the fee red and blocks
// confirmation unless we pin chain-estimated values. Returns one fee arm or the
// other (never both) so viem's writeContract accepts it. Ethereum renders fine
// natively, so callers only pin for LightChain.
export type PinnedFees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint } | undefined;

export async function pinnedFees(pub: ReturnType<typeof daoPublicClient>): Promise<PinnedFees> {
  try {
    const f = await pub.estimateFeesPerGas();
    return f?.maxFeePerGas
      ? { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? f.maxFeePerGas }
      : { gasPrice: await pub.getGasPrice() };
  } catch {
    try {
      return { gasPrice: await pub.getGasPrice() };
    } catch {
      return undefined;
    }
  }
}

export async function readHasVoted(chain: DaoChain, proposalId: bigint, address: `0x${string}`): Promise<boolean> {
  const pub = daoPublicClient(chain);
  return pub.readContract({
    address: GOVERNOR[chain],
    abi: GOVERNOR_ABI,
    functionName: "hasVoted",
    args: [proposalId, address],
  }) as Promise<boolean>;
}
