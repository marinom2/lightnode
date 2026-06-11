/**
 * ERC-20 token support: balances, add-by-address, and transfer encoding. Inlined
 * with viem (no extra deps). A few well-known stablecoins ship per chain so the
 * token list is useful out of the box; users can add any token by address.
 */
import { type PublicClient, parseAbi, getAddress, formatUnits, parseUnits, encodeFunctionData } from "viem";
import { BLOCKSCOUT } from "./history";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)",
]);

export interface TokenMeta {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}
export interface TokenBalance extends TokenMeta {
  balance: string; // human-formatted
  discovered?: boolean; // surfaced by the indexer, not added by the user
}

// Canonical USDC per chain (verified addresses). LightChain's value token is native LCAI.
export const DEFAULT_TOKENS: Record<number, TokenMeta[]> = {
  1: [{ address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 }],
  8453: [{ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 }],
  42161: [{ address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", decimals: 6 }],
  10: [{ address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", symbol: "USDC", decimals: 6 }],
  137: [{ address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", decimals: 6 }],
};

export async function readTokenBalances(client: PublicClient, owner: `0x${string}`, tokens: TokenMeta[]): Promise<TokenBalance[]> {
  return Promise.all(
    tokens.map(async (t) => {
      const raw = (await client
        .readContract({ address: t.address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] })
        .catch(() => 0n)) as bigint;
      return { ...t, balance: formatUnits(raw, t.decimals) };
    }),
  );
}

/** Read a token's symbol + decimals so the user can add it by address. */
export async function fetchTokenMeta(client: PublicClient, address: string): Promise<TokenMeta> {
  const addr = getAddress(address);
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }),
    client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { address: addr, symbol: String(symbol), decimals: Number(decimals) };
}

/** calldata for transfer(to, amount) - the wallet signs this with value 0 to the token. */
export function erc20TransferData(to: string, amount: string, decimals: number): `0x${string}` {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [getAddress(to), parseUnits(amount, decimals)] });
}

// ---- automatic discovery via Blockscout --------------------------------------

const DISCOVER_CAP = 30;
const DISCOVER_TIMEOUT_MS = 10000;
export const stripControls = (s: string): string => s.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u001F\u007F]/g, "").slice(0, 12);

interface BsTokenBalance {
  token?: { address?: unknown; address_hash?: unknown; symbol?: unknown; decimals?: unknown; type?: unknown };
  value?: unknown;
}

/** Defensive parse: the indexer list is untrusted spam-adjacent input. */
export function parseTokenBalances(json: unknown): TokenMeta[] {
  if (!Array.isArray(json)) return [];
  const out: TokenMeta[] = [];
  for (const it of json as BsTokenBalance[]) {
    const t = it?.token;
    const addr = typeof t?.address_hash === "string" ? t.address_hash : typeof t?.address === "string" ? t.address : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || t?.type !== "ERC-20") continue;
    const decimals = Number(typeof t?.decimals === "string" ? t.decimals : t?.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) continue;
    const value = typeof it?.value === "string" ? it.value : "0";
    if (!/^[0-9]+$/.test(value) || value === "0") continue; // zero-balance spam
    const symbol = stripControls(typeof t?.symbol === "string" ? t.symbol : "") || "?";
    out.push({ address: addr as `0x${string}`, symbol, decimals });
    if (out.length >= DISCOVER_CAP) break;
  }
  return out;
}

/** Tokens the account holds per the chain's Blockscout (balances re-read on-chain). */
export async function discoverTokens(chainId: number, owner: string): Promise<TokenMeta[]> {
  const base = BLOCKSCOUT[chainId];
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/v2/addresses/${owner}/token-balances`, { signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS) });
    if (!res.ok) return [];
    return parseTokenBalances(await res.json());
  } catch {
    return []; // discovery is additive; tracked tokens still render
  }
}
