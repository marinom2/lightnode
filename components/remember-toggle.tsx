"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getRemember, setWalletRemembered } from "@/lib/wallet-storage";
import { cn } from "@/lib/utils";

/** "Remember this device" — shown only when a wallet is connected. */
export function RememberToggle({ className }: { className?: string }) {
  const { isConnected } = useAccount();
  const [on, setOn] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setOn(getRemember());
  }, []);

  if (!mounted || !isConnected) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    setWalletRemembered(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Remember this device for wallet reconnect"
      onClick={toggle}
      className={cn("group inline-flex items-center gap-2 text-xs text-content-soft", className)}
      title={on ? "Wallet persists across restarts" : "Wallet clears when the tab closes"}
    >
      <span
        className={cn(
          "relative h-4 w-7 rounded-full border transition-colors",
          on ? "border-primary/40 bg-primary/30" : "border-bdr-soft bg-surface-base-faint",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-content-soft transition-all",
            on ? "left-3.5 bg-primary" : "left-0.5",
          )}
        />
      </span>
      <span className="hidden lg:inline">Remember device</span>
    </button>
  );
}
