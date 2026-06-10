/**
 * Worker-status reads, inlined with viem so the wallet has ZERO build-time
 * dependency on the lightnode-sdk monorepo package (which needs the repo's
 * hoisted @types/node to compile). Same 4 calls the SDK's WorkerOperator.status()
 * makes, against the LightChain mainnet worker contracts.
 */
import { type PublicClient, parseAbi } from "viem";

// LightChain mainnet: WorkerRegistry is a genesis predeploy; AIConfig + JobRegistry are proxies.
const WORKER_REGISTRY = "0x0000000000000000000000000000000000001002" as const;
const AI_CONFIG = "0x24D11533C354092ed6E18b964257819cE78Ce77D" as const;
const JOB_REGISTRY = "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b" as const;

const REGISTRY_ABI = parseAbi([
  "function isWorkerRegistered(address) view returns (bool)",
  "function getWorkerStake(address) view returns (uint256)",
]);
const AI_CONFIG_ABI = parseAbi(["function getMinWorkerStake() view returns (uint256)"]);
const JOB_REGISTRY_ABI = parseAbi(["function workerBalance(address) view returns (uint256)"]);

export interface WorkerStatusView {
  registered: boolean;
  belowFloor: boolean;
  stakeLcai: number;
  minStakeLcai: number;
  headroomLcai: number;
  claimableLcai: number;
}

const toLcai = (wei: bigint) => Number(wei) / 1e18;

export async function readWorkerStatus(client: PublicClient, address: `0x${string}`): Promise<WorkerStatusView> {
  // minStake comes from AIConfig (canonical on both networks), not the registry getter.
  const [registered, stakeWei, minStakeWei, claimableWei] = await Promise.all([
    client.readContract({ address: WORKER_REGISTRY, abi: REGISTRY_ABI, functionName: "isWorkerRegistered", args: [address] }),
    client.readContract({ address: WORKER_REGISTRY, abi: REGISTRY_ABI, functionName: "getWorkerStake", args: [address] }),
    client.readContract({ address: AI_CONFIG, abi: AI_CONFIG_ABI, functionName: "getMinWorkerStake" }),
    client.readContract({ address: JOB_REGISTRY, abi: JOB_REGISTRY_ABI, functionName: "workerBalance", args: [address] }),
  ]);
  return {
    registered,
    belowFloor: registered && stakeWei < minStakeWei,
    stakeLcai: toLcai(stakeWei),
    minStakeLcai: toLcai(minStakeWei),
    headroomLcai: toLcai(stakeWei - minStakeWei),
    claimableLcai: toLcai(claimableWei),
  };
}
