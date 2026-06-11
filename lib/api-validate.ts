/**
 * Shared validation helpers for API route inputs. Query params arrive as raw
 * strings, so each helper narrows to the expected union and returns null on
 * anything unexpected, letting the route answer 400 instead of crashing
 * somewhere deeper in the stack.
 */
import type { NetworkId } from "@/lib/network";

/**
 * Parse the ?net= query param. Absent or empty falls back to "mainnet" (the
 * long-standing default); anything other than "mainnet"/"testnet" returns
 * null so the route can reject it with a 400.
 */
export function parseNet(value: string | null): NetworkId | null {
  if (!value) return "mainnet";
  if (value === "mainnet" || value === "testnet") return value;
  return null;
}
