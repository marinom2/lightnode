"use client";

import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useState } from "react";
import { wagmiAdapter, projectId, networks } from "@/lib/wagmi";
import { NetworkProvider } from "@/lib/network-context";

// AppKit is created once at module scope (matches LightChain's own chat setup).
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: networks[0],
  metadata: {
    name: "LightNode",
    description: "One-flow onboarding for LightChain AI workers.",
    url: "https://lightnode.app",
    icons: ["https://lightnode.app/icon.svg"],
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#7064e9",
    "--w3m-color-mix": "#7064e9",
    "--w3m-color-mix-strength": 12,
    "--w3m-font-family": "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
    "--w3m-border-radius-master": "2.5px",
  },
  features: { analytics: false, email: true, socials: ["google", "x", "github", "discord"] },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>{children}</NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
