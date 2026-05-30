/**
 * Bridge SDK: typed wrapper around the LightChain bridge (Hyperlane Warp
 * Route). Bridging LCAI between Ethereum mainnet and LightChain mainnet
 * (chain 9200) is the main flow today; the addresses below were extracted
 * from `lightchain-protocol/bridge-ui/src/consts/warpRoutes.ts`.
 *
 * The protocol:
 *
 *   Ethereum (chain 1) ─┐                                        ┌─ LightChain (chain 9200)
 *      LCAI ERC-20      │                                        │     native LCAI
 *      0x9cA8...8927    │                                        │
 *                       │                                        │
 *      user.approve()   │   transferRemote(9200, recipient, amt) │
 *      ───────────► HypERC20Collateral 0x01f80b...e353 ──────────┼───► HypNative 0xEc7096...A6f1
 *                       │   (locks LCAI in collateral vault)     │     (mints / releases native LCAI)
 *                       └────────────────────────────────────────┘
 *
 *   Reverse: user calls transferRemote on HypNative (with native value =
 *   amount + quoteGasPayment) to send LCAI back to Ethereum.
 *
 * Both sides expose:
 *   - transferRemote(uint32 destination, bytes32 recipient, uint256 amount)
 *     payable returns (bytes32 messageId)
 *   - quoteGasPayment(uint32 destination) view returns (uint256)
 *
 * For the Ethereum -> LightChain direction the user must first call
 * `approve(0x01f80b...e353, amount)` on the LCAI ERC-20.
 */

import { parseAbi } from "viem";

export type BridgeChain = "ethereum" | "lightchain-mainnet";

export interface BridgeEndpoints {
  /** Numeric chain id (mainnet ETH = 1, LightChain mainnet = 9200). */
  chainId: number;
  /** Hyperlane domain id (matches chainId for these two routes). */
  hyperlaneDomain: number;
  /** The user-facing router (HypERC20Collateral on Ethereum, HypNative on LightChain). */
  router: `0x${string}`;
  /**
   * Underlying ERC-20 the router collateralizes. Null on the synthetic
   * side (LightChain mainnet uses native LCAI). On Ethereum this is the
   * LCAI ERC-20 the user must `approve` before calling `transferRemote`.
   */
  underlying: `0x${string}` | null;
  /** Hyperlane mailbox (the message dispatch contract; useful for tracking). */
  mailbox: `0x${string}`;
  /** Block explorer for this side. */
  explorer: string;
  /** RPC endpoint we know about. */
  rpc: string;
  /** Human label for logs. */
  label: string;
}

/** Live LCAI mainnet bridge route. From bridge-ui/src/consts/warpRoutes.ts. */
export const BRIDGE_ROUTE: Record<BridgeChain, BridgeEndpoints> = {
  ethereum: {
    chainId: 1,
    hyperlaneDomain: 1,
    router: "0x01f80bb8e78e79881E8Ec7832fB6C2c59f64e353",
    underlying: "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927", // LCAI ERC-20
    mailbox: "0x287cf56E5b1435Ae59BF9Ce6443F055A0321a063",
    explorer: "https://etherscan.io",
    rpc: "https://eth.llamarpc.com",
    label: "Ethereum",
  },
  "lightchain-mainnet": {
    chainId: 9200,
    hyperlaneDomain: 9200,
    router: "0xEc7096A3116EE769457C939617375Ec1785AA6f1",
    underlying: null, // HypNative: amount IS the native LCAI value
    mailbox: "0x142a9CEf00ACcAddB76283c49A1Bf37f20c1F00e",
    explorer: "https://mainnet.lightscan.app",
    rpc: "https://rpc.mainnet.lightchain.ai",
    label: "LightChain mainnet",
  },
};

/** Hyperlane TokenRouter ABI (subset we use). */
export const HYPERLANE_ROUTER_ABI = parseAbi([
  "function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) external payable returns (bytes32 messageId)",
  "function quoteGasPayment(uint32 destination) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
]);

/** Minimal ERC-20 ABI for the LCAI approval step on the Ethereum side. */
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
]);

/** Pad a 20-byte EVM address to a 32-byte (bytes32) Hyperlane recipient. */
export function addressToBytes32(addr: `0x${string}`): `0x${string}` {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error("bridge: recipient must be a 20-byte EVM address");
  return (`0x${"0".repeat(24)}${hex}`) as `0x${string}`;
}

// =============================================================================
// Read-only helpers (no signer required).
// =============================================================================

interface MinimalPublicClient {
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
}

/**
 * Get the Hyperlane gas-payment quote for delivering ONE bridge message
 * from `from` to `to`. Returned in wei of the FROM chain's gas token
 * (ETH on Ethereum, LCAI on LightChain). Add this to the `value` of the
 * `transferRemote` call.
 */
export async function quoteBridgeFee(
  client: MinimalPublicClient,
  from: BridgeChain,
  to: BridgeChain,
): Promise<bigint> {
  if (from === to) throw new Error("bridge: source and destination must differ");
  const src = BRIDGE_ROUTE[from];
  const dst = BRIDGE_ROUTE[to];
  const result = (await client.readContract({
    address: src.router,
    abi: HYPERLANE_ROUTER_ABI,
    functionName: "quoteGasPayment",
    args: [dst.hyperlaneDomain],
  })) as bigint;
  return result;
}

