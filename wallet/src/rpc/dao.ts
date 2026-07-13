/**
 * Light governance read for the wallet: surface the account's voting power on
 * Lightchain AI. Native LCAI stake is auto-delegated, so power counts as soon as
 * you hold it. We only read and link out to the DAO to vote, never run
 * governance writes from here beyond the explicit in-wallet castVote.
 */
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { chainById } from "./chains";

interface DaoChainCfg {
  /** NativeVotes genesis predeploy: the on-chain IVotes source for LCAI. */
  ballots: `0x${string}`;
  voteUrl: string;
  /** Lightchain AI auto-delegates native stake; no explicit delegate() needed. */
  autoDelegate: boolean;
}

// Lightchain AI mainnet only. NativeVotes predeploy per the official contracts doc.
const DAO: Record<number, DaoChainCfg> = {
  9200: { ballots: "0x0000000000000000000000000000000000001001", voteUrl: "https://dao.lightchain.ai", autoDelegate: true },
};

const VOTES_ABI = parseAbi([
  "function getVotes(address) view returns (uint256)",
  "function delegates(address) view returns (address)",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

export interface DaoStatus {
  supported: boolean;
  votingPower: string;
  delegated: boolean;
  voteUrl: string;
}

export async function daoStatus(chainId: number, address: string): Promise<DaoStatus> {
  const cfg = DAO[chainId];
  if (!cfg) return { supported: false, votingPower: "0", delegated: false, voteUrl: "https://dao.lightchain.ai" };

  const pub = createPublicClient({ chain: chainById(chainId), transport: http() });
  const account = address as `0x${string}`;
  const power = (await pub.readContract({ address: cfg.ballots, abi: VOTES_ABI, functionName: "getVotes", args: [account] })) as bigint;

  let delegated = cfg.autoDelegate;
  if (!cfg.autoDelegate) {
    const target = (await pub.readContract({ address: cfg.ballots, abi: VOTES_ABI, functionName: "delegates", args: [account] }).catch(() => ZERO)) as string;
    delegated = target.toLowerCase() === address.toLowerCase();
  }

  return { supported: true, votingPower: formatEther(power), delegated, voteUrl: cfg.voteUrl };
}
