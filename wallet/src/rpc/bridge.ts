/**
 * Move LCAI between Ethereum (ERC-20) and LightChain (native) over the Hyperlane
 * warp route, signed by the wallet. Eth->LC: approve the collateral router, then
 * transferRemote with value = fee. LC->Eth: HypNative transferRemote with
 * value = amount + fee. Inlined with viem (no SDK dependency).
 */
import { type Account, createPublicClient, createWalletClient, http, parseEther, parseAbi, pad } from "viem";
import { chainById } from "./chains";

interface Route {
  chainId: number;
  domain: number;
  router: `0x${string}`;
  underlying: `0x${string}` | null;
}
const ROUTES = {
  ethereum: { chainId: 1, domain: 1, router: "0x01f80bb8e78e79881E8Ec7832fB6C2c59f64e353", underlying: "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927" },
  lightchain: { chainId: 9200, domain: 9200, router: "0xEc7096A3116EE769457C939617375Ec1785AA6f1", underlying: null },
} as const satisfies Record<string, Route>;

const ROUTER_ABI = parseAbi([
  "function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32)",
  "function quoteGasPayment(uint32 destination) view returns (uint256)",
]);
const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

export type BridgeDir = "eth-to-lc" | "lc-to-eth";

/** The LCAI ERC-20 on Ethereum (single source of truth for the UI too). */
export const LCAI_ERC20 = ROUTES.ethereum.underlying;

const BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** LCAI balance on the SOURCE side of a move (ERC-20 on Ethereum, native on LightChain). */
export async function bridgeSourceBalance(dir: BridgeDir, account: `0x${string}`): Promise<string> {
  if (dir === "eth-to-lc") {
    const pub = createPublicClient({ chain: chainById(1), transport: http() });
    const wei = (await pub.readContract({ address: LCAI_ERC20, abi: BALANCE_ABI, functionName: "balanceOf", args: [account] })) as bigint;
    return (Number(wei) / 1e18).toString();
  }
  const pub = createPublicClient({ chain: chainById(9200), transport: http() });
  return (Number(await pub.getBalance({ address: account })) / 1e18).toString();
}

const toBytes32 = (a: string): `0x${string}` => pad(a as `0x${string}`, { size: 32 });

export async function bridgeFee(dir: BridgeDir): Promise<string> {
  const src = dir === "eth-to-lc" ? ROUTES.ethereum : ROUTES.lightchain;
  const dst = dir === "eth-to-lc" ? ROUTES.lightchain : ROUTES.ethereum;
  const pub = createPublicClient({ chain: chainById(src.chainId), transport: http() });
  const fee = (await pub.readContract({ address: src.router, abi: ROUTER_ABI, functionName: "quoteGasPayment", args: [dst.domain] })) as bigint;
  return (Number(fee) / 1e18).toString();
}

export async function bridgeTransfer(account: Account, dir: BridgeDir, amount: string, expectedFeeWei?: string): Promise<{ hash: string }> {
  const src = dir === "eth-to-lc" ? ROUTES.ethereum : ROUTES.lightchain;
  const dst = dir === "eth-to-lc" ? ROUTES.lightchain : ROUTES.ethereum;
  const chain = chainById(src.chainId);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });
  const amt = parseEther(amount);
  // Re-read the fee at execution, but never let a hostile RPC inflate the native
  // value we spend: the live fee must stay within 50% of the fee the user was
  // shown (the HypNative leg adds the fee straight onto value).
  const fee = (await pub.readContract({ address: src.router, abi: ROUTER_ABI, functionName: "quoteGasPayment", args: [dst.domain] })) as bigint;
  if (expectedFeeWei !== undefined) {
    const expected = BigInt(expectedFeeWei);
    const ceiling = (expected * 3n) / 2n + 1n;
    if (fee > ceiling) throw new Error("The bridge fee jumped well above the quote. Aborting to protect your funds; try again.");
  }
  const recipient = toBytes32(account.address);

  if (src.underlying) {
    // ERC-20 leg: approve the router once, then transferRemote (value = fee only).
    const allowance = (await pub.readContract({ address: src.underlying, abi: ERC20, functionName: "allowance", args: [account.address, src.router] })) as bigint;
    if (allowance < amt) {
      const approveHash = await wallet.writeContract({ address: src.underlying, abi: ERC20, functionName: "approve", args: [src.router, amt] });
      await pub.waitForTransactionReceipt({ hash: approveHash });
    }
    return { hash: await wallet.writeContract({ address: src.router, abi: ROUTER_ABI, functionName: "transferRemote", args: [dst.domain, recipient, amt], value: fee }) };
  }
  // HypNative leg: value carries amount + fee.
  return { hash: await wallet.writeContract({ address: src.router, abi: ROUTER_ABI, functionName: "transferRemote", args: [dst.domain, recipient, amt], value: amt + fee }) };
}
