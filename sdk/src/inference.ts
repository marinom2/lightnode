import { keccak256, toBytes } from "viem";
import type { NetworkConfig } from "./types.js";

// AIConfig.calculateJobFee(bytes32) - verified live on both networks.
const CALCULATE_JOB_FEE_SELECTOR = "0x33763d83";

/** modelId = keccak256(utf8(exact ollama tag)). Joins to the subgraph + contracts. */
export function modelId(tag: string): `0x${string}` {
  return keccak256(toBytes(tag));
}

/**
 * On-chain inference fee for a model, in whole LCAI - read from
 * AIConfig.calculateJobFee(modelId). This is what `submitJob` must be paid (native
 * value), so a consumer can quote a price before submitting.
 */
export async function estimateJobFee(cfg: NetworkConfig, modelTag: string): Promise<number> {
  const data = CALCULATE_JOB_FEE_SELECTOR + modelId(modelTag).slice(2);
  const res = await fetch(cfg.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: cfg.aiConfig, data }, "latest"] }),
  });
  const json = (await res.json()) as { result?: string; error?: { message?: string } };
  if (json.error || !json.result || json.result === "0x") {
    throw new Error(json.error?.message ?? "calculateJobFee returned no data");
  }
  return Number(BigInt(json.result)) / 1e18;
}

/**
 * The consumer-relevant JobRegistry surface (human-readable, viem-parseable). Use it
 * to build the full submit flow: createSession -> submitJob(value: fee) -> watch
 * JobCompleted / read the result blob.
 *
 * IMPORTANT: this ABI is reverse-engineered from the official client (lcai-chat-v2),
 * verified by selector against the deployed bytecode, but NOT from published source.
 * The full submit also requires an ECDH-P256 + AES-256-GCM handshake with the assigned
 * worker and a blob upload to the consumer gateway - intentionally NOT bundled here
 * (it's a large, protocol-specific, currently-undocumented surface). See the SDK
 * README "Submitting inference" for the verified end-to-end steps and a reference.
 */
export const JOB_REGISTRY_CONSUMER_ABI = [
  "function createSession(bytes32 modelId, address worker, bytes encWorkerKey, bytes encDisputerKey, bytes dispatcherSignature, uint256 expiry) payable returns (uint256 sessionId)",
  "function submitJob(uint256 sessionId, bytes32 blobHash) payable returns (uint256 jobId)",
  "event SessionCreated(uint256 sessionId, address user, bytes32 indexed modelId, address worker, bytes encWorkerKey, bytes encDisputerKey)",
  "event JobSubmitted(uint256 jobId, uint256 sessionId, address worker)",
  "event JobCompleted(uint256 jobId, address worker, bytes32 responseBlobHash, bytes32 responseCiphertextHash)",
] as const;

/** Consumer gateway base URL for a network (SIWE-authenticated; submit blobs + relay). */
export function consumerGatewayUrl(net: "mainnet" | "testnet"): string {
  return `https://chat-api.${net}.lightchain.ai`;
}
