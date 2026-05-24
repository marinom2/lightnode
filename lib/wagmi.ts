import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  walletConnectWallet,
  metaMaskWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { NETWORKS } from "./network";
import { walletStorage } from "./wallet-storage";

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

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

// connectorsForWallets gives browsers without an extension (Safari, mobile) the
// WalletConnect QR modal automatically — same setup as the LightChallenge app.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, walletConnectWallet, coinbaseWallet, injectedWallet],
    },
  ],
  { appName: "LightNode", projectId },
);

export const wagmiConfig = createConfig({
  chains: [lightchainMainnet, lightchainTestnet],
  connectors,
  transports: {
    [lightchainMainnet.id]: http(NETWORKS.mainnet.rpc),
    [lightchainTestnet.id]: http(NETWORKS.testnet.rpc),
  },
  storage: walletStorage,
  ssr: true,
});
