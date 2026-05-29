import { keccak256, toBytes } from "viem";
import type { NetworkConfig } from "./types.js";
import {
  generateSessionKey,
  generateEcdhKeyPair,
  importPublicKey,
  encryptSessionKey,
  encrypt,
  decrypt,
  hexToBytes,
  bytesToHex,
  bytesToBase64,
  base64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
} from "./crypto.js";

// The gateway returns the worker pubkey as base64 and the disputer pubkey as
// hex (per the verified integration guide). Both decode to 65-byte uncompressed
// P-256 points - sniff the format so the caller never has to branch.
function decodePublicKey(s: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  if (/^[0-9a-fA-F]{130}$/.test(stripped)) return hexToBytes(stripped);
  const bytes = base64ToBytes(s);
  if (bytes.length !== 65) {
    throw new Error(`public key decoded to ${bytes.length} bytes; expected 65 (P-256 uncompressed)`);
  }
  return bytes;
}
import type { GatewayClient } from "./gateway.js";

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
/**
 * Canonical JobRegistry consumer ABI - parameter names mirror the verified
 * mainnet contract (paramsHash / ephemeralPubKey / initState / promptHash) so
 * decoders display sensible labels. The 4-byte selectors are
 *   createSession(bytes32,address,bytes,bytes,bytes,uint256)  → 0xe80116b4
 *   submitJob(uint256,bytes32)                                → 0xe3f4f3e9
 * createSession is payable but called with value=0; submitJob is payable and
 * must be called with `estimateJobFee(model)` as native value.
 */
export const JOB_REGISTRY_CONSUMER_ABI = [
  "function createSession(bytes32 paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey, bytes initState, uint256 expiry) payable returns (uint256 sessionId)",
  "function submitJob(uint256 sessionId, bytes32 promptHash) payable returns (uint256 jobId)",
  "event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)",
  "event JobSubmitted(uint256 indexed jobId, uint256 indexed sessionId, address worker)",
  "event JobCompleted(uint256 indexed jobId, address indexed worker, bytes32 responseHash, bytes32 ciphertextHash)",
] as const;

/**
 * High-level orchestration for the encrypted inference submit flow.
 *
 * The full submit is multi-stage (gateway calls + crypto + an on-chain tx the
 * caller signs with their wallet). These helpers chain the gateway calls and
 * the crypto so the caller is left with two well-defined responsibilities:
 *
 *   1. Sign and broadcast `createSession(...)` on the JobRegistry using the
 *      `SessionPreparation.createSessionArgs` returned by `prepareSession`.
 *   2. Sign and broadcast `submitJob(sessionId, blobHash)` paying
 *      `estimateJobFee(model)` as native value, using the `blobHash` returned
 *      by `submitPrompt`. The reply is decrypted with `decryptResponse`.
 *
 * Marked BETA: the on-chain calls are exercised; the gateway endpoints + wire
 * crypto are wire-compatible with the reference client (lcai-chat-v2). Live
 * end-to-end testing with a funded testnet wallet remains the caller's job.
 */
export interface SessionPreparation {
  /** 32-byte session key the caller persists to encrypt/decrypt subsequent jobs. */
  sessionKey: Uint8Array;
  /**
   * Arguments to pass to JobRegistry.createSession(...), in slot order.
   *
   * Parameter names match the canonical on-chain ABI (paramsHash,
   * ephemeralPubKey, initState) verified live in the LightChain inference
   * integration guide. The slot mapping is:
   *   - paramsHash      ← keccak256(model tag)
   *   - worker          ← prepared.worker
   *   - encWorkerKey    ← hex(encWorker)              // ECDH-wrap for the worker
   *   - ephemeralPubKey ← hex(encDisputer)            // ECDH-wrap for the disputer
   *   - initState       ← prepared.signature          // dispatcher EIP-712 signature
   *   - expiry          ← prepared.expiry
   */
  createSessionArgs: {
    paramsHash: `0x${string}`;
    worker: `0x${string}`;
    encWorkerKey: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    initState: `0x${string}`;
    expiry: bigint;
  };
  nonce: number;
}

/**
 * Step 1 + 2 of the protocol: ask the gateway which worker to use, generate a
 * fresh session key, wrap it for the worker (and the disputer if one was
 * returned), and get the dispatcher's signature authorising createSession.
 *
 * After this returns, the caller submits the on-chain `createSession` tx with
 * `createSessionArgs` and remembers `sessionKey` for the rest of the session.
 */
export async function prepareSession(gateway: GatewayClient, modelTag: string): Promise<SessionPreparation> {
  const id = modelId(modelTag);
  const selected = await gateway.selectSession(id);
  const sessionKey = generateSessionKey();

  // Workers' pubkeys arrive as base64; disputer's as hex - decodePublicKey
  // accepts either.
  const workerPub = await importPublicKey(decodePublicKey(selected.workerEncryptionKey));
  const encWorker = await encryptSessionKey(sessionKey, workerPub);
  const encDisputer: Uint8Array = selected.disputerEncryptionKey
    ? await encryptSessionKey(sessionKey, await importPublicKey(decodePublicKey(selected.disputerEncryptionKey)))
    : new Uint8Array(0);

  // The gateway expects the wrapped keys as BASE64; the same bytes are passed
  // as HEX to the on-chain createSession. Sending hex to the gateway makes the
  // dispatcher reject the prepare with an opaque error.
  const prepared = await gateway.prepareSession({
    modelId: id,
    encWorkerKey: bytesToBase64(encWorker),
    encDisputerKey: bytesToBase64(encDisputer),
  });

  return {
    sessionKey,
    nonce: prepared.nonce,
    createSessionArgs: {
      paramsHash: id,
      worker: prepared.worker,
      encWorkerKey: bytesToHex(encWorker),
      ephemeralPubKey: bytesToHex(encDisputer),
      initState: prepared.signature,
      expiry: BigInt(prepared.expiry),
    },
  };
}

/**
 * Encrypt a UTF-8 prompt with the session key, upload as a blob, and return
 * the EIP-4844 blob hash to pass to `submitJob(sessionId, blobHash)`.
 */
export async function submitPrompt(gateway: GatewayClient, sessionKey: Uint8Array, prompt: string): Promise<`0x${string}`> {
  const ct = await encrypt(sessionKey, utf8ToBytes(prompt));
  const res = await gateway.uploadBlob(bytesToBase64(ct));
  const first = res.blobHashes?.[0];
  if (!first) throw new Error("gateway returned no blob hashes");
  return first;
}

/** Decrypt a worker response (raw bytes or base64 from the relay) with the session key. */
export async function decryptResponse(sessionKey: Uint8Array, ciphertext: Uint8Array | string): Promise<string> {
  const bytes = typeof ciphertext === "string" ? base64ToBytes(ciphertext) : ciphertext;
  return bytesToUtf8(await decrypt(sessionKey, bytes));
}

/** Re-export so callers don't have to import from a second module just for the URL helper. */
export { consumerGatewayUrl, GatewayClient } from "./gateway.js";

/** Optional helper: generate the caller's own ECDH keypair if they want one (e.g. acting as the disputer). */
export { generateEcdhKeyPair };
