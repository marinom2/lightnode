"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { useMemo, useState } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { NetworkProvider } from "@/lib/network-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  // Dark RainbowKit theme tuned to LightNode's indigo/purple palette.
  const rkTheme = useMemo(() => {
    const base = darkTheme({ borderRadius: "large", overlayBlur: "small" });
    return {
      ...base,
      colors: {
        ...base.colors,
        accentColor: "#7064e9",
        accentColorForeground: "#ffffff",
        modalBackground: "#0f0f14",
        modalBorder: "rgba(204,206,239,0.12)",
        connectButtonBackground: "#0f0f14",
        profileForeground: "#0f0f14",
      },
      radii: { ...base.radii, modal: "20px", menuButton: "12px" },
      fonts: { body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" },
    };
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rkTheme} modalSize="compact">
          <NetworkProvider>{children}</NetworkProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
