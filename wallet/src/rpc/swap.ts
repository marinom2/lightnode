/**
 * In-wallet swaps over Uniswap V3 (QuoterV2 quotes, SwapRouter02 execution),
 * inlined with viem. Code-pinned addresses per chain; the dapp surface never
 * touches this. Native legs use the router's own wrap/unwrap: native-in sends
 * value with tokenIn = WETH9; native-out routes to the router (ADDRESS_THIS)
 * and appends unwrapWETH9 in a multicall. Single-hop only, slippage-bounded.
 * A verified LCAI/WETH 0.3% pool exists on Ethereum, so ETH <-> LCAI is live.
 */
import { type Account, createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, parseUnits } from "viem";
import { chainById } from "./chains";

interface DexConfig {
  quoter: `0x${string}`; // QuoterV2
  router: `0x${string}`; // SwapRouter02
  weth: `0x${string}`; // canonical wrapped-native
}

export const DEX: Record<number, DexConfig> = {
  1: { quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  8453: { quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a", router: "0x2626664c2603336E57B271c5C0b26F421741e481", weth: "0x4200000000000000000000000000000000000006" },
  42161: { quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
  10: { quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", weth: "0x4200000000000000000000000000000000000006" },
  137: { quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", weth: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" },
};

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  // Deadline-bounded multicall: a stale tx mined late reverts instead of
  // executing at a now-bad price.
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);
const SWAP_DEADLINE_SECS = 600n;
const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const FEE_TIERS = [3000, 500, 10000] as const;
// SwapRouter02 sentinel: recipient = the router itself (for unwrap chaining).
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as const;
export const SLIPPAGE_BPS = 50n; // 0.5%

/** null token = the chain's native coin. */
export type SwapSide = { token: `0x${string}` | null; decimals: number };

export function minOutFor(amountOut: bigint, slippageBps = SLIPPAGE_BPS): bigint {
  return amountOut - (amountOut * slippageBps) / 10000n;
}

export interface SwapQuote {
  amountOut: string; // formatted by decimalsOut
  amountOutWei: string;
  fee: number; // pool fee tier that priced best
}

/** Best single-hop quote across fee tiers; null when no pool has liquidity. */
export async function quoteSwap(chainId: number, tIn: SwapSide, tOut: SwapSide, amountIn: string): Promise<SwapQuote | null> {
  const dex = DEX[chainId];
  if (!dex) return null;
  const tokenIn = tIn.token ?? dex.weth;
  const tokenOut = tOut.token ?? dex.weth;
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return null;
  const wei = parseUnits(amountIn, tIn.decimals);
  if (wei <= 0n) return null;
  const pub = createPublicClient({ chain: chainById(chainId), transport: http() });
  let best: { out: bigint; fee: number } | null = null;
  for (const fee of FEE_TIERS) {
    try {
      const { result } = await pub.simulateContract({
        address: dex.quoter,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn: wei, fee, sqrtPriceLimitX96: 0n }],
      });
      const out = result[0];
      if (out > 0n && (!best || out > best.out)) best = { out, fee };
    } catch {
      // no pool at this tier; try the next
    }
  }
  if (!best) return null;
  return {
    amountOut: (Number(best.out) / 10 ** tOut.decimals).toString(),
    amountOutWei: best.out.toString(),
    fee: best.fee,
  };
}

interface SwapCall {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}

/**
 * Pure calldata builder (unit-tested): approval is handled by the caller. Every
 * swap is wrapped in a deadline-bounded multicall so a stale mempool tx reverts
 * rather than filling at a moved price.
 */
export function buildSwapCall(chainId: number, account: `0x${string}`, tIn: SwapSide, tOut: SwapSide, amountInWei: bigint, minOutWei: bigint, fee: number, deadline: bigint): SwapCall {
  const dex = DEX[chainId];
  if (!dex) throw new Error("Swaps are not available on this network.");
  const tokenIn = tIn.token ?? dex.weth;
  const tokenOut = tOut.token ?? dex.weth;
  const nativeIn = tIn.token === null;
  const nativeOut = tOut.token === null;
  const params = {
    tokenIn,
    tokenOut,
    fee,
    recipient: nativeOut ? ADDRESS_THIS : account,
    amountIn: amountInWei,
    amountOutMinimum: minOutWei,
    sqrtPriceLimitX96: 0n,
  } as const;
  const swapData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [params] });
  // Native out: swap lands as WETH on the router, then unwrap to the user.
  const inner = nativeOut
    ? [swapData, encodeFunctionData({ abi: ROUTER_ABI, functionName: "unwrapWETH9", args: [minOutWei, account] })]
    : [swapData];
  const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [deadline, inner] });
  return { to: dex.router, data, value: nativeIn ? amountInWei : 0n };
}

// If the live price has moved more than this against the user since they saw
// the quote, abort rather than execute at a much worse (but still in-band) rate.
const MAX_DRIFT_BPS = 200n; // 2%

/**
 * Re-quote at execution time (the popup's quote can be seconds-to-minutes old)
 * and derive the slippage floor HERE, in the key-holding worker, so the UI can
 * never hand down a too-low floor. `expectedOutWei` is what the user was shown;
 * if the fresh price is more than MAX_DRIFT_BPS below it, we abort.
 */
export async function executeSwap(account: Account, chainId: number, tIn: SwapSide, tOut: SwapSide, amountIn: string, expectedOutWei: bigint, nowSec: number): Promise<{ hash: string }> {
  const dex = DEX[chainId];
  if (!dex) throw new Error("Swaps are not available on this network.");
  const fresh = await quoteSwap(chainId, tIn, tOut, amountIn);
  if (!fresh) throw new Error("No market is available for this pair right now.");
  const freshOut = BigInt(fresh.amountOutWei);
  if (freshOut < expectedOutWei - (expectedOutWei * MAX_DRIFT_BPS) / 10000n) {
    throw new Error("The price moved against you. Check the new quote and try again.");
  }
  const minOut = minOutFor(freshOut); // 0.5% under the FRESH quote
  const chain = chainById(chainId);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const wei = parseUnits(amountIn, tIn.decimals);
  if (tIn.token) {
    const allowance = (await pub.readContract({ address: tIn.token, abi: ERC20_ABI, functionName: "allowance", args: [account.address, dex.router] })) as bigint;
    if (allowance < wei) {
      // USDT-class tokens revert a non-zero -> non-zero approve; reset to 0 first.
      if (allowance > 0n) {
        const resetHash = await wallet.writeContract({ address: tIn.token, abi: ERC20_ABI, functionName: "approve", args: [dex.router, 0n] });
        const r0 = await pub.waitForTransactionReceipt({ hash: resetHash });
        if (r0.status !== "success") throw new Error("Could not reset the token approval. Try again.");
      }
      // Exact-amount approval only: never grant the router an open allowance.
      const approveHash = await wallet.writeContract({ address: tIn.token, abi: ERC20_ABI, functionName: "approve", args: [dex.router, wei] });
      const r1 = await pub.waitForTransactionReceipt({ hash: approveHash });
      if (r1.status !== "success") throw new Error("Token approval failed. Try again.");
    }
  }
  const deadline = BigInt(Math.floor(nowSec) + Number(SWAP_DEADLINE_SECS));
  const call = buildSwapCall(chainId, account.address, tIn, tOut, wei, minOut, fresh.fee, deadline);
  return { hash: await wallet.sendTransaction({ to: call.to, data: call.data, value: call.value }) };
}
