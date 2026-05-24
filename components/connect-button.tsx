"use client";

import { useAppKit, useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import { Wallet, AlertTriangle, ChevronDown } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { NETWORKS } from "@/lib/network";
import { shortAddr } from "@/lib/utils";

const SUPPORTED = new Set<number>([NETWORKS.mainnet.chainId, NETWORKS.testnet.chainId]);

/** Deterministic gradient for the wallet avatar, derived from the address. */
function avatarGradient(addr: string): string {
  let h = 0;
  for (let i = 2; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 60) % 360} 80% 55%))`;
}

/** Reown AppKit connect flow rendered with LightNode's own styling. */
export function ConnectButton({ size = "default" }: { size?: ButtonProps["size"] }) {
  const { open } = useAppKit();
  const { isConnected, address } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();

  if (!isConnected) {
    return (
      <Button variant="gradient" size={size} onClick={() => open()}>
        <Wallet /> Connect wallet
      </Button>
    );
  }

  if (chainId !== undefined && !SUPPORTED.has(Number(chainId))) {
    return (
      <Button variant="destructive" size={size} onClick={() => open({ view: "Networks" })}>
        <AlertTriangle /> Wrong network
      </Button>
    );
  }

  return (
    <button
      onClick={() => open({ view: "Account" })}
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
