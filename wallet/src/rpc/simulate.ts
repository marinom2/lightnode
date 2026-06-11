/**
 * Parse an eth_simulateV1 result (with traceTransfers) into the net balance
 * change for the signer - the "what you send / what you receive" preview Rabby
 * pioneered. Pure log math; the background does the RPC call + token lookups.
 *
 * With traceTransfers, native-coin moves are emitted as ERC-20 Transfer logs by
 * a sentinel "token" 0xee…ee, so native and ERC-20 are parsed the same way.
 */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface SimLog {
  address: string;
  topics: string[];
  data: string;
}
export interface Transfer {
  token: string;
  from: string;
  to: string;
  value: bigint;
}

const topicAddr = (t: string): string => `0x${t.slice(-40)}`.toLowerCase();

export function parseTransfers(logs: SimLog[]): Transfer[] {
  const out: Transfer[] = [];
  for (const log of logs ?? []) {
    if (!log.topics || log.topics.length < 3 || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    let value = 0n;
    try {
      value = BigInt(log.data && log.data !== "0x" ? log.data : "0x0");
    } catch {
      continue;
    }
    out.push({ token: log.address.toLowerCase(), from: topicAddr(log.topics[1]!), to: topicAddr(log.topics[2]!), value });
  }
  return out;
}

/** Net change per token for `user`: positive = received, negative = sent. Zeros dropped. */
export function netChanges(transfers: Transfer[], user: string): Map<string, bigint> {
  const u = user.toLowerCase();
  const m = new Map<string, bigint>();
  for (const t of transfers) {
    if (t.from === u) m.set(t.token, (m.get(t.token) ?? 0n) - t.value);
    if (t.to === u) m.set(t.token, (m.get(t.token) ?? 0n) + t.value);
  }
  for (const [k, v] of m) if (v === 0n) m.delete(k);
  return m;
}
