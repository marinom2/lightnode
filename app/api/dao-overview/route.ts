/**
 * Server-side DAO "health header": treasury + fee-pool balances and the quorum
 * configuration for a governance chain. Loads independently of the (slower)
 * proposal event scan so the panel can show the treasury + quorum instantly.
 *
 * The two chains carry the same OZ Governor surface but different vote tokens:
 *   - Ethereum: LCAIB is an ERC-20 (ERC20Votes). Treasury holds LCAI ERC-20.
 *   - LightChain: voting is a native genesis predeploy; treasury + FeePool hold
 *     native LCAI. The predeploy has no totalSupply()/symbol() (they revert),
 *     so those fields come back null and the UI degrades gracefully.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { DAO_ADDRESSES } from "lightnode-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

const RPCS_BY_CHAIN: Record<"ethereum" | "lightchain", string[]> = {
  ethereum: process.env.LIGHTNODE_ETH_RPC
    ? [process.env.LIGHTNODE_ETH_RPC]
    : ["https://ethereum-rpc.publicnode.com", "https://eth.merkle.io", "https://rpc.ankr.com/eth"],
  lightchain: ["https://rpc.mainnet.lightchain.ai"],
};

// FeePool genesis predeploy - protocol fees accrue here before sweeping to the
// treasury. Native LCAI balance, LightChain only.
const FEE_POOL = "0x0000000000000000000000000000000000001004" as const;

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);
const QUORUM_ABI = parseAbi([
  "function quorumNumerator() view returns (uint256)",
  "function quorumDenominator() view returns (uint256)",
]);
const SCHEDULE_ABI = parseAbi([
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
]);
const TIMELOCK_ABI = parseAbi(["function getMinDelay() view returns (uint256)"]);

// Both governors count voting in blocks (CLOCK_MODE=blocknumber), so we convert
// votingDelay/votingPeriod to real time with the measured mainnet block time:
// Ethereum ~12s (slot), LightChain ~6s. Timelock delay is already in seconds.
const SECONDS_PER_BLOCK: Record<"ethereum" | "lightchain", number> = { ethereum: 12, lightchain: 6 };

type Pub = ReturnType<typeof createPublicClient>;

async function firstReachableClient(chain: "ethereum" | "lightchain"): Promise<Pub> {
  for (const rpc of RPCS_BY_CHAIN[chain]) {
    try {
      const client = createPublicClient({ transport: http(rpc) });
      await client.getBlockNumber();
      return client;
    } catch {
      continue;
    }
  }
  throw new Error(`no ${chain} RPC reachable`);
}

async function readSchedule(pub: Pub, governor: `0x${string}`, timelock: `0x${string}`, chain: "ethereum" | "lightchain") {
  const spb = SECONDS_PER_BLOCK[chain];
  const [delayBlocks, periodBlocks, thresholdWei, minDelay] = await Promise.all([
    pub.readContract({ address: governor, abi: SCHEDULE_ABI, functionName: "votingDelay" }).catch(() => 0n),
    pub.readContract({ address: governor, abi: SCHEDULE_ABI, functionName: "votingPeriod" }).catch(() => 0n),
    pub.readContract({ address: governor, abi: SCHEDULE_ABI, functionName: "proposalThreshold" }).catch(() => 0n),
    pub.readContract({ address: timelock, abi: TIMELOCK_ABI, functionName: "getMinDelay" }).catch(() => 0n),
  ]);
  return {
    votingDelaySeconds: Number(delayBlocks as bigint) * spb,
    votingPeriodSeconds: Number(periodBlocks as bigint) * spb,
    timelockSeconds: Number(minDelay as bigint),
    proposalThresholdWei: (thresholdWei as bigint).toString(),
  };
}

async function readQuorumConfig(pub: Pub, governor: `0x${string}`) {
  const [numerator, denominator] = await Promise.all([
    pub.readContract({ address: governor, abi: QUORUM_ABI, functionName: "quorumNumerator" }).catch(() => 0n),
    pub.readContract({ address: governor, abi: QUORUM_ABI, functionName: "quorumDenominator" }).catch(() => 100n),
  ]);
  return { numerator: (numerator as bigint).toString(), denominator: (denominator as bigint).toString() };
}

async function readEthereumOverview(pub: Pub) {
  const a = DAO_ADDRESSES.ethereum;
  const [treasuryWei, supplyWei, symbol, quorum] = await Promise.all([
    pub.readContract({ address: a.token!, abi: ERC20_ABI, functionName: "balanceOf", args: [a.treasury] }).catch(() => 0n),
    pub.readContract({ address: a.ballots!, abi: ERC20_ABI, functionName: "totalSupply" }).catch(() => 0n),
    pub.readContract({ address: a.ballots!, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "LCAIB"),
    readQuorumConfig(pub, a.governor),
  ]);
  return {
    treasuryWei: (treasuryWei as bigint).toString(),
    feePoolWei: null as string | null,
    voteToken: { address: a.ballots, symbol: symbol as string, totalSupplyWei: (supplyWei as bigint).toString() },
    quorum,
  };
}

async function readLightchainOverview(pub: Pub) {
  const a = DAO_ADDRESSES.lightchain;
  // Native balances: treasury + FeePool hold native LCAI (no ERC-20 wrapper).
  const [treasuryWei, feePoolWei, quorum] = await Promise.all([
    pub.getBalance({ address: a.treasury }).catch(() => 0n),
    pub.getBalance({ address: FEE_POOL }).catch(() => 0n),
    readQuorumConfig(pub, a.governor),
  ]);
  return {
    treasuryWei: treasuryWei.toString(),
    feePoolWei: feePoolWei.toString(),
    voteToken: { address: a.ballots, symbol: "LCAI", totalSupplyWei: null as string | null },
    quorum,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const chain = (url.searchParams.get("chain") ?? "ethereum") === "lightchain" ? "lightchain" : "ethereum";
    const addresses = DAO_ADDRESSES[chain];
    const pub = await firstReachableClient(chain);
    const [detail, schedule] = await Promise.all([
      chain === "ethereum" ? readEthereumOverview(pub) : readLightchainOverview(pub),
      readSchedule(pub, addresses.governor, addresses.timelock, chain),
    ]);
    return NextResponse.json({
      chain,
      governor: addresses.governor,
      timelock: addresses.timelock,
      treasury: addresses.treasury,
      feePool: chain === "lightchain" ? FEE_POOL : null,
      explorer: addresses.explorer,
      ...detail,
      schedule,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split("\n")[0] ?? "fetch failed" }, { status: 500 });
  }
}
