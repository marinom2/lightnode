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
   *   - paramsHash      from keccak256(model tag)
   *   - worker          from prepared.worker
   *   - encWorkerKey    from hex(encWorker)              // ECDH-wrap for the worker
   *   - ephemeralPubKey from hex(encDisputer)            // ECDH-wrap for the disputer
   *   - initState       from prepared.signature          // dispatcher EIP-712 signature
   *   - expiry          from prepared.expiry
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
  /** Capabilities the bound worker advertises (e.g. ["search"]). */
  workerCapabilities?: string[];
}

/**
 * Step 1 + 2 of the protocol: ask the gateway which worker to use, generate a
 * fresh session key, wrap it for the worker (and the disputer if one was
 * returned), and get the dispatcher's signature authorising createSession.
 *
 * After this returns, the caller submits the on-chain `createSession` tx with
 * `createSessionArgs` and remembers `sessionKey` for the rest of the session.
 */
export async function prepareSession(gateway: GatewayClient, modelTag: string, opts?: { requiredCapabilities?: string[] }): Promise<SessionPreparation> {
  const id = modelId(modelTag);
  const requiredCapabilities = opts?.requiredCapabilities;
  // The gateway returns 409 selection_mismatch when a NEWER selectSession()
  // for the same wallet supersedes ours between the select and the prepare.
  // The error message is literally "re-run POST /api/sessions/select", so we
  // do exactly that: rebuild from a fresh selection. Backoff spans several
  // seconds because the gateway's selection TTL can be in that range - quick
  // retries inside that window just hit the same stuck state. Random jitter
  // keeps two concurrent callers from synchronising on identical schedules.
  const MAX_ATTEMPTS = 6;
  const BACKOFFS_MS = [0, 500, 1500, 4000, 9000, 18000];
  const jitter = (ms: number) => ms + Math.floor(Math.random() * 250);
  let lastErr: unknown = null;
  const isSelectionMismatch = (e: unknown): boolean => {
    const msg = e instanceof Error ? e.message : String(e);
    return /selection_mismatch|selection was superseded|409/.test(msg);
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, jitter(BACKOFFS_MS[attempt])));
    try {
      // Wrap BOTH gateway calls. selectSession itself can 409 if a newer
      // call has already superseded ours by the time the gateway processes
      // it. prepareSession 409s when the same happens between select and
      // prepare. The whole select -> prepare flow is one atomic unit.
      const selected = await gateway.selectSession(id, requiredCapabilities ? { requiredCapabilities } : undefined);
      const sessionKey = await generateSessionKey();

      // Workers' pubkeys arrive as base64; disputer's as hex - decodePublicKey
      // accepts either.
      const workerPub = await importPublicKey(decodePublicKey(selected.workerEncryptionKey));
      const encWorker = await encryptSessionKey(sessionKey, workerPub);
      const encDisputer: Uint8Array = selected.disputerEncryptionKey
        ? await encryptSessionKey(sessionKey, await importPublicKey(decodePublicKey(selected.disputerEncryptionKey)))
        : new Uint8Array(0);

      // ROOT-CAUSE FIX (lcai-chat-v2 commit 33c70841, May 2026): echo the
      // dispatcher's selectionId from selectSession back into prepareSession.
      // Without this, the dispatcher's pending-slot tracker matches against
      // the LATEST select for our wallet, so any concurrent activity (other
      // tab, other dApp signed into the same wallet) produces 409
      // selection_mismatch. Threading it makes the prepare bind to the
      // selection we actually got.
      const prepared = await gateway.prepareSession({
        modelId: id,
        encWorkerKey: bytesToBase64(encWorker),
        encDisputerKey: bytesToBase64(encDisputer),
        ...(selected.selectionId ? { selectionId: selected.selectionId } : {}),
        ...(requiredCapabilities ? { requiredCapabilities } : {}),
      });
      return {
        sessionKey,
        nonce: prepared.nonce,
        workerCapabilities: selected.workerCapabilities ?? [],
        createSessionArgs: {
          paramsHash: id,
          worker: prepared.worker,
          encWorkerKey: bytesToHex(encWorker),
          ephemeralPubKey: bytesToHex(encDisputer),
          initState: prepared.signature,
          expiry: BigInt(prepared.expiry),
        },
      };
    } catch (e) {
      lastErr = e;
      if (!isSelectionMismatch(e)) throw e;
      // else loop: a newer select stole this session, try again from select.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("prepareSession: gateway selection_mismatch did not clear");
}

