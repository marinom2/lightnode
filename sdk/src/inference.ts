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
  const sessionKey = await generateSessionKey();

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
export { consumerGatewayUrl, consumerGatewayHost, GatewayClient } from "./gateway.js";

/** Optional helper: generate the caller's own ECDH keypair if they want one (e.g. acting as the disputer). */
export { generateEcdhKeyPair };

// ----------------------------------------------------------------------------
// runInference - one call, full flow.
//
// Turns the seven-stage protocol (auth -> prepare -> createSession -> open relay
// -> uploadBlob -> submitJob -> stream + decrypt -> wait JobCompleted) into a
// single async call. Supports:
//
//   - onChunk callback     for live streaming to a UI / stdout
//   - maxRetries           auto-retry on StalledWorkerError (default 2)
//   - WebSocket            inject a constructor (Node: `ws`. Browser: omit and
//                          globalThis.WebSocket is used.)
//
// This is the API a builder should reach for first. The lower-level helpers
// (prepareSession, submitPrompt, decryptResponse) are still exported for
// builders who want to do something the orchestrator doesn't cover (e.g.
// reuse a session across multiple prompts, custom retry policy).
// ----------------------------------------------------------------------------

import { StalledWorkerError, OnChainRevertError, RelayTokenTimeoutError } from "./errors.js";

// Structurally typed minimum so we don't pull viem's WalletClient/PublicClient
// generic surface into this file. Anything that walks like a viem client passes.
interface MinimalWalletClient {
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
}
interface MinimalPublicClient {
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{
    status: "success" | "reverted";
    blockHash: `0x${string}`;
    blockNumber: bigint;
  }>;
  getLogs: (args: {
    address: `0x${string}`;
    event?: unknown;
    args?: Record<string, unknown>;
    fromBlock?: bigint;
    toBlock?: bigint | "latest";
    blockHash?: `0x${string}`;
  }) => Promise<
    Array<{
      transactionHash: `0x${string}`;
      blockNumber: bigint;
      data: `0x${string}`;
      topics: `0x${string}`[];
      args?: Record<string, unknown>;
    }>
  >;
}
interface MinimalWebSocket {
  binaryType?: string;
  close: () => void;
  addEventListener?: (
    type: "message" | "open" | "error" | "close",
    listener: (ev: { data?: unknown }) => void,
    options?: { once?: boolean },
  ) => void;
  on?: (type: "message" | "open" | "error" | "close", listener: (data?: unknown) => void) => void;
  once?: (type: "open" | "error" | "close", listener: (data?: unknown) => void) => void;
}
type WebSocketCtor = new (url: string) => MinimalWebSocket;

export interface RunInferenceArgs {
  /** The plaintext prompt to send. UTF-8 encoded before encryption. */
  prompt: string;
  /** Authenticated GatewayClient (with bearer JWT). */
  gateway: GatewayClient;
  /** viem WalletClient used to sign createSession + submitJob. */
  wallet: MinimalWalletClient;
  /** viem PublicClient used for receipts + log queries. */
  publicClient: MinimalPublicClient;
  /** The target NetworkConfig (typically `new LightNode("testnet").network`). */
  network: NetworkConfig;
  /** Inference model tag. Default: `"llama3-8b"`. */
  model?: string;
  /**
   * Streaming callback invoked once per decrypted relay chunk. Use for live
   * stdout / UI updates. Optional - the final `answer` is returned either way.
   */
  onChunk?: (chunk: string, totalSoFar: string) => void;
  /** Retry count if a worker stalls. Default 2 (so up to 3 paid attempts). */
  maxRetries?: number;
  /** How long to wait for JobCompleted before declaring the worker stalled. Default 120s. */
  jobCompletedTimeoutMs?: number;
  /**
   * WebSocket constructor. In a browser, omit and `globalThis.WebSocket` is
   * used. In Node, pass `WS` from the `ws` package.
   */
  WebSocket?: WebSocketCtor;
  /**
   * Override the relay URL (defaults to `wss://relay.<network>.lightchain.ai/ws`).
   * Useful for tests / mirrors.
   */
  relayUrl?: string;
}

