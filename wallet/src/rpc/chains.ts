import { defineChain, type Chain } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";

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

// Code-pinned RPC per chain: we NEVER honor a dapp-supplied RPC url (review H4).
// For the well-known EVM chains we reuse viem's metadata (name, symbol, explorer)
// but override the RPC with a pinned public endpoint.
const pin = (chain: Chain, http: string): Chain => ({ ...chain, rpcUrls: { default: { http: [http] } } });

export const SUPPORTED_CHAINS: Record<number, Chain> = {
  9200: lightchainMainnet,
  1: pin(mainnet, "https://ethereum-rpc.publicnode.com"),
  8453: pin(base, "https://base-rpc.publicnode.com"),
  42161: pin(arbitrum, "https://arbitrum-one-rpc.publicnode.com"),
  10: pin(optimism, "https://optimism-rpc.publicnode.com"),
  137: pin(polygon, "https://polygon-bor-rpc.publicnode.com"),
  8200: lightchainTestnet,
};

// Display order in the network switcher.
export const CHAIN_LIST: Chain[] = [9200, 1, 8453, 42161, 10, 137, 8200].map((id) => SUPPORTED_CHAINS[id]!);

export const DEFAULT_CHAIN_ID = 9200;

export function chainById(id: number): Chain {
  return SUPPORTED_CHAINS[id] ?? lightchainMainnet;
}

export function isSupportedChain(id: number): boolean {
  return id in SUPPORTED_CHAINS;
}

export function explorerFor(id: number): string {
  return chainById(id).blockExplorers?.default.url ?? "https://mainnet.lightscan.app";
}

export function symbolFor(id: number): string {
  return chainById(id).nativeCurrency.symbol;
}

// Official network marks, bundled (no runtime hotlink). LightChain/LCAI reuses
// the same logo the bridge + chat already ship.
const CHAIN_LOGO: Record<number, string> = {
  9200: "/chains/lightchain.png",
  8200: "/chains/lightchain.png",
  1: "/chains/eth.png",
  8453: "/chains/base.png",
  42161: "/chains/arbitrum.png",
  10: "/chains/optimism.png",
  137: "/chains/polygon.png",
};

export function logoFor(id: number): string {
  return CHAIN_LOGO[id] ?? "/chains/lightchain.png";
}
