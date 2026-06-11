/**
 * Encrypted AI inference on LightChain, inlined (no SDK): SIWE auth against the
 * gateway, ECDH-P256 + AES-256-GCM session encryption, two signed transactions
 * per message (createSession + submitJob with the model fee), and the response
 * streamed back over the relay WebSocket and decrypted locally. The prompt and
 * the answer are end-to-end encrypted between this wallet and the worker.
 */
import { type Account, createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbi, keccak256, toHex, toBytes, createWalletClient } from "viem";
import { p256 } from "@noble/curves/nist.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { chainById } from "./chains";

// LightChain mainnet inference deployment. The gateway is reached through the
// open-CORS pass-through (same one the website uses from browsers).
const CHAIN_ID = 9200;
const JOB_REGISTRY = "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b" as const;
const AI_CONFIG = "0x24D11533C354092ed6E18b964257819cE78Ce77D" as const;
const GATEWAY = "https://lightnode.app/api/gw/mainnet";
const RELAY_WS = "wss://relay.mainnet.lightchain.ai/ws";

const REGISTRY_ABI = parseAbi([
  "function createSession(bytes32 paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey, bytes initState, uint256 expiry) payable returns (uint256)",
  "function submitJob(uint256 sessionId, bytes32 promptHash) payable returns (uint256)",
  "event SessionCreated(uint256 indexed sessionId, address indexed user, bytes32 indexed paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey)",
]);
const FEE_ABI = parseAbi(["function calculateJobFee(bytes32 modelId) view returns (uint256)"]);

const HTTP_TIMEOUT_MS = 15000;
const TOKEN_POLL_MS = 20000;
const WS_OPEN_MS = 20000;
const STREAM_CAP_MS = 120000;
const COMPLETE_GRACE_MS = 800;

// ---- crypto (mirrors the protocol: ECDH-P256 x-coordinate + AES-256-GCM) -----

const b64encode = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Worker keys arrive base64 OR hex, and the hex form often comes WITHOUT a 0x
 * prefix. Bare hex is also valid base64 alphabet, so format must be sniffed by
 * shape (130 hex chars = 65 bytes), exactly like the SDK does: feeding bare hex
 * to a base64 decoder yields 97 garbage bytes and a false "invalid key" error.
 */
export function decodePublicKey(s: string): Uint8Array {
  const stripped = s.startsWith("0x") ? s.slice(2) : s;
  let raw: Uint8Array;
  if (/^[0-9a-fA-F]{130}$/.test(stripped)) {
    raw = toBytes(`0x${stripped}` as `0x${string}`);
  } else {
    try {
      raw = b64decode(s);
    } catch {
      throw new Error("The worker sent an invalid encryption key.");
    }
  }
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("The worker sent an invalid encryption key.");
  return raw;
}

/** Wrap the session key for a recipient: ephemeralPub(65) || nonce(12) || ct+tag. */
export function wrapSessionKey(sessionKey: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const ephPriv = p256.utils.randomSecretKey();
  const ephPub = p256.getPublicKey(ephPriv, false);
  const shared = p256.getSharedSecret(ephPriv, recipientPub, false).slice(1, 33); // x-coordinate
  const nonce = randomBytes(12);
  const sealed = gcm(shared, nonce).encrypt(sessionKey);
  const out = new Uint8Array(65 + 12 + sealed.length);
  out.set(ephPub, 0);
  out.set(nonce, 65);
  out.set(sealed, 77);
  return out;
}

/** nonce(12) || ciphertext || tag(16) with the session key. */
export function encryptPayload(sessionKey: Uint8Array, plaintext: string): Uint8Array {
  const nonce = randomBytes(12);
  const sealed = gcm(sessionKey, nonce).encrypt(new TextEncoder().encode(plaintext));
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, 12);
  return out;
}

export function decryptPayload(sessionKey: Uint8Array, sealed: Uint8Array): string {
  if (sealed.length < 29) throw new Error("Relay frame too short.");
  const plain = gcm(sessionKey, sealed.slice(0, 12)).decrypt(sealed.slice(12));
  return new TextDecoder().decode(plain);
}