export interface RunInferenceResult {
  /** The decrypted, fully-assembled model answer. */
  answer: string;
  /** The three on-chain transactions in the chain of proof. */
  txs: {
    createSession: `0x${string}`;
    submitJob: `0x${string}`;
    /**
     * Worker's commit-result tx. Null if the on-chain event hasn't landed by the
     * deadline but the WS-delivered, session-key-decrypted answer DID arrive -
     * in that case the answer is still authentic; this is just the explorer link.
     */
    jobCompleted: `0x${string}` | null;
  };
  /** The dispatcher-assigned worker that produced this response. */
  worker: `0x${string}`;
  sessionId: bigint;
  jobId: bigint;
  /** How many attempts were paid for (including the successful one). */
  attempts: number;
  /** Any prior attempts whose workers stalled (their fees are refunded by the protocol). */
  stalled: Array<{ jobId: bigint; worker: `0x${string}`; submitTx: `0x${string}` }>;
}

const JOB_REGISTRY_ABI_PARSED = [
  {
    type: "function",
    name: "createSession",
    stateMutability: "payable",
    inputs: [
      { name: "paramsHash", type: "bytes32" },
      { name: "worker", type: "address" },
      { name: "encWorkerKey", type: "bytes" },
      { name: "ephemeralPubKey", type: "bytes" },
      { name: "initState", type: "bytes" },
      { name: "expiry", type: "uint256" },
    ],
    outputs: [{ name: "sessionId", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitJob",
    stateMutability: "payable",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "promptHash", type: "bytes32" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
] as const;

// Pre-computed topic hashes for the three events we listen for.
// keccak256("SessionCreated(uint256,address,bytes32,address,bytes,bytes)")
const SESSION_CREATED_TOPIC = "0xedf9fab204f0bb366f5b33ff07f441f4e387a833e86bfe1364a42ae2c7e05d73" as const;
// keccak256("JobSubmitted(uint256,uint256,address)")
const JOB_SUBMITTED_TOPIC = "0xfb47370368875d7490803c5653d9496d0a3c5e1b49a17f013ec37abd9d86d356" as const;
// keccak256("JobCompleted(uint256,address,bytes32,bytes32)")
const JOB_COMPLETED_TOPIC = "0xdb545db74bae046337ed01971cf61569fd1a1460ff8ed511ab19ceaac1326377" as const;

function pickWebSocket(provided: WebSocketCtor | undefined): WebSocketCtor {
  if (provided) return provided;
  const g = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!g) {
    throw new Error(
      "no WebSocket available - either run in a browser or pass { WebSocket: require('ws') }",
    );
  }
  return g;
}

function topicAsUint(hex: `0x${string}`): bigint {
  return BigInt(hex);
}

async function runOneAttempt(args: RunInferenceArgs, attempt: number): Promise<RunInferenceResult> {
  const {
    prompt,
    gateway,
    wallet,
    publicClient,
    network,
    model = "llama3-8b",
    onChunk,
    jobCompletedTimeoutMs = 120_000,
  } = args;
  const WS = pickWebSocket(args.WebSocket);
  const relayUrl = args.relayUrl ?? `wss://relay.${network.id}.lightchain.ai/ws`;

  // 1. prepareSession
  const prepared = await prepareSession(gateway, model);
  const fee = await estimateJobFee(network, model);

  // 2. createSession on-chain
  const createTx = await wallet.writeContract({
    address: network.jobRegistry as `0x${string}`,
    abi: JOB_REGISTRY_ABI_PARSED,
    functionName: "createSession",
    args: [
      prepared.createSessionArgs.paramsHash,
      prepared.createSessionArgs.worker,
      prepared.createSessionArgs.encWorkerKey,
      prepared.createSessionArgs.ephemeralPubKey,
      prepared.createSessionArgs.initState,
      prepared.createSessionArgs.expiry,
    ],
    gas: 1_000_000n,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
  if (createReceipt.status !== "success") throw new OnChainRevertError("createSession", createTx);
  const createLog = (
    await publicClient.getLogs({ address: network.jobRegistry as `0x${string}`, blockHash: createReceipt.blockHash })
  ).find((l) => l.transactionHash === createTx && l.topics[0] === SESSION_CREATED_TOPIC);
  if (!createLog) throw new Error("SessionCreated log missing in createSession receipt");
  const sessionId = topicAsUint(createLog.topics[1]);

  // 3. relay token + WebSocket
  let relayToken: string | undefined;
  for (let i = 0; i < 30 && !relayToken; i++) {
    const r = await gateway.getSessionToken(Number(sessionId));
    if ("token" in r && r.token) relayToken = r.token;
    else await new Promise((res) => setTimeout(res, 1000));
  }
  if (!relayToken) throw new RelayTokenTimeoutError();

  const ws = new WS(`${relayUrl}?token=${encodeURIComponent(relayToken)}`);
  try {
    ws.binaryType = "arraybuffer";
  } catch {
    /* not a browser-style WS; ignore */
  }
  // Wait for open, supporting both browser (addEventListener) and Node ws (once).
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => resolve();
    const onError = (e?: unknown) => reject(e instanceof Error ? e : new Error("WebSocket open failed"));
    if (ws.once) {
      ws.once("open", onOpen);
      ws.once("error", onError);
    } else if (ws.addEventListener) {
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    } else {
      reject(new Error("WebSocket has neither once nor addEventListener"));
    }
    setTimeout(() => reject(new Error("relay WebSocket open timeout")), 20_000);
  });

  const chunks: string[] = [];
  const handleMessage = async (rawData: unknown) => {
    const raw =
      typeof rawData === "string"
        ? rawData
        : rawData instanceof ArrayBuffer
          ? new TextDecoder().decode(rawData)
          : typeof (rawData as { toString?: () => string }).toString === "function"
            ? (rawData as { toString: () => string }).toString()
            : "";
    let frame: { type?: string; payload?: string };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame?.payload) return;
    if (frame.type === "chunk") {
      try {
        const piece = await decryptResponse(prepared.sessionKey, frame.payload);
        chunks.push(piece);
        if (onChunk) onChunk(piece, chunks.join(""));
      } catch {
        /* control frame */
      }
    } else if (frame.type === "complete" && chunks.length === 0) {
      try {
        const piece = await decryptResponse(prepared.sessionKey, frame.payload);
        chunks.push(piece);
        if (onChunk) onChunk(piece, chunks.join(""));
      } catch {
        /* ignore */
      }
    }
  };
  if (ws.on) {
    ws.on("message", handleMessage);
  } else if (ws.addEventListener) {
    ws.addEventListener("message", (ev) => handleMessage(ev.data));
  }

  // 4. encrypt + upload prompt
  const promptHash = await submitPrompt(gateway, prepared.sessionKey, prompt);

  // 5. submitJob on-chain
  const submitTx = await wallet.writeContract({
    address: network.jobRegistry as `0x${string}`,
    abi: JOB_REGISTRY_ABI_PARSED,
    functionName: "submitJob",
    args: [sessionId, promptHash],
    value: BigInt(Math.round(fee * 1e18)),
    gas: 500_000n,
  });
  const submitReceipt = await publicClient.waitForTransactionReceipt({ hash: submitTx });
  if (submitReceipt.status !== "success") {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    throw new OnChainRevertError("submitJob", submitTx);
  }
  const jobLog = (
    await publicClient.getLogs({ address: network.jobRegistry as `0x${string}`, blockHash: submitReceipt.blockHash })
  ).find((l) => l.transactionHash === submitTx && l.topics[0] === JOB_SUBMITTED_TOPIC);
  if (!jobLog) throw new Error("JobSubmitted log missing in submitJob receipt");
  const jobId = topicAsUint(jobLog.topics[1]);

  // 6. wait for JobCompleted
  // The actual *result* is the WS-delivered, session-key-decrypted ciphertext.
  // JobCompleted is an explorer pointer (the worker's commit-result tx).
  // Polling rules:
  //   - No chunks yet: poll for the full deadline (default 120s). Still nothing
  //     -> throw stalled so the outer loop can retry with a different worker.
  //   - Chunks arrived: keep polling for a 45s grace window after the FIRST
  //     chunk. Workers usually commit JobCompleted within ~10s of broadcasting
  //     the answer, so 45s is generous. If it still doesn't land, surface the
  //     answer with txs.jobCompleted=null (the answer is still session-key
  //     authentic; the on-chain proof can be polled for separately by callers).
  const deadline = Date.now() + jobCompletedTimeoutMs;
  const POST_CHUNKS_GRACE_MS = 45_000;
  const waitStart = Date.now();
  let firstChunkAt: number | null = chunks.length > 0 ? waitStart : null;
  const jobIdTopic = (`0x${jobId.toString(16).padStart(64, "0")}`) as `0x${string}`;
  let completed: { transactionHash: `0x${string}` } | null = null;
  while (!completed) {
    const now = Date.now();
    if (now >= deadline) break;
    if (firstChunkAt != null && now - firstChunkAt >= POST_CHUNKS_GRACE_MS) break;
    await new Promise((res) => setTimeout(res, 3000));
    if (firstChunkAt == null && chunks.length > 0) firstChunkAt = Date.now();
    const logs = await publicClient.getLogs({
      address: network.jobRegistry as `0x${string}`,
      fromBlock: submitReceipt.blockNumber,
      toBlock: "latest",
    });
    completed =
      logs.find((l) => l.topics[0] === JOB_COMPLETED_TOPIC && l.topics[1] === jobIdTopic) ?? null;
    if (completed) break;
  }
  if (!completed && chunks.length === 0) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    throw new StalledWorkerError({
      jobId,
      worker: prepared.createSessionArgs.worker,
      submitTx,
      feeLcai: fee,
    });
  }

  // 7. grace period for the last relay frame, then close
  await new Promise((res) => setTimeout(res, 4000));
  try {
    ws.close();
  } catch {
    /* ignore */
  }

  return {
    answer: chunks.join(""),
    // completed may be null when the answer arrived via the WS but JobCompleted
    // hasn't landed on-chain yet. The decrypted answer is still authentic
    // (session-key bound); callers can poll for the event later if they want
    // the explorer-link form of the proof.
    txs: { createSession: createTx, submitJob: submitTx, jobCompleted: completed?.transactionHash ?? null },
    worker: prepared.createSessionArgs.worker,
    sessionId,
    jobId,
    attempts: attempt,
    stalled: [],
  };
}

