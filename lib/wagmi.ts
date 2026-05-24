import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";
import { NETWORKS } from "./network";

export const lightchainMainnet = defineChain({
  id: NETWORKS.mainnet.chainId,
  name: "LightChain AI",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.mainnet.rpc] } },
  blockExplorers: { default: { name: "LightScan", url: NETWORKS.mainnet.explorer } },
});

export const lightchainTestnet = defineChain({
  id: NETWORKS.testnet.chainId,
  name: "LightChain AI Testnet",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: [NETWORKS.testnet.rpc] } },
  blockExplorers: { default: { name: "LightScan", url: NETWORKS.testnet.explorer } },
});

export const wagmiConfig = createConfig({
  chains: [lightchainMainnet, lightchainTestnet],
  connectors: [injected()],
  transports: {
    [lightchainMainnet.id]: http(),
    [lightchainTestnet.id]: http(),
  },
  ssr: true,
});