export const modelIdFor = (tag: string): `0x${string}` => keccak256(new TextEncoder().encode(tag));

// ---- gateway ------------------------------------------------------------------

async function gw<T>(path: string, init: RequestInit & { bearer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`AI gateway error (${res.status}). Try again in a moment.`);
  return res.json() as Promise<T>;
}

// One token per address per service-worker lifetime (it expires server-side).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function authToken(account: Account): Promise<string> {
  const cached = tokenCache.get(account.address.toLowerCase());
  if (cached && cached.expiresAt - 30000 > Date.now()) return cached.token;
  const { message } = await gw<{ message: string }>(`/api/auth/challenge?address=${account.address}`);
  if (!account.signMessage) throw new Error("This account cannot sign messages.");
  const signature = await account.signMessage({ message });
  const v = await gw<{ token: string; expiresAt: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
  tokenCache.set(account.address.toLowerCase(), { token: v.token, expiresAt: Date.parse(v.expiresAt) || Date.now() + 600000 });
  return v.token;
}

export interface ChatModel {
  id: `0x${string}`;
  name: string;
  feeLcai: number;
}

export async function listChatModels(): Promise<ChatModel[]> {
  const { models } = await gw<{ models: { id: string; name: string }[] }>("/api/models");
  const pub = createPublicClient({ chain: chainById(CHAIN_ID), transport: http() });
  const out: ChatModel[] = [];
  for (const m of (models ?? []).slice(0, 8)) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(m.id) || typeof m.name !== "string") continue;
    const fee = (await pub
      .readContract({ address: AI_CONFIG, abi: FEE_ABI, functionName: "calculateJobFee", args: [m.id as `0x${string}`] })
      .catch(() => 0n)) as bigint;
    out.push({ id: m.id as `0x${string}`, name: m.name.slice(0, 32), feeLcai: Number(fee) / 1e18 });
  }
  return out;
}

// ---- the full per-message pipeline ---------------------------------------------

export interface ChatEvents {
  phase: (p: "auth" | "prepare" | "create" | "upload" | "submit" | "stream") => void;
  chunk: (text: string) => void;
}

interface SelectResp {
  worker: string;
  workerEncryptionKey: string;
  disputerEncryptionKey?: string;
  selectionId?: string;
}
interface PrepareResp {
  worker: string;
  signature: string;
  expiry: number;
}

async function waitRelayToken(sessionId: bigint, bearer: string): Promise<string> {
  const deadline = Date.now() + TOKEN_POLL_MS;
  let wait = 250;
  for (;;) {
    const res = await fetch(`${GATEWAY}/api/sessions/${sessionId}/token`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (res.status === 200) {
      const j = (await res.json()) as { token?: string };
      if (j.token) return j.token;
    }
    if (Date.now() > deadline) throw new Error("The relay did not come up in time. Your fee is refunded automatically; try again.");
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 2000);
  }
}