/**
 * One call, full encrypted inference. Same code path the live playground at
 * lightnode.app/playground drives, condensed into a single function.
 *
 * @example
 * ```ts
 * import { LightNode, runInference, GatewayClient } from "lightnode-sdk";
 * import { createPublicClient, createWalletClient, http } from "viem";
 * import { privateKeyToAccount } from "viem/accounts";
 * import WS from "ws";
 *
 * const ln = new LightNode("testnet");
 * const wallet = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`), transport: http(ln.network.rpc) });
 * const publicClient = createPublicClient({ transport: http(ln.network.rpc) });
 * const gateway = new GatewayClient({ network: "testnet", bearer: await getJwt() });
 *
 * const { answer, txs } = await runInference({
 *   prompt: "Reply with a one-sentence fun fact about the ocean.",
 *   gateway, wallet, publicClient, network: ln.network,
 *   WebSocket: WS, // omit in the browser
 *   onChunk: (chunk) => process.stdout.write(chunk),
 *   maxRetries: 2,
 * });
 *
 * console.log("\n", txs);
 * ```
 */
export async function runInference(args: RunInferenceArgs): Promise<RunInferenceResult> {
  const maxRetries = args.maxRetries ?? 2;
  const stalled: RunInferenceResult["stalled"] = [];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await runOneAttempt(args, attempt);
      return { ...result, stalled };
    } catch (err) {
      if (err instanceof StalledWorkerError && attempt <= maxRetries) {
        stalled.push({ jobId: err.jobId, worker: err.worker, submitTx: err.submitTx });
        continue;
      }
      throw err;
    }
  }
  // Unreachable - the loop either returns or throws.
  throw new StalledWorkerError({ jobId: 0n, worker: "0x0000000000000000000000000000000000000000", submitTx: "0x", feeLcai: 0 });
}

