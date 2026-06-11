/**
 * Light governance read for the wallet: surface the account's voting power and
 * whether its tokens are delegated (undelegated tokens do not count toward a
 * vote, which the ballot app does not flag upfront). We only read and link out
 * to the DAO to actually vote, never run governance writes from the wallet.
 */
import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { chainById } from "./chains";

interface DaoChainCfg {
  /** IVotes contract (LCAIBallots on Ethereum, native voting precompile on LightChain). */
  ballots: `0x${string}`;
  voteUrl: string;
  /** LightChain auto-delegates native stake; Ethereum needs an explicit delegate(). */
  autoDelegate: boolean;
}

const DAO: Record<number, DaoChainCfg> = {
  1: { ballots: "0x75F3D01c4D960FE986A598B7954A3b786B29cE49", voteUrl: "https://dao.lightchain.ai", autoDelegate: false },
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
