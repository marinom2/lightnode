"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { openWallet, prefetchWallet } from "@/lib/appkit";
import { Wallet, AlertTriangle, ChevronDown, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { NETWORKS } from "@/lib/network";
import { useNetwork } from "@/lib/network-context";
import { shortAddr } from "@/lib/utils";

// Ethereum (1) is registered in lib/wagmi.ts on purpose: the bridge signs its
// inbound ETH -> LightChain leg there. Treating it as "wrong network" would
// fight the bridge flow with a destructive switch prompt mid-transfer.
const SUPPORTED = new Set<number>([NETWORKS.mainnet.chainId, NETWORKS.testnet.chainId, 1]);

/** Deterministic gradient for the wallet avatar, derived from the address. */
function avatarGradient(addr: string): string {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 60) % 360} 80% 55%))`;
}

/** Reown AppKit connect flow rendered with LightNode's own styling. */
export function ConnectButton({ size = "default" }: { size?: ButtonProps["size"] }) {
  // Read state from wagmi, not AppKit. These hooks come from the eager bundle
  // (WagmiProvider already wraps the tree), so this button renders - and shows
  // a reconnected address after a reload - without pulling in the wallet modal.
  // Using AppKit's equivalents here would force every page to load it again.
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const { network } = useNetwork();

  if (!isConnected) {
    return (
      // Hover starts the chunk download, so the modal is usually ready by the
      // time the click lands.
      <Button variant="gradient" size={size} onMouseEnter={prefetchWallet} onClick={() => openWallet()}>
        <Wallet /> Connect wallet
      </Button>
    );
  }

  if (chainId !== undefined && !SUPPORTED.has(Number(chainId))) {
    const target = NETWORKS[network];
    return (
      <Button
        variant="destructive"
        size={size}
        disabled={isPending}
        onClick={() => switchChain({ chainId: target.chainId })}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <AlertTriangle />}
        {isPending ? "Switching…" : `Switch to ${target.label}`}
      </Button>
    );
  }

  return (
    <button
      onClick={() => openWallet({ view: "Account" })}
      className="group inline-flex items-center gap-2 rounded-full border border-bdr-soft bg-surface-base-subtle py-1 pl-1 pr-2.5 transition-colors hover:border-primary/40 hover:bg-surface-base-faint"
    >
      <span
        className="size-6 rounded-full ring-1 ring-white/20"
        style={{ backgroundImage: avatarGradient(address ?? "0x") }}
      />
      <span className="font-mono text-sm text-content-primary">{shortAddr(address)}</span>
      <ChevronDown className="size-3.5 text-content-soft transition-transform group-hover:translate-y-0.5" />
    </button>
  );
}