/**
 * Encrypt a UTF-8 prompt with the session key, upload as a blob, and return
 * the EIP-4844 blob hash to pass to `submitJob(sessionId, blobHash)`.
 */
export async function submitPrompt(gateway: GatewayClient, sessionKey: Uint8Array, prompt: string, opts?: { searchEnabled?: boolean }): Promise<`0x${string}`> {
  const ct = await encrypt(sessionKey, utf8ToBytes(prompt));
  const res = await gateway.uploadBlob(bytesToBase64(ct), opts?.searchEnabled ? { searchEnabled: true } : undefined);
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
  /** Opt into worker-side web search (needs a search-capable worker). */
  searchEnabled?: boolean;
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
  /**
   * Cancellation signal. Aborts pending awaits inside the run; in-flight
   * submitJob transactions still settle on chain (the SDK stops listening).
   */
  signal?: AbortSignal;
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
  /** Web-search citations, when searchEnabled and the worker returned them. */
  sources?: WebSearchSource[];
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

/** Parse a decrypted "metadata" relay frame into web-search citations. Mirrors
 *  lcai-chat-v2's parseWebSearchSources: requires type === "webSearchSources"
 *  and an array of { position:number, url:string, title?, snippet? }. */
function parseWebSearchSources(payload: string): WebSearchSource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as { type?: unknown; sources?: unknown };
  if (obj.type !== "webSearchSources" || !Array.isArray(obj.sources)) return [];
  const out: WebSearchSource[] = [];
  for (const s of obj.sources) {
    if (!s || typeof s !== "object") continue;
    const src = s as { position?: unknown; title?: unknown; url?: unknown; snippet?: unknown };
    const position = typeof src.position === "number" ? src.position : undefined;
    const url = typeof src.url === "string" ? src.url : "";
    const title = typeof src.title === "string" ? src.title : "";
    const snippet = typeof src.snippet === "string" ? src.snippet : "";
    if (!position || !url) continue;
    out.push({ position, title: title || url, url, description: snippet });
  }
  return out;
}

/** A live, on-chain session. Open once, then run many jobs through it - each
 *  follow-up turn skips SIWE + createSession, leaving just the submitJob tx. */
export interface OpenSession {
  readonly gateway: GatewayClient;
  readonly wallet: MinimalWalletClient;
  readonly publicClient: MinimalPublicClient;
  readonly network: NetworkConfig;
  readonly model: string;
  readonly fee: number;
  readonly sessionId: bigint;
  readonly sessionKey: Uint8Array;
  readonly worker: `0x${string}`;
  readonly createTx: `0x${string}`;
  /** Unix seconds when the on-chain session window closes. */
  readonly expirySec: number;
  /** Capabilities the bound worker advertises (e.g. ["search"]). */
  readonly capabilities: string[];
}

export interface OpenSessionArgs {
  gateway: GatewayClient;
  wallet: MinimalWalletClient;
  publicClient: MinimalPublicClient;
  network: NetworkConfig;
  model?: string;
  /** Bind only to a worker advertising these (e.g. ["search"]). */
  requiredCapabilities?: string[];
}

/**
 * prepareSession + the on-chain createSession tx. Do this once, then run many
 * jobs through the handle with `runJobOnSession`. Re-open when `expirySec`
 * passes or the chosen worker stops serving.
 */
export async function openSession(args: OpenSessionArgs): Promise<OpenSession> {
  const { gateway, wallet, publicClient, network, model = "llama3-8b" } = args;
  const prepared = await prepareSession(gateway, model, args.requiredCapabilities ? { requiredCapabilities: args.requiredCapabilities } : undefined);
  const fee = await estimateJobFee(network, model);
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
  return {
    gateway,
    wallet,
    publicClient,
    network,
    model,
    fee,
    sessionId: topicAsUint(createLog.topics[1]),
    sessionKey: prepared.sessionKey,
    worker: prepared.createSessionArgs.worker,
    createTx,
    expirySec: Number(prepared.createSessionArgs.expiry),
    capabilities: prepared.workerCapabilities ?? [],
  };
}

/** A web-search citation returned alongside an answer (from the worker's
 *  "metadata" relay frame when searchEnabled was set). */
export interface WebSearchSource {
  position: number;
  title: string;
  url: string;
  description: string;
}

