"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Wallet, LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { shortAddr } from "@/lib/utils";

export function ConnectButton({ size = "default" }: { size?: ButtonProps["size"] }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <Button variant="outline" size={size} onClick={() => disconnect()}>
        <span className="font-mono">{shortAddr(address)}</span>
        <LogOut className="opacity-60" />
      </Button>
    );
  }

  const injected = connectors[0];
  return (
    <Button
      variant="gradient"
      size={size}
      disabled={isPending || !injected}
      onClick={() => injected && connect({ connector: injected })}
    >
      <Wallet />
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