/** Re-export the typed errors at this layer so a single import covers everything. */
export { StalledWorkerError, OnChainRevertError, RelayTokenTimeoutError, GatewayAuthError, isStalledWorker } from "./errors.js";

// =============================================================================
// runInferenceWithKey - the actual 5-line API.
// =============================================================================
//
// `runInference` requires the caller to wire viem clients + a SIWE-authenticated
// GatewayClient (~25 lines of boilerplate). That's fine for production apps
// where those clients already exist, but it's overkill for a "hello world".
// This helper bundles the wiring so the entire script collapses to:
//
//   const { answer } = await runInferenceWithKey({
//     network: "testnet",
//     privateKey: process.env.PRIVATE_KEY,
//     prompt: "Reply with a one-sentence fun fact about the ocean.",
//   });
//
// Under the hood it does everything `runInference` does, plus the viem setup
// and the SIWE handshake.

import type { NetworkId } from "./types.js";
import { NETWORKS } from "./networks.js";
import { GatewayClient as GatewayClientCtor, consumerGatewayUrl as consumerGatewayUrlFn } from "./gateway.js";
import { GatewayAuthError } from "./errors.js";
import { createPublicClient as viemCreatePublicClient, createWalletClient as viemCreateWalletClient, http as viemHttp } from "viem";
import { privateKeyToAccount as viemPrivateKeyToAccount } from "viem/accounts";

