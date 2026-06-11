/**
 * USD pricing via the CoinGecko public API. Pure mapping tables here; the actual
 * fetch runs in the background (it needs the api.coingecko.com host permission).
 * Prices are best-effort - if a coin/chain isn't listed, the UI just omits USD.
 */

// CoinGecko coin id for each chain's NATIVE gas token. Ethereum, Base, Arbitrum,
// and Optimism all use ETH. LightChain's LCAI is not listed (null -> no USD).
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
  tokenUsd: Record<string, number>; // keyed by lowercase contract address
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
