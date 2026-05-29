import type { NetworkConfig, NetworkId } from "./types.js";

/**
 * LightChain AI network constants, verified against the live registries on both
 * chains. AIConfig + JobRegistry are upgradeable proxies (stable addresses); the
 * canonical source is WorkerRegistry.aiConfig() / .jobRegistry() if you ever need
 * to re-resolve them.
 */
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: 9200,
    rpc: "https://rpc.mainnet.lightchain.ai",
    explorer: "https://mainnet.lightscan.app",
    workerGateway: "https://worker-gateway.mainnet.lightchain.ai",
    subgraph: "https://workers-api.mainnet.lightchain.ai/graphql",
    workerRegistry: "0x0000000000000000000000000000000000001002",
    aiConfig: "0x24D11533C354092ed6E18b964257819cE78Ce77D",
    jobRegistry: "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b",
    minStakeLcai: 50000,
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    chainId: 8200,
    rpc: "https://rpc.testnet.lightchain.ai",
    explorer: "https://testnet.lightscan.app",
    workerGateway: "https://worker-gateway.testnet.lightchain.ai",
    subgraph: "https://workers-api.testnet.lightchain.ai/graphql",
    workerRegistry: "0x0000000000000000000000000000000000001002",
    aiConfig: "0xeCF4Ca5Ba6D97ae586993e170764a1E92231b67e",
    jobRegistry: "0x531b3a87c5d785441b9cf55b98169f20fd9056a7",
    minStakeLcai: 5000,
  },
};

/** WorkerRegistry genesis predeploy (same address on both networks). */
export const WORKER_REGISTRY = "0x0000000000000000000000000000000000001002";

/**
 * WorkerRegistry event topics, derived empirically from the deployed predeploy
 * (its source ABI differs from the deployed bytecode, so these are not computed
 * from a signature). The latest of the two for a worker = its current state.
 */
export const REGISTRY_TOPICS = {
  registered: "0x27987c0173113d0f969d0abbf00a8c583fd7f7f44c05af3739f808d2a0afba6f",
  exited: "0xde576c51e7828c269f7a259c68554d25364b596a7bd816f01d9b8cdb52e88d43",
} as const;
