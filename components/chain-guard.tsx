"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { AlertTriangle, X } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";

/**
 * Keeps the connected wallet on the selected LightChain network. wagmi's
 * `switchChain` automatically falls back to `wallet_addEthereumChain` when the
 * wallet (e.g. MetaMask) doesn't have the chain yet — so users never have to
 * add LightChain mainnet/testnet manually. Auto-attempts once per mismatch;
 * shows a one-tap banner if the user dismissed or it failed.
 */
export function ChainGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const { network } = useNetwork();
  const target = NETWORKS[network].chainId;

  const [dismissed, setDismissed] = useState(false);
  const attempted = useRef<number | null>(null);

  const mismatch = isConnected && chainId !== target;

  // Auto-attempt the add/switch once per (target) mismatch.
  useEffect(() => {
    if (!mismatch) {
      attempted.current = null;
      setDismissed(false);
      return;
    }
    if (attempted.current === target) return;
    attempted.current = target;
    try {
      switchChain?.({ chainId: target });
    } catch {
      /* user can retry via the banner */
    }
  }, [mismatch, target, switchChain]);

  if (!mismatch || dismissed) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2.5 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-warning" />
        <span className="flex-1 text-content-default">
          Your wallet isn&apos;t on <span className="font-medium text-content-primary">LightChain {NETWORKS[network].label}</span>.
          We&apos;ll add &amp; switch it for you.
        </span>
        <button
          onClick={() => switchChain?.({ chainId: target })}
          disabled={isPending}
          className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-600 disabled:opacity-60"
        >
          {isPending ? "Confirm in wallet…" : `Add ${NETWORKS[network].label}`}
        </button>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-content-soft hover:text-content-primary">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
