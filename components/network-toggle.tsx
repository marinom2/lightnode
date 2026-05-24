"use client";

import { useSwitchChain } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";
import { cn } from "@/lib/utils";

/** Switches the data network (subgraph/scripts) and, if a wallet is connected, the chain. */
export function NetworkToggle() {
  const { network, setNetwork } = useNetwork();
  const { switchChain } = useSwitchChain();

  const pick = (id: "mainnet" | "testnet") => {
    setNetwork(id);
    try {
      switchChain?.({ chainId: NETWORKS[id].chainId });
    } catch {
      /* wallet not connected / user declined - data network still switches */
    }
  };

  return (
    <div className="inline-flex items-center rounded-full border border-bdr-soft bg-surface-base-subtle p-0.5 text-xs font-medium">
      {(["mainnet", "testnet"] as const).map((id) => (
        <button
          key={id}
          onClick={() => pick(id)}
          aria-pressed={network === id}
          aria-label={`Switch to ${NETWORKS[id].label}`}
          className={cn(
            "rounded-full px-2.5 py-1 transition-all",
            network === id
              ? "bg-gradient-primary text-white shadow-[0_2px_10px_-2px_rgba(112,100,233,0.6)]"
              : "text-content-soft hover:text-content-primary",
          )}
        >
          {NETWORKS[id].label}
        </button>
      ))}
    </div>
  );
}
