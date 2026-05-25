"use client";

import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";
import { compact, fmt } from "@/lib/utils";

/** The active network's minimum worker stake, rendered inline. Reacts to the
 * mainnet/testnet toggle. `compact` → "50K", `full` → "50,000". */
export function StakeAmount({ format = "full" }: { format?: "full" | "compact" }) {
  const { network } = useNetwork();
  const stake = NETWORKS[network].minStakeLcai;
  return <>{format === "compact" ? compact(stake) : fmt(stake, 0)}</>;
}
