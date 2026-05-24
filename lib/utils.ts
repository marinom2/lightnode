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
