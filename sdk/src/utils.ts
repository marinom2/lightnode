/**
 * Small, dependency-light utility helpers that builders kept re-implementing:
 * unit conversions, address checks, and a bounded-concurrency map. Pure - no I/O.
 */
import { getAddress, isAddress } from "viem";

export { fromWei } from "./subgraph.js";

/**
 * Whole LCAI -> wei (18 decimals), exact for typical amounts. Parses via string
 * so 0.001 LCAI yields exactly 1e15 wei (no float drift). Non-finite -> 0n.
 */
export function toWei(lcai: number): bigint {
  if (!Number.isFinite(lcai)) return 0n;
  const neg = lcai < 0;
  // Split integer + fraction so it works across the whole float range. String
  // formatting can't be trusted (Number.toString and toFixed both emit "1e+21"
  // for big values, which BigInt rejects). BigInt(integerFloat) handles any
  // integer-valued float (all floats >= 2^53 are integers), and the fraction is
  // always < 1 so scaling it to 18 dp stays well within Number range.
  const abs = Math.abs(lcai);
  const intPart = Math.floor(abs);
  const wei = BigInt(intPart) * 10n ** 18n + BigInt(Math.round((abs - intPart) * 1e18));
  return neg ? -wei : wei;
}

/** Checksum an address; returns the input unchanged if it isn't a valid address. */
export function checksum(address: string): string {
  try {
    return getAddress(address as `0x${string}`);
  } catch {
    return address;
  }
}

/** True for a syntactically valid 0x-prefixed 20-byte address. */
export function isValidAddress(address: string): boolean {
  return typeof address === "string" && isAddress(address as `0x${string}`);
}

/** "0x1234…abcd" - the standard short form for logs and UIs. */
export function truncateAddress(address: string, chars = 4): string {
  const c = Math.max(1, Math.floor(chars)); // slice(-0) returns the whole string
  if (!address || address.length < 2 + c * 2) return address;
  return `${address.slice(0, 2 + c)}…${address.slice(-c)}`;
}

/**
 * Map over items with a bounded number of in-flight promises, preserving input
 * order in the result. The basis for the batch read methods - lets a caller fetch
 * many workers/jobs without hammering the RPC/indexer with N simultaneous calls.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  const run = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: lanes }, run));
  return out;
}
