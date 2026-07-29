"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useState } from "react";
import { wagmiAdapter } from "@/lib/wagmi";
import { NetworkProvider } from "@/lib/network-context";
import { AutoUpdate } from "@/components/auto-update";

// AppKit is NOT created here. This provider wraps every route, so building the
// modal at module scope made each page download and execute the whole wallet
// stack before it could render - 1,395 KB of chunk, 53% of /onboard, on pages
// where nobody had touched a wallet. It is created on the first openWallet()
// call instead; see lib/appkit.ts.
//
// WagmiProvider stays eager: connection state has to survive a reload and be
// readable by any page (useAccount / useChainId), and its config is what the
// lazily-created modal later attaches to.

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <AutoUpdate />
          {children}
        </NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
