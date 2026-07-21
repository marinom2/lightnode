/**
 * LightChain AI network constants. Verified against the worker run-node page,
 * the lightchain-worker-toolkit env reference, and the live mainnet registry.
 */

export type NetworkId = "mainnet" | "testnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  chainId: number;
  rpc: string;
  archiveRpc: string;
  explorer: string;
  beacon: string;
  workerGateway: string;
  subgraph: string;
  workerImage: string;
  workerRegistry: string; // genesis predeploy, same on both nets
  aiConfig: string;
  jobRegistry: string;
  minStakeLcai: number;
  fundLcai: number; // stake + gas headroom
  faucet?: string;
  /**
   * SessionManager proxy for on-chain sortition (testnet, since the 2026-07-14
   * upgrade). Staked workers race claimSession(reqId) here to be selected;
   * undefined on gateway-dispatch networks (mainnet).
   */
  sessionManager?: string;
  /**
   * True when worker selection is on-chain sortition rather than gateway
   * dispatch. Drives the worker run: sortition mode needs SORTITION_ENABLED +
   * SESSION_MANAGER_ADDRESS + a local Redis, and must NOT set a gateway URL.
   */
  sortition?: boolean;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chainId: 9200,
    rpc: "https://rpc.mainnet.lightchain.ai",
    archiveRpc: "https://archive.mainnet.lightchain.ai",
    explorer: "https://mainnet.lightscan.app",
    beacon: "https://beacon.mainnet.lightchain.ai",
    workerGateway: "https://worker-gateway.mainnet.lightchain.ai",
    subgraph: "https://workers-api.mainnet.lightchain.ai/graphql",
    workerImage:
      "us-central1-docker.pkg.dev/lightchain/lightchain-mainnet-public-docker/worker:latest",
    workerRegistry: "0x0000000000000000000000000000000000001002",
    aiConfig: "0x24D11533C354092ed6E18b964257819cE78Ce77D",
    jobRegistry: "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b",
    minStakeLcai: 50000,
    fundLcai: 50005,
    sortition: false, // mainnet still uses gateway dispatch (no SessionManager)
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    chainId: 8200,
    rpc: "https://rpc.testnet.lightchain.ai",
    archiveRpc: "https://archive.testnet.lightchain.ai",
    explorer: "https://testnet.lightscan.app",
    beacon: "https://beacon.testnet.lightchain.ai",
    workerGateway: "https://worker-gateway.testnet.lightchain.ai",
    subgraph: "https://workers-api.testnet.lightchain.ai/graphql",
    workerImage:
      "us-central1-docker.pkg.dev/lightchain/lightchain-testnet-public-docker/worker:latest",
    workerRegistry: "0x0000000000000000000000000000000000001002",
    aiConfig: "0xeCF4Ca5Ba6D97ae586993e170764a1E92231b67e",
    jobRegistry: "0x531b3a87c5d785441b9cf55b98169f20fd9056a7",
    minStakeLcai: 5000,
    fundLcai: 5005,
    faucet: "https://lightfaucet.ai",
    // 2026-07-14 sortition upgrade (verified on-chain 2026-07-21): SessionManager
    // proxy 0x86AdA808... (impl 0xB81c4612...) exposes claimSession; workers are
    // selected on-chain, so the run must be sortition mode + local Redis.
    sessionManager: "0x86AdA80864e87dE2275200FeE905b5C32b32Bf68",
    sortition: true,
  },
};

export const DEFAULT_NETWORK: NetworkId = "mainnet";

/** The model every worker serves today (bare name, no :latest - see toolkit gotcha #1). */
export const DEFAULT_MODEL = "llama3-8b";

/** Hardware floor + recommended spec from the official worker page. */
export const HARDWARE = {
  min: { cores: 4, ramGb: 16, vramGb: 8, storageGb: 512, mbps: 100 },
  rec: { cores: 16, ramGb: 64, vramGb: 24, storageGb: 2048, mbps: 1000 },
};
