/**
 * Live LCAI market data from BitMart's public spot ticker (LCAI is listed as
 * LCAI_USDT). This is the real, liquid reference price for LCAI, so the wallet
 * uses it for the market card and to price native LCAI balances. Public,
 * key-less, open-CORS endpoint; the fetch runs in the background (host permission).
 */

// The pair the token trades under on BitMart.
export const LCAI_MARKET_SYMBOL = "LCAI_USDT";
export const BITMART_TICKER_URL = `https://api-cloud.bitmart.com/spot/quotation/v3/ticker?symbol=${LCAI_MARKET_SYMBOL}`;
// Where a user goes to trade the pair.
export const BITMART_TRADE_URL = "https://www.bitmart.com/en-US/trade/LCAI_USDT?type=spot";

export interface MarketStats {
  symbol: string;
  lastUsd: number; // last trade price in USDT (~USD)
  changePct24h: number; // percent over 24h, e.g. -3.2 or 36.5
  open24h: number;
  high24h: number;
  low24h: number;
  baseVol24h: number; // volume in LCAI
  quoteVol24h: number; // volume in USDT
  bid: number;
  ask: number;
  ts: number; // exchange timestamp (ms)
}

/** Coerce a BitMart string/number field to a finite number, or null. */
function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse the BitMart v3 ticker envelope. `fluctuation` is the 24h change as a
 * ratio (e.g. "0.365" -> +36.5%); when it is absent we derive change from open.
 * Returns null on any shape we cannot trust (never a fabricated zero price).
 */
export function parseBitmartTicker(json: unknown): MarketStats | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const t = data as Record<string, unknown>;
  const last = toNum(t.last);
  if (last === null || last <= 0) return null;
  const open = toNum(t.open_24h);
  const flux = toNum(t.fluctuation);
  const changePct24h = flux !== null ? flux * 100 : open !== null && open > 0 ? ((last - open) / open) * 100 : 0;
  return {
    symbol: typeof t.symbol === "string" ? t.symbol : LCAI_MARKET_SYMBOL,
    lastUsd: last,
    changePct24h,
    open24h: open ?? last,
    high24h: toNum(t.high_24h) ?? last,
    low24h: toNum(t.low_24h) ?? last,
    baseVol24h: toNum(t.v_24h) ?? 0,
    quoteVol24h: toNum(t.qv_24h) ?? 0,
    bid: toNum(t.bid_px) ?? last,
    ask: toNum(t.ask_px) ?? last,
    ts: toNum(t.ts) ?? 0,
  };
}

/** Fetch the live LCAI ticker. Best-effort: any failure returns null. */
export async function fetchMarketStats(): Promise<MarketStats | null> {
  try {
    const res = await fetch(BITMART_TICKER_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return parseBitmartTicker(await res.json());
  } catch {
    return null;
  }
}
