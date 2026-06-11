/**
 * USD pricing via the CoinGecko public API. Pure mapping tables here; the actual
 * fetch runs in the background (it needs the api.coingecko.com host permission).
 * Prices are best-effort - if a coin/chain isn't listed, the UI just omits USD.
 */

// LCAI's canonical Ethereum ERC-20: CoinGecko quotes it by contract address,
// which is how the LightChain NATIVE balance gets a USD value too.
export const LCAI_PRICE_CONTRACT = "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927";

// CoinGecko coin id for each chain's NATIVE gas token. Ethereum, Base, Arbitrum,
// and Optimism all use ETH. LightChain's LCAI is priced via its Ethereum
// ERC-20 contract instead (see LCAI_PRICE_CONTRACT).
export const CG_NATIVE: Record<number, string | null> = {
  1: "ethereum",
  8453: "ethereum",
  42161: "ethereum",
  10: "ethereum",
  137: "polygon-ecosystem-token",
  9200: null,
  8200: null,
};

// CoinGecko "asset platform" id for ERC-20 token lookups by contract address.
export const CG_PLATFORM: Record<number, string | null> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum-one",
  10: "optimistic-ethereum",
  137: "polygon-pos",
  9200: null,
  8200: null,
};

export interface Prices {
  nativeUsd: number | null;
  nativeChange24h: number | null; // percent over 24h, e.g. -3.42
  tokenUsd: Record<string, number>; // keyed by lowercase contract address
  tokenChange24h: Record<string, number>;
}

/** Total USD value of a native balance + a set of token balances. */
export function portfolioUsd(nativeBalance: number, prices: Prices, tokens: { address: string; balance: number }[]): number {
  let total = (prices.nativeUsd ?? 0) * nativeBalance;
  for (const t of tokens) total += (prices.tokenUsd[t.address.toLowerCase()] ?? 0) * t.balance;
  return total;
}

export function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