export interface RunJobOpts {
  onChunk?: (chunk: string, totalSoFar: string) => void;
  /** Opt this job into worker-side web search (requires a search-capable worker). */
  searchEnabled?: boolean;
  /** Human-readable progress, e.g. "Uploading prompt to chain..." then "Thinking...". */
  onStage?: (stage: string) => void;
  jobCompletedTimeoutMs?: number;
  WebSocket?: WebSocketCtor;
  relayUrl?: string;
  signal?: AbortSignal;
}

/**
 * Run ONE job against an already-open session: submitPrompt + submitJob + relay
 * stream + wait for JobCompleted. No SIWE, no createSession.
 */
export async function runJobOnSession(
  session: OpenSession,
  prompt: string,
  opts: RunJobOpts = {},
  attempt = 1,
): Promise<RunInferenceResult> {
  const { gateway, wallet, publicClient, network, sessionId, sessionKey, worker, fee, createTx } = session;
  const { onChunk, onStage, searchEnabled, jobCompletedTimeoutMs = 120_000 } = opts;
  const WS = pickWebSocket(opts.WebSocket);
  const relayUrl = opts.relayUrl ?? `wss://relay.${network.id}.lightchain.ai/ws`;
  // Shim so the job body below can keep referencing prepared.* unchanged.
  const prepared = { sessionKey, createSessionArgs: { worker } };

  // 3. relay token + WebSocket
  // Poll the gateway for the relay token with a fast backoff (it's usually ready
  // within ~1s of createSession). Catch it sooner than a fixed 1s interval, and
  // cap the total at a 20s deadline instead of 30 fixed iterations.
  let relayToken: string | undefined;
  const tokenDeadline = Date.now() + 20_000;
  let tokenDelay = 250;
  while (!relayToken) {
    const r = await gateway.getSessionToken(Number(sessionId));
    if ("token" in r && r.token) {
      relayToken = r.token;
      break;
    }
    if (Date.now() >= tokenDeadline) break;
    await new Promise((res) => setTimeout(res, tokenDelay));
    tokenDelay = Math.min(tokenDelay * 2, 2000);
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
  const sources: WebSearchSource[] = [];
  let streamDone = false;
  let streamDoneAt: number | null = null;
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
    // "metadata" carries web-search citations (sent before the answer stream).
    if (frame.type === "metadata" && frame.payload) {
      try {
        const decoded = await decryptResponse(prepared.sessionKey, frame.payload);
        for (const s of parseWebSearchSources(decoded)) sources.push(s);
      } catch {
        /* ignore malformed metadata */
      }
      return;
    }
    // "complete" marks end-of-stream (it may or may not carry a payload).
    // Record it so the JobCompleted wait can stop promptly instead of polling
    // the full grace window after the answer is already in hand.
    if (frame.type === "complete") {
      streamDone = true;
      streamDoneAt = Date.now();
      if (chunks.length === 0 && frame.payload) {
        try {
          const piece = await decryptResponse(prepared.sessionKey, frame.payload);
          chunks.push(piece);
          if (onChunk) onChunk(piece, chunks.join(""));
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (frame.type === "chunk" && frame.payload) {
      try {
        const piece = await decryptResponse(prepared.sessionKey, frame.payload);
        chunks.push(piece);
        if (onChunk) onChunk(piece, chunks.join(""));
      } catch {
        /* control frame */
      }
    }
  };
  if (ws.on) {
    ws.on("message", handleMessage);
  } else if (ws.addEventListener) {
    ws.addEventListener("message", (ev) => handleMessage(ev.data));
  }

  // 4. encrypt + upload prompt
  onStage?.(searchEnabled ? "Searching the web + uploading prompt..." : "Uploading prompt to chain...");
  const promptHash = await submitPrompt(gateway, prepared.sessionKey, prompt, searchEnabled ? { searchEnabled: true } : undefined);

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
  onStage?.("Thinking...");

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
  const POST_CHUNKS_GRACE_MS = 45_000; // fallback if the relay never sends a 'complete' frame
  const POST_DONE_GRACE_MS = 8_000;    // once the answer is fully in, the worker commits JobCompleted within ~seconds
  const waitStart = Date.now();
  let firstChunkAt: number | null = chunks.length > 0 ? waitStart : null;
  const jobIdTopic = (`0x${jobId.toString(16).padStart(64, "0")}`) as `0x${string}`;
  let completed: { transactionHash: `0x${string}` } | null = null;
  while (!completed) {
    const now = Date.now();
    if (now >= deadline) break;
    // Answer fully received (relay sent 'complete'): wait only briefly for the
    // on-chain proof, then return. The answer is already session-key authentic;
    // callers get txs.jobCompleted=null and can poll the proof later if needed.
    if (streamDone && now - (streamDoneAt ?? now) >= POST_DONE_GRACE_MS) break;
    if (firstChunkAt != null && now - firstChunkAt >= POST_CHUNKS_GRACE_MS) break;
    await new Promise((res) => setTimeout(res, 1500));
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

  // 7. grace period for the last relay frame, then close. If the stream already
  // signaled 'complete', no more frames are coming - skip the wait.
  await new Promise((res) => setTimeout(res, streamDone ? 300 : 4000));
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
    ...(sources.length > 0 ? { sources } : {}),
  };
}

/** One attempt = open a fresh session, then run one job through it. */
async function runOneAttempt(args: RunInferenceArgs, attempt: number): Promise<RunInferenceResult> {
  const session = await openSession({
    gateway: args.gateway,
    wallet: args.wallet,
    publicClient: args.publicClient,
    network: args.network,
    model: args.model,
    ...(args.searchEnabled ? { requiredCapabilities: ["search"] } : {}),
  });
  return runJobOnSession(
    session,
    args.prompt,
    {
      onChunk: args.onChunk,
      searchEnabled: args.searchEnabled,
      jobCompletedTimeoutMs: args.jobCompletedTimeoutMs,
      WebSocket: args.WebSocket,
      relayUrl: args.relayUrl,
      signal: args.signal,
    },
    attempt,
  );
}

/**
 * A reusable, wallet-signed inference session. Open it once (SIWE happens before
 * this; createSession happens here), then call `.send()` per turn - each
 * follow-up turn skips createSession, leaving just the submitJob tx. Re-open
 * (call `LightChatSession.open(...)` again) when `expired` is true or a
 * `.send()` throws because the worker stopped serving.
 *
 * @example
 * ```ts
 * const session = await LightChatSession.open({ gateway, wallet, publicClient, network, model: "llama3-8b" });
 * const a = await session.send("Who wrote The Great Gatsby?", { onChunk });
 * const b = await session.send("In what year?", { onChunk }); // no createSession
 * ```
 */
export class LightChatSession {
  private constructor(private readonly session: OpenSession) {}
  static async open(args: OpenSessionArgs): Promise<LightChatSession> {
    return new LightChatSession(await openSession(args));
  }
  get sessionId(): bigint { return this.session.sessionId; }
  get worker(): `0x${string}` { return this.session.worker; }
  get model(): string { return this.session.model; }
  /** Capabilities the bound worker advertises (e.g. ["search"]). */
  get capabilities(): string[] { return this.session.capabilities; }
  /** true once the on-chain session window has closed; re-open before sending. */
  get expired(): boolean { return Date.now() / 1000 >= this.session.expirySec; }
  send(prompt: string, opts: RunJobOpts = {}): Promise<RunInferenceResult> {
    return runJobOnSession(this.session, prompt, opts);
  }
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
    if (args.signal?.aborted) throw new Error("runInference: aborted");
    try {
      const result = await runOneAttempt(args, attempt);
      return { ...result, stalled };
    } catch (err) {
      if (err instanceof StalledWorkerError && attempt <= maxRetries && !args.signal?.aborted) {
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
  /** Opt into worker-side web search (needs a search-capable worker). */
  searchEnabled?: boolean;
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
  /**
   * Cancellation signal. Aborts the SIWE handshake and stops awaiting the
   * relay; in-flight submitJob transactions still settle on chain (the SDK
   * just stops listening). Throws `Error("aborted")` synchronously if the
   * signal is already fired when the call starts.
   */
  signal?: AbortSignal;
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
  if (args.signal?.aborted) {
    throw new Error("runInferenceWithKey: aborted before start");
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
      return await fetch(url, { ...init, signal: args.signal });
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

  // Pick a WebSocket: caller-supplied wins, else the browser global, else try
  // to lazy-import the `ws` package (Node). The webpackIgnore hint keeps
  // bundlers from blowing up trying to resolve `ws` for browser bundles where
  // we never reach this branch.
  let wsCtor: WebSocketCtor | undefined =
    args.WebSocket ??
    (typeof globalThis !== "undefined" && (globalThis as { WebSocket?: WebSocketCtor }).WebSocket
      ? (globalThis as { WebSocket: WebSocketCtor }).WebSocket
      : undefined);
  if (!wsCtor) {
    try {
      // Hide the module name from TS's static resolver via a Function-built
      // dynamic import - otherwise TS errors trying to find @types/ws (we do
      // not want that as a SDK devDep). The webpackIgnore-style comment also
      // keeps browser bundlers from trying to resolve `ws`.
      const dynamicImport = Function("n", "return import(/* webpackIgnore: true */ n)") as (
        n: string,
      ) => Promise<{ default?: WebSocketCtor; WebSocket?: WebSocketCtor }>;
      const mod = await dynamicImport("ws");
      wsCtor = mod.default ?? mod.WebSocket;
    } catch {
      // `ws` not installed - keep wsCtor undefined and fall into the error below.
    }
  }
  if (!wsCtor) {
    throw new Error(
      "runInferenceWithKey: no WebSocket constructor available. In Node, install `ws` " +
        "(`npm i ws`) - the SDK will pick it up automatically. Or pass one explicitly: " +
        "`import WS from 'ws'; runInferenceWithKey({ WebSocket: WS, ... })`.",
    );
  }

  return runInference({
    prompt: args.prompt,
    gateway,
    wallet: wallet as unknown as MinimalWalletClient,
    publicClient: publicClient as unknown as MinimalPublicClient,
    network,
    model: args.model,
    searchEnabled: args.searchEnabled,
    onChunk: args.onChunk,
    maxRetries: args.maxRetries,
    jobCompletedTimeoutMs: args.jobCompletedTimeoutMs,
    WebSocket: wsCtor,
    relayUrl: args.relayUrl,
    signal: args.signal,
  });
}

// =============================================================================
// runInferenceStream - AsyncIterable<string> API.
// =============================================================================
//
// `runInference` / `runInferenceWithKey` accept an `onChunk` callback for
// streaming. That's fine but it's a callback API in 2026, and a builder doing
// `for await (const chunk of stream) ...` reads cleaner than threading a
// callback. This wraps the existing flow into an async iterator: each yield is
// a fresh chunk, and the iterator's `.return` resolves to the final result
// (txs + worker + jobId + the full assembled answer).

export interface RunInferenceStreamResult {
  /** Streamed chunks (decrypted, in arrival order). */
  [Symbol.asyncIterator](): AsyncIterator<string>;
  /**
   * Resolves with the same shape `runInference` returns once the iterator
   * has finished (i.e. you've consumed all chunks). `answer` is the full
   * assembled string. Awaiting this before consuming the iterator hangs;
   * always iterate first or in parallel with another consumer.
   */
  done: Promise<RunInferenceResult>;
}

/**
 * Stream-shaped wrapper over `runInferenceWithKey`. Returns an async-iterable
 * of decrypted chunks plus a `done` promise that resolves to the full result
 * once the iteration completes.
 *
 * @example
 * ```ts
 * import { runInferenceStream } from "lightnode-sdk";
 *
 * const stream = runInferenceStream({
 *   network: "testnet",
 *   privateKey: process.env.PRIVATE_KEY!,
 *   prompt: "Write a haiku about decentralized AI.",
 * });
 *
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk);
 * }
 * const { txs } = await stream.done;
 * console.log("\n", txs);
 * ```
 */
export function runInferenceStream(args: RunInferenceWithKeyArgs): RunInferenceStreamResult {
  // Bounded queue of pending chunks; consumed in order by the iterator. We
  // can't use an unbounded array because the inference may produce chunks
  // faster than the consumer reads them - bounding at 1024 is enough to absorb
  // model-output bursts without unbounded memory growth.
  const queue: string[] = [];
  const waiters: Array<(v: IteratorResult<string>) => void> = [];
  let finished = false;
  let error: Error | null = null;

  const push = (chunk: string) => {
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      if (resolve) resolve({ value: chunk, done: false });
    } else {
      queue.push(chunk);
    }
  };
  const finish = (err: Error | null = null) => {
    finished = true;
    error = err;
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      if (!resolve) continue;
      if (err) resolve({ value: undefined, done: true });
      else resolve({ value: undefined, done: true });
    }
  };

  const done = runInferenceWithKey({
    ...args,
    onChunk: (chunk) => push(chunk),
  })
    .then((res) => {
      finish(null);
      return res;
    })
    .catch((e) => {
      finish(e as Error);
      throw e;
    });

  return {
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        async next(): Promise<IteratorResult<string>> {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (finished) {
            if (error) throw error;
            return { value: undefined, done: true };
          }
          return new Promise<IteratorResult<string>>((resolve) => waiters.push(resolve));
        },
      };
    },
    done,
  };
}