/**
 * Read the underlying token balance of `account` on the FROM side. Returned
 * in raw wei (18 decimals for LCAI on both sides). For Ethereum -> LightChain
 * use `from: "ethereum"` (returns ERC-20 balance). For the reverse use
 * `from: "lightchain-mainnet"` and pass the chain's native-balance reader
 * separately - HypNative does not expose `balanceOf`.
 */
export async function bridgeableBalance(
  client: MinimalPublicClient,
  from: BridgeChain,
  account: `0x${string}`,
): Promise<bigint> {
  const side = BRIDGE_ROUTE[from];
  if (!side.underlying) {
    throw new Error(`bridge: ${from} bridges native LCAI; query getBalance(account) on the RPC directly`);
  }
  return (await client.readContract({
    address: side.underlying,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

/** Read the LCAI ERC-20 allowance the user has approved for the bridge router. */
export async function bridgeAllowance(
  client: MinimalPublicClient,
  account: `0x${string}`,
): Promise<bigint> {
  const eth = BRIDGE_ROUTE.ethereum;
  if (!eth.underlying) throw new Error("bridge: unreachable - Ethereum side has no underlying");
  return (await client.readContract({
    address: eth.underlying,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, eth.router],
  })) as bigint;
}

// =============================================================================
// Write helpers (require a viem WalletClient).
// =============================================================================

interface MinimalWalletClient {
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
}

/**
 * Approve the Ethereum bridge router to spend LCAI on the user's behalf.
 * Required ONCE before the first Ethereum -> LightChain transfer. The
 * standard pattern is to approve `MaxUint256` so subsequent transfers do
 * not need a second approve. Returns the tx hash.
 */
export async function approveBridge(
  wallet: MinimalWalletClient,
  amount: bigint = (1n << 256n) - 1n,
): Promise<`0x${string}`> {
  const eth = BRIDGE_ROUTE.ethereum;
  if (!eth.underlying) throw new Error("bridge: unreachable");
  return wallet.writeContract({
    address: eth.underlying,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [eth.router, amount],
  });
}

export interface BridgeTransferArgs {
  /** Source chain. */
  from: BridgeChain;
  /** Destination chain. */
  to: BridgeChain;
  /** Amount to bridge in raw wei (18 decimals for LCAI on both sides). */
  amount: bigint;
  /** Recipient EVM address on the destination chain. Defaults to the signer's address. */
  recipient: `0x${string}`;
  /**
   * Bridge fee in wei to attach as `msg.value`. Get from `quoteBridgeFee()`.
   * On the LightChain side (HypNative) the SDK adds the `amount` to this so
   * the total `value` passed to transferRemote equals `amount + fee`.
   */
  fee: bigint;
}

/**
 * Build and send the bridge transferRemote call. For Ethereum -> LightChain,
 * `approveBridge()` must have run first. For LightChain -> Ethereum, no
 * approval is needed (native LCAI is attached as value).
 */
export async function bridgeTransfer(
  wallet: MinimalWalletClient,
  args: BridgeTransferArgs,
): Promise<`0x${string}`> {
  if (args.from === args.to) throw new Error("bridge: source and destination must differ");
  const src = BRIDGE_ROUTE[args.from];
  const dst = BRIDGE_ROUTE[args.to];
  // HypNative requires `value = amount + fee`. HypERC20Collateral takes the
  // ERC-20 from the user's allowance and only requires the fee as `value`.
  const value = src.underlying ? args.fee : args.amount + args.fee;
  return wallet.writeContract({
    address: src.router,
    abi: HYPERLANE_ROUTER_ABI,
    functionName: "transferRemote",
    args: [dst.hyperlaneDomain, addressToBytes32(args.recipient), args.amount],
    value,
    gas: 500_000n,
  });
}

// =============================================================================
// LightNode-style facade so consumers can do `new Bridge()` and read fields.
// =============================================================================

/**
 * Convenience wrapper that bundles read + write helpers and exposes the
 * mainnet route addresses as fields. Pass a viem PublicClient for reads
 * and (optionally) a WalletClient for writes.
 */
export class Bridge {
  /** Confirmed mainnet route. Currently the only live bridge. */
  readonly route = BRIDGE_ROUTE;

  constructor(
    private readonly publicClient: MinimalPublicClient,
    private readonly walletClient?: MinimalWalletClient,
  ) {}

  /** See `quoteBridgeFee` standalone. */
  quoteFee(from: BridgeChain, to: BridgeChain): Promise<bigint> {
    return quoteBridgeFee(this.publicClient, from, to);
  }

  /** See `bridgeableBalance` standalone. */
  balance(from: BridgeChain, account: `0x${string}`): Promise<bigint> {
    return bridgeableBalance(this.publicClient, from, account);
  }

  /** See `bridgeAllowance` standalone (Ethereum side only). */
  allowance(account: `0x${string}`): Promise<bigint> {
    return bridgeAllowance(this.publicClient, account);
  }

  /** Approve the Ethereum bridge router. Requires a wallet. */
  approve(amount?: bigint): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("bridge: no wallet client; pass one to the Bridge constructor for writes");
    return approveBridge(this.walletClient, amount);
  }

  /** Send a bridge transfer. Requires a wallet. */
  transfer(args: BridgeTransferArgs): Promise<`0x${string}`> {
    if (!this.walletClient) throw new Error("bridge: no wallet client; pass one to the Bridge constructor for writes");
    return bridgeTransfer(this.walletClient, args);
  }
}
