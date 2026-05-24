import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { NETWORKS } from "./network";

export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// LightChain networks (same shape LightChain's own chat uses for AppKit).
export const lightchainMainnet: AppKitNetwork = {
  id: NETWORKS.mainnet.chainId,
  name: "LightchainAI",
  nativeCurrency: { name: "LightchainAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.mainnet.rpc] } },
  blockExplorers: { default: { name: "LightScan", url: NETWORKS.mainnet.explorer } },
};

export const lightchainTestnet: AppKitNetwork = {
  id: NETWORKS.testnet.chainId,
  name: "LightchainAI Testnet",
  nativeCurrency: { name: "LightchainAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.testnet.rpc] } },
  blockExplorers: { default: { name: "LightScan", url: NETWORKS.testnet.explorer } },
};

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [lightchainMainnet, lightchainTestnet];

export const wagmiAdapter = new WagmiAdapter({
  ssr: true,
  projectId,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