export interface RunInferenceWithKeyArgs {
  /** Network ID (`"testnet"` / `"mainnet"`) or a custom NetworkConfig. */
  network: NetworkId | NetworkConfig;
  /**
   * A funded EVM private key, hex with `0x` prefix. Pays the job fee + gas and
   * signs createSession + submitJob. NEVER hardcode this - load from env.
   */
  privateKey: string;
  /** The plaintext prompt to send. UTF-8 encoded before encryption. */
  prompt: string;
  /** Inference model tag. Default: `"llama3-8b"`. */
  model?: string;
  /**
   * Streaming callback invoked once per decrypted relay chunk. Use for live
   * stdout / UI updates. Optional - the final `answer` is returned either way.
   */
  onChunk?: (chunk: string, totalSoFar: string) => void;
  /** Retry count if a worker stalls. Default 2 (so up to 3 paid attempts). */
  maxRetries?: number;
  /** How long to wait for JobCompleted before declaring the worker stalled. Default 120s. */
  jobCompletedTimeoutMs?: number;
  /**
   * WebSocket constructor. In a browser this is auto-detected from
   * `globalThis.WebSocket`. In Node, pass `WS` from the `ws` package
   * (`import WS from "ws"`) - `ws` is not a hard dep of this SDK.
   */
  WebSocket?: WebSocketCtor;
  /** Override the relay URL (defaults to `wss://relay.<network>.lightchain.ai/ws`). */
  relayUrl?: string;
  /**
   * Override the consumer-api gateway URL. Defaults to a network-derived URL.
   * Useful for tests / mirrors / proxying through your own backend.
   */
  gatewayUrl?: string;
}

/**
 * One call, key-in / answer-out encrypted inference. Builds viem clients,
 * runs the SIWE handshake, opens the encrypted session, submits + decrypts,
 * and returns. Same proof chain (`createSession`, `submitJob`, `jobCompleted`)
 * as the lower-level `runInference`.
 *
 * @example
 * ```ts
 * import { runInferenceWithKey } from "lightnode-sdk";
 * import WS from "ws";
 *
 * const { answer, txs } = await runInferenceWithKey({
 *   network: "testnet",
 *   privateKey: process.env.PRIVATE_KEY!,
 *   prompt: "Reply with a one-sentence fun fact about the ocean.",
 *   WebSocket: WS, // omit in the browser
 * });
 *
 * console.log(answer);
 * ```
 */