function streamAnswer(sessionKey: Uint8Array, relayToken: string, on: ChatEvents): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${RELAY_WS}?token=${encodeURIComponent(relayToken)}`);
    ws.binaryType = "arraybuffer";
    let answer = "";
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(capTimer);
      clearTimeout(openTimer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err && !answer) reject(err);
      else resolve(answer);
    };
    const openTimer = setTimeout(() => finish(new Error("Could not reach the response relay. Your fee is refunded automatically.")), WS_OPEN_MS);
    const capTimer = setTimeout(() => finish(answer ? undefined : new Error("The worker did not answer in time. Your fee is refunded automatically.")), STREAM_CAP_MS);
    ws.onopen = () => clearTimeout(openTimer);
    ws.onerror = () => finish(new Error("The response relay connection failed. Your fee is refunded automatically."));
    ws.onclose = () => finish();
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)) as { type?: string; payload?: string };
        if (frame.payload) {
          const text = decryptPayload(sessionKey, b64decode(frame.payload));
          answer += text;
          on.chunk(text);
        }
        if (frame.type === "complete") setTimeout(() => finish(), COMPLETE_GRACE_MS);
      } catch {
        // unparseable frame: ignore, the cap timer bounds us
      }
    };
  });
}

export interface ChatResult {
  answer: string;
  feeLcai: number;
  submitHash: string;
}

/** One chat message end to end. Two signed txs; everything else is transport. */
export async function runInference(account: Account, model: ChatModel, prompt: string, on: ChatEvents): Promise<ChatResult> {
  const chain = chainById(CHAIN_ID);
  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account, chain, transport: http() });

  on.phase("auth");
  const bearer = await authToken(account);

  on.phase("prepare");
  const sel = await gw<SelectResp>("/api/sessions/select", { method: "POST", bearer, body: JSON.stringify({ modelId: model.id }) });
  const sessionKey = randomBytes(32);
  const encWorker = wrapSessionKey(sessionKey, decodePublicKey(sel.workerEncryptionKey));
  const encDisputer = sel.disputerEncryptionKey ? wrapSessionKey(sessionKey, decodePublicKey(sel.disputerEncryptionKey)) : new Uint8Array(0);
  const prep = await gw<PrepareResp>("/api/sessions/prepare", {
    method: "POST",
    bearer,
    body: JSON.stringify({
      modelId: model.id,
      encWorkerKey: b64encode(encWorker),
      ...(encDisputer.length ? { encDisputerKey: b64encode(encDisputer) } : {}),
      ...(sel.selectionId ? { selectionId: sel.selectionId } : {}),
    }),
  });

  on.phase("create");
  const createHash = await wallet.sendTransaction({
    to: JOB_REGISTRY,
    data: encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "createSession",
      args: [model.id, prep.worker as `0x${string}`, toHex(encWorker), encDisputer.length ? toHex(encDisputer) : "0x", prep.signature as `0x${string}`, BigInt(prep.expiry)],
    }),
  });
  const createRcpt = await pub.waitForTransactionReceipt({ hash: createHash });
  if (createRcpt.status !== "success") throw new Error("Starting the chat session failed on-chain. Nothing was charged.");
  let sessionId: bigint | null = null;
  for (const log of createRcpt.logs) {
    try {
      const dec = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
      if (dec.eventName === "SessionCreated") {
        sessionId = (dec.args as { sessionId: bigint }).sessionId;
        break;
      }
    } catch {
      continue;
    }
  }
  if (sessionId === null) throw new Error("Could not read the session id from the chain.");

  on.phase("upload");
  const { blobHashes } = await gw<{ blobHashes: string[] }>("/api/blobs", { method: "POST", bearer, body: JSON.stringify({ data: b64encode(encryptPayload(sessionKey, prompt)) }) });
  const promptHash = blobHashes?.[0];
  if (!promptHash || !/^0x[0-9a-fA-F]{64}$/.test(promptHash)) throw new Error("The gateway rejected the encrypted prompt.");

  on.phase("submit");
  const feeWei = (await pub.readContract({ address: AI_CONFIG, abi: FEE_ABI, functionName: "calculateJobFee", args: [model.id] })) as bigint;
  const submitHash = await wallet.sendTransaction({
    to: JOB_REGISTRY,
    value: feeWei,
    data: encodeFunctionData({ abi: REGISTRY_ABI, functionName: "submitJob", args: [sessionId, promptHash as `0x${string}`] }),
  });
  const submitRcpt = await pub.waitForTransactionReceipt({ hash: submitHash });
  if (submitRcpt.status !== "success") throw new Error("Submitting the message failed on-chain.");

  on.phase("stream");
  const relayToken = await waitRelayToken(sessionId, bearer);
  const answer = await streamAnswer(sessionKey, relayToken, on);
  if (!answer) throw new Error("The worker returned an empty answer. Your fee is refunded automatically.");
  return { answer, feeLcai: Number(feeWei) / 1e18, submitHash };
}
