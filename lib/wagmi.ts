import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  walletConnectWallet,
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

// Wallet list. We intentionally omit RainbowKit's `metaMaskWallet` because it
// pulls @metamask/sdk, whose QR renderer crashes ("Bitmap.border: invalid
// size=0") in environments without the extension — notably the Tauri desktop
// webview. `injectedWallet` still connects to the MetaMask *extension* on the
// web (no SDK, no QR), and `walletConnectWallet` covers everything else with
// RainbowKit's own (working) QR modal.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet, walletConnectWallet, coinbaseWallet],
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
