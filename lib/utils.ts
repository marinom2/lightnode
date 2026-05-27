import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** wei (string/bigint) → LCAI number */
export function fromWei(wei?: string | bigint | null): number {
  if (wei == null) return 0;
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

/**
 * True only when the on-chain stake is STRICTLY below the LCAI floor. Compared in
 * wei (BigInt) on purpose: `Number(BigInt("50000...000")) / 1e18` is
 * `49999.99999999999` from float rounding, so a naive `stake < min` falsely flags
 * an exactly-at-floor worker as slashed. This compares exact integers instead.
 */
export function stakeBelowFloor(stakeWei?: string | bigint | null, minLcai?: number): boolean {
  if (stakeWei == null || minLcai == null) return false;
  try {
    return BigInt(stakeWei) < BigInt(minLcai) * 10n ** 18n;
  } catch {
    return false;
  }
}

export function compact(n?: number): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, notation: "compact" });
}

export function fmt(n?: number, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function timeAgo(unixSeconds?: number): string {
  if (!unixSeconds) return "never";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
