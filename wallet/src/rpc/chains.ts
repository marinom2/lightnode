import { defineChain } from "viem";

// LightChain mainnet eth_chainId verified live = 0x23f0 (9200). Native gas token LCAI.
export const lightchainMainnet = defineChain({
  id: 9200,
  name: "LightChain",
  nativeCurrency: { name: "LightChain AI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.lightchain.ai"] } },
  blockExplorers: { default: { name: "LightScan", url: "https://mainnet.lightscan.app" } },
  testnet: false,
});

export const lightchainTestnet = defineChain({
  id: 8200,
  name: "LightChain Testnet",
  nativeCurrency: { name: "LightChain AI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } },
  blockExplorers: { default: { name: "LightScan", url: "https://testnet.lightscan.app" } },
  testnet: true,
});

export type LightChainId = 9200 | 8200;

// Code-pinned RPC allowlist: we NEVER honor a dapp-supplied RPC url (review H4).
export const SUPPORTED_CHAINS = { 9200: lightchainMainnet, 8200: lightchainTestnet } as const;

export function chainById(id: number) {
  return id === 8200 ? lightchainTestnet : lightchainMainnet;
}
