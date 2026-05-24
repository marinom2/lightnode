"use client";

import { ConnectButton as RKConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet, AlertTriangle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** RainbowKit connect flow rendered with LightNode's own button styling. */
export function ConnectButton({ size = "default" }: { size?: ButtonProps["size"] }) {
  return (
    <RKConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div
            {...(!ready && { "aria-hidden": true, style: { opacity: 0, pointerEvents: "none", userSelect: "none" } })}
          >
            {(() => {
              if (!connected) {
                return (
                  <Button variant="gradient" size={size} onClick={openConnectModal}>
                    <Wallet /> Connect wallet
                  </Button>
                );
              }
              if (chain.unsupported) {
                return (
                  <Button variant="destructive" size={size} onClick={openChainModal}>
                    <AlertTriangle /> Wrong network
                  </Button>
                );
              }
              return (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size={size} onClick={openChainModal} className="hidden sm:inline-flex">
                    {chain.hasIcon && chain.iconUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={chain.iconUrl} alt={chain.name ?? ""} className="size-4 rounded-full" />
                    )}
                    {chain.name?.replace("LightChain AI", "LCAI") ?? "Network"}
                  </Button>
                  <Button variant="outline" size={size} onClick={openAccountModal}>
                    <span className="font-mono">{account.displayName}</span>
                  </Button>
                </div>
              );
            })()}
          </div>
        );
      }}
    </RKConnectButton.Custom>
  );
}
