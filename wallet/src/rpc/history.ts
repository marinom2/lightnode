/**
 * Full account history (sent AND received, native + tokens + NFTs) via the
 * public Blockscout v2 API each supported chain exposes (LightScan IS
 * Blockscout). No API keys; responses are open-CORS. Treated as untrusted
 * input: parsed defensively, validated, clamped, and merged with the local
 * send log so just-broadcast transactions show up before the explorer
 * indexes them.
 */

export const BLOCKSCOUT: Record<number, string> = {
  9200: "https://mainnet.lightscan.app",
  8200: "https://testnet.lightscan.app",
  1: "https://eth.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  10: "https://optimism.blockscout.com",
  137: "https://polygon.blockscout.com",
};

export interface HistoryItem {
  hash: string;
  direction: "in" | "out" | "self";
  kind: "native" | "token" | "nft" | "contract";
  label: string; // asset symbol, NFT name, or the decoded contract method
  amount: string; // formatted, "" for NFTs and contract calls
  counterparty: string;
  ts: number; // ms epoch
  failed: boolean;
  pending?: boolean; // local broadcast not yet seen by the explorer
  logIndex?: number; // discriminates multiple transfers inside one tx
}

const HISTORY_CAP = 50;
// Inbound native below this displays as "+0" and only serves dust-poisoning.
const NATIVE_DUST_WEI = 1000000000000n; // 1e12 = 0.000001 of an 18-decimals coin
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isTxHash = (s: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(s);
const isAddress = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s);

/** Strip bidi/control characters (spoofing vector) and clamp length. */
const clampLabel = (s: string): string => {
  const clean = s.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0000-\u001F\u007F]/g, "");
  return clean.length > 24 ? `${clean.slice(0, 21)}\u2026` : clean;
};

// One malformed item from the explorer must never take down the whole list.
const safeBigInt = (s: string): bigint | null => {
  try {
    return BigInt(s);
  } catch {
    return null;
  }
};

/** Blockscout timestamps are UTC; without an explicit offset Date.parse assumes local. */
const parseUtc = (s: string): number => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

function direction(from: string, to: string, me: string): "in" | "out" | "self" {
  const f = from.toLowerCase() === me.toLowerCase();
  const t = to.toLowerCase() === me.toLowerCase();
  if (f && t) return "self";
  return f ? "out" : "in";
}

interface BsTx {
  hash?: unknown;
  from?: { hash?: unknown };
  to?: { hash?: unknown } | null;
  value?: unknown;
  timestamp?: unknown;
  status?: unknown;
  method?: unknown;
}

/** Native transfers + the account's own contract calls from /addresses/{a}/transactions. */
export function parseNativeTxs(json: unknown, me: string, symbol: string): HistoryItem[] {
  const items = ((json ?? {}) as { items?: BsTx[] }).items;
  if (!Array.isArray(items)) return [];
  const out: HistoryItem[] = [];
  for (const it of items) {
    const hash = str(it?.hash);
    const from = str(it?.from?.hash);
    const to = str(it?.to?.hash);
    const ts = parseUtc(str(it?.timestamp));
    if (!isTxHash(hash) || !isAddress(from) || Number.isNaN(ts)) continue;
    const wei = safeBigInt(str(it?.value) || "0");
    if (wei === null) continue;
    const sentByMe = from.toLowerCase() === me.toLowerCase();
    // Inbound zero-value and dust transfers are poisoning spam, not activity.
    if (!sentByMe && wei < NATIVE_DUST_WEI) continue;
    const failed = it?.status != null && it.status !== "ok";
    if (wei === 0n) {
      const method = str(it?.method);
      out.push({ hash, direction: "out", kind: "contract", label: method ? clampLabel(`Contract: ${method}`) : "Contract call", amount: "", counterparty: isAddress(to) ? to : "", ts, failed });
      continue;
    }
    const amount = Number(wei) / 1e18;
    if (!Number.isFinite(amount)) continue;
    const counterparty = sentByMe ? to : from;
    out.push({ hash, direction: direction(from, to, me), kind: "native", label: symbol, amount: amount.toString(), counterparty: isAddress(counterparty) ? counterparty : "", ts, failed });
  }
  return out;
}

