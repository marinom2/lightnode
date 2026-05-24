"use client";

import { useAppKit, useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import { Wallet, AlertTriangle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { NETWORKS } from "@/lib/network";
import { shortAddr } from "@/lib/utils";

const SUPPORTED = new Set<number>([NETWORKS.mainnet.chainId, NETWORKS.testnet.chainId]);

/** Reown AppKit connect flow rendered with LightNode's own button styling. */
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
    <Button variant="outline" size={size} onClick={() => open({ view: "Account" })}>
      <span className="font-mono">{shortAddr(address)}</span>
    </Button>
  );
}
