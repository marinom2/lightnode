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

// Ethereum mainnet - needed so the wallet can sign the inbound (ETH -> LightChain)
// bridge leg, where LCAI is an ERC-20. Not shown in the app's network toggle
// (that stays LightChain mainnet/testnet); it just lets the bridge switch chains.
export const ethereumMainnet: AppKitNetwork = {
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum-rpc.publicnode.com"] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
};

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [lightchainMainnet, lightchainTestnet, ethereumMainnet];

export const wagmiAdapter = new WagmiAdapter({
  ssr: true,
  projectId,
  networks,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