interface BsTransfer {
  transaction_hash?: unknown;
  from?: { hash?: unknown };
  to?: { hash?: unknown } | null;
  timestamp?: unknown;
  token?: { symbol?: unknown; name?: unknown; type?: unknown };
  total?: { value?: unknown; decimals?: unknown; token_id?: unknown };
  log_index?: unknown;
}

/** ERC-20 / ERC-721 / ERC-1155 movements from /addresses/{a}/token-transfers. */
export function parseTokenTransfers(json: unknown, me: string): HistoryItem[] {
  const items = ((json ?? {}) as { items?: BsTransfer[] }).items;
  if (!Array.isArray(items)) return [];
  const out: HistoryItem[] = [];
  for (const it of items) {
    const hash = str(it?.transaction_hash);
    const from = str(it?.from?.hash);
    const to = str(it?.to?.hash);
    const ts = parseUtc(str(it?.timestamp));
    if (!isTxHash(hash) || !isAddress(from) || Number.isNaN(ts)) continue;
    const dir = direction(from, to, me);
    const rawCounterparty = dir === "in" ? from : to;
    const counterparty = isAddress(rawCounterparty) ? rawCounterparty : "";
    const type = str(it?.token?.type);
    const symbol = clampLabel(str(it?.token?.symbol) || str(it?.token?.name) || "?");
    const logIndex = typeof it?.log_index === "number" ? it.log_index : Number(str(it?.log_index)) || undefined;
    if (type === "ERC-721" || type === "ERC-1155") {
      const id = str(it?.total?.token_id);
      out.push({ hash, direction: dir, kind: "nft", label: clampLabel(`${symbol}${id ? ` #${id}` : ""}`), amount: "", counterparty, ts, failed: false, logIndex });
      continue;
    }
    const parsedDecimals = Number(str(it?.total?.decimals));
    const decimals = Number.isFinite(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 77 ? parsedDecimals : 18;
    const raw = safeBigInt(str(it?.total?.value));
    // Zero-value "transferFrom(victim, lookalike, 0)" is the classic poisoning
    // trick: it would render as a send the user never made. Drop both directions.
    if (raw === null || raw === 0n) continue;
    const amount = Number(raw) / 10 ** decimals;
    if (!Number.isFinite(amount)) continue;
    out.push({ hash, direction: dir, kind: "token", label: symbol, amount: amount.toString(), counterparty, ts, failed: false, logIndex });
  }
  return out;
}

const itemKey = (h: HistoryItem): string =>
  h.logIndex != null ? `${h.hash}-${h.logIndex}` : `${h.hash}-${h.kind}-${h.direction}-${h.label}-${h.amount}`;

/** Merge + sort newest first, dedupe per transfer event, cap. */
export function mergeHistory(...lists: HistoryItem[][]): HistoryItem[] {
  const all = lists.flat();
  // A token/NFT send also appears as a 0-value "contract call" in the tx list;
  // showing both makes every send look like two transactions.
  const assetHashes = new Set(all.filter((h) => h.kind !== "contract").map((h) => h.hash.toLowerCase()));
  const seen = new Set<string>();
  const out: HistoryItem[] = [];
  for (const h of all.sort((a, b) => b.ts - a.ts)) {
    if (h.kind === "contract" && assetHashes.has(h.hash.toLowerCase())) continue;
    const key = itemKey(h);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= HISTORY_CAP) break;
  }
  return out;
}

const FETCH_TIMEOUT_MS = 10000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  return res.json();
}

export interface HistoryFetch {
  items: HistoryItem[];
  complete: boolean; // both endpoints answered; safe to overwrite the cache
}

/** Best-effort: either endpoint may fail independently; we show what we have. */
export async function fetchHistory(chainId: number, address: string, nativeSymbol: string): Promise<HistoryFetch | null> {
  const base = BLOCKSCOUT[chainId];
  if (!base) return null;
  const [txs, transfers] = await Promise.allSettled([
    getJson(`${base}/api/v2/addresses/${address}/transactions`),
    getJson(`${base}/api/v2/addresses/${address}/token-transfers`),
  ]);
  if (txs.status === "rejected" && transfers.status === "rejected") return null;
  const items = mergeHistory(
    txs.status === "fulfilled" ? parseNativeTxs(txs.value, address, nativeSymbol) : [],
    transfers.status === "fulfilled" ? parseTokenTransfers(transfers.value, address) : [],
  );
  return { items, complete: txs.status === "fulfilled" && transfers.status === "fulfilled" };
}
