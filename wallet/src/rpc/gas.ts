/**
 * Gas speed tiers from eth_feeHistory (no API key): priority-fee percentiles
 * over recent blocks, plus a base-fee headroom multiplier so the tx survives
 * a few full blocks. Falls back to a single mid tier when the RPC lacks
 * feeHistory (LightChain returns sane defaults via estimateFeesPerGas).
 */
import type { PublicClient } from "viem";

export type GasSpeed = "slow" | "normal" | "fast";

export interface GasTier {
  maxFeePerGas: string; // wei, decimal string (clone-safe across the port)
  maxPriorityFeePerGas: string;
}
export type GasTiers = Record<GasSpeed, GasTier>;

const PERCENTILES = [10, 50, 90] as const;
// base fee can rise 12.5%/block; 2x covers ~6 consecutive full blocks.
const BASE_HEADROOM = 2n;

export function tiersFrom(baseFee: bigint, rewards: [bigint, bigint, bigint]): GasTiers {
  const tier = (prio: bigint): GasTier => ({
    maxFeePerGas: (baseFee * BASE_HEADROOM + prio).toString(),
    maxPriorityFeePerGas: prio.toString(),
  });
  // A zero percentile (empty blocks) still needs a non-zero tip to be includable.
  const floor = (p: bigint) => (p > 0n ? p : 100000000n); // 0.1 gwei
  return { slow: tier(floor(rewards[0])), normal: tier(floor(rewards[1])), fast: tier(floor(rewards[2])) };
}

export async function readGasTiers(client: PublicClient): Promise<GasTiers> {
  try {
    const hist = await client.getFeeHistory({ blockCount: 10, rewardPercentiles: [...PERCENTILES] });
    const base = hist.baseFeePerGas[hist.baseFeePerGas.length - 1] ?? 0n;
    const median = (i: number): bigint => {
      const col = (hist.reward ?? []).map((r) => r[i] ?? 0n).sort((a, b) => (a < b ? -1 : 1));
      return col[Math.floor(col.length / 2)] ?? 0n;
    };
    return tiersFrom(base, [median(0), median(1), median(2)]);
  } catch {
    // RPCs without feeHistory: one sane tier for all three speeds.
    const fees = await client.estimateFeesPerGas();
    const single: GasTier = {
      maxFeePerGas: (fees.maxFeePerGas ?? 1000000000n).toString(),
      maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 100000000n).toString(),
    };
    return { slow: single, normal: single, fast: single };
  }
}