export async function runInferenceWithKey(args: RunInferenceWithKeyArgs): Promise<RunInferenceResult> {
  // Resolve the network config and validate the key shape up front so a
  // mistyped key fails BEFORE we touch the RPC or the gateway.
  const network: NetworkConfig = typeof args.network === "string" ? NETWORKS[args.network] : args.network;
  if (!network) throw new Error(`unknown network: ${String(args.network)}`);
  const networkId: NetworkId = (typeof args.network === "string" ? args.network : "mainnet") as NetworkId;
  const key = args.privateKey?.trim();
  if (!key || !key.startsWith("0x") || key.length !== 66) {
    throw new Error("runInferenceWithKey: privateKey must be a 0x-prefixed 32-byte hex string");
  }

  const account = viemPrivateKeyToAccount(key as `0x${string}`);
  const chain = {
    id: network.chainId,
    name: network.label,
    nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
    rpcUrls: { default: { http: [network.rpc] } },
  };
  // Keep viem's real types here so signMessage / etc. are typed. The MinimalX
  // casts only happen at the runInference() call site below.
  const publicClient = viemCreatePublicClient({ transport: viemHttp(network.rpc), chain });
  const wallet = viemCreateWalletClient({ account, transport: viemHttp(network.rpc), chain });

  // One-shot SIWE handshake. We do this inline (rather than re-export it) so
  // the caller doesn't need a second import; in browsers + Node it works the
  // same against the consumer-api gateway.
  const gwBase = args.gatewayUrl ?? consumerGatewayUrlFn(networkId);
  // `fetch failed` with no cause is the worst possible error for a builder
  // running this for the first time - they need to know which host failed and
  // what the underlying cause was. Wrap both SIWE calls so the error names a
  // host (so a network/DNS/CORS problem is obvious) and a hint when the cause
  // looks like a CORS or undici-level reachability error.
  const fetchOrFail = async (url: string, init?: RequestInit, label?: string): Promise<Response> => {
    try {
      return await fetch(url, init);
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const code = cause?.code ?? "";
      const msg = (err as Error).message ?? "fetch failed";
      const detail = cause?.message ? ` (${cause.message})` : "";
      const hint =
        /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT|CERT_/.test(code) || msg.includes("CORS")
          ? ` Tip: this host may be unreachable from this runtime (CORS, DNS, or TLS). Pass gatewayUrl: 'https://lightnode.app/api/gw/${networkId}' to route through the public proxy.`
          : "";
      throw new Error(`SIWE ${label ?? "request"} to ${url} failed: ${msg}${detail}${hint}`);
    }
  };
  const chRes = await fetchOrFail(
    `${gwBase}/api/auth/challenge?address=${account.address}`,
    { headers: { Accept: "application/json" } },
    "challenge",
  );
  if (!chRes.ok) throw new GatewayAuthError(chRes.status, await chRes.text());
  const ch = (await chRes.json()) as { message?: string };
  if (!ch.message) throw new GatewayAuthError(chRes.status, "auth challenge returned no message");
  const signature = await wallet.signMessage({ account, message: ch.message });
  const verifyRes = await fetchOrFail(
    `${gwBase}/api/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ message: ch.message, signature }),
    },
    "verify",
  );
  if (!verifyRes.ok) throw new GatewayAuthError(verifyRes.status, await verifyRes.text());
  const verify = (await verifyRes.json()) as { token?: string };
  if (!verify.token) throw new GatewayAuthError(verifyRes.status, "auth verify returned no token");
  const gateway = new GatewayClientCtor({ network: networkId, bearer: verify.token, baseUrl: args.gatewayUrl ?? gwBase });

  // Pick a WebSocket: the browser global if present, otherwise the caller-
  // supplied ctor. We deliberately do NOT try to dynamic-import "ws" - it
  // isn't a hard dep, and a bundler trying to resolve it would fail noisily.
  const wsCtor =
    args.WebSocket ??
    (typeof globalThis !== "undefined" && (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
      ? (globalThis as { WebSocket: WebSocketCtor }).WebSocket
      : undefined);
  if (!wsCtor) {
    throw new Error(
      "runInferenceWithKey: no WebSocket constructor available. In Node, install `ws` and pass it: " +
        "`import WS from 'ws'; runInferenceWithKey({ WebSocket: WS, ... })`",
    );
  }

  return runInference({
    prompt: args.prompt,
    gateway,
    wallet: wallet as unknown as MinimalWalletClient,
    publicClient: publicClient as unknown as MinimalPublicClient,
    network,
    model: args.model,
    onChunk: args.onChunk,
    maxRetries: args.maxRetries,
    jobCompletedTimeoutMs: args.jobCompletedTimeoutMs,
    WebSocket: wsCtor,
    relayUrl: args.relayUrl,
  });
}
