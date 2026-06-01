/**
 * SIWE sign-in against LightChain's consumer-api. The gateway accepts the
 * JWT minted here as its `Authorization: Bearer <token>` header, so this
 * unlocks every protected gateway endpoint (selectSession, prepareSession,
 * uploadBlob, getSessionToken).
 *
 * Reverse-engineered from lightchain-protocol/lcai-chat-v2 (the official
 * chat reference app). The same two endpoints work on mainnet and testnet
 * - only the host differs (see {@link NetworkConfig.consumerApi}).
 *
 *   1. `GET  /api/auth/challenge?address=0x...`
 *        -> { nonce: string, message: string }
 *      The server pre-builds the SIWE message; clients sign it verbatim.
 *
 *   2. `POST /api/auth/verify` body { message, signature }
 *        -> { success, address, token, user }
 *      `token` is the JWT bearer for the gateway.
 *
 * Returns a {@link SiweSession} that the SDK's GatewayClient consumes as
 * its `bearer` source. The session also exposes `expiresAt` so consumers
 * can refresh proactively.
 */

import type { NetworkId, NetworkConfig } from "./types.js";
import { NETWORKS } from "./networks.js";

/**
 * Minimal subset of viem's `WalletClient` we need to sign the SIWE
 * message. Accepts viem's `WalletClient`, wagmi's `useWalletClient().data`,
 * or any structurally compatible object with `account.address` and
 * `signMessage`.
 */
export interface SiweWalletClient {
  account?: { address?: `0x${string}` };
  signMessage(args: {
    account: `0x${string}` | { address: `0x${string}` };
    message: string;
  }): Promise<`0x${string}`>;
}

export interface SiweChallenge {
  nonce: string;
  message: string;
}

export interface SiweVerifyResult {
  success: boolean;
  address: `0x${string}`;
  token: string;
  user?: {
    id: string;
    username?: string | null;
    walletAddress: `0x${string}`;
    type: string;
  };
}

export interface SiweSession {
  /** ES256K JWT bearer accepted by the worker-gateway. */
  token: string;
  /** Wallet that signed the message. */
  address: `0x${string}`;
  /** Network the session is bound to. */
  network: NetworkId;
  /** SIWE message expiry as a unix-ms timestamp (null when not parseable). */
  expiresAt: number | null;
  /**
   * Drop-in `BearerSource` for `new GatewayClient({ bearer })`. Returns
   * the same JWT for every call; refresh by calling {@link siweSignIn}
   * again before {@link expiresAt} elapses.
   */
  bearer: () => string;
}

const REQUEST_TIMEOUT_MS = 15_000;

function resolveNetwork(network: NetworkId | NetworkConfig): NetworkConfig {
  if (typeof network === "string") {
    const cfg = NETWORKS[network];
    if (!cfg) throw new Error(`siweSignIn: unknown network "${network}"`);
    return cfg;
  }
  return network;
}

async function httpJson<T>(
  url: string,
  init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  init.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { Accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Surface the server-side validation message when present.
      const detail = text.length < 400 ? text : `${text.slice(0, 380)}...`;
      throw new Error(`siwe ${url}: ${res.status} ${detail}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`siwe ${url}: non-JSON response (${text.slice(0, 120)})`);
    }
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Fetch a SIWE challenge for `address` from the network's consumer-api.
 * The returned `message` is the canonical SIWE string the wallet must
 * sign verbatim - do NOT reformat or strip whitespace.
 */
export async function siweChallenge(
  network: NetworkId | NetworkConfig,
  address: `0x${string}`,
  opts: { signal?: AbortSignal } = {},
): Promise<SiweChallenge> {
  const cfg = resolveNetwork(network);
  if (!cfg.consumerApi) {
    throw new Error(`siweChallenge: network "${cfg.id}" has no consumerApi configured`);
  }
  const url = `${cfg.consumerApi.replace(/\/+$/, "")}/api/auth/challenge?address=${address}`;
  return httpJson<SiweChallenge>(url, { method: "GET", signal: opts.signal });
}

/**
 * Verify a signed SIWE message and mint a JWT bearer.
 */
export async function siweVerify(
  network: NetworkId | NetworkConfig,
  args: { message: string; signature: `0x${string}` },
  opts: { signal?: AbortSignal } = {},
): Promise<SiweVerifyResult> {
  const cfg = resolveNetwork(network);
  if (!cfg.consumerApi) {
    throw new Error(`siweVerify: network "${cfg.id}" has no consumerApi configured`);
  }
  const url = `${cfg.consumerApi.replace(/\/+$/, "")}/api/auth/verify`;
  const out = await httpJson<SiweVerifyResult>(url, {
    method: "POST",
    body: { message: args.message, signature: args.signature },
    signal: opts.signal,
  });
  if (!out.success || !out.token) {
    throw new Error("siweVerify: gateway returned success=false or missing token");
  }
  return out;
}

/**
 * Extract a SIWE message's `Expiration Time` (ISO-8601) and convert to a
 * unix-ms timestamp. Best-effort: returns null if the field is absent or
 * unparseable.
 */
function parseExpiry(message: string): number | null {
  const m = message.match(/Expiration Time:\s*(\S+)/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

/**
 * End-to-end SIWE sign-in: challenge -> sign -> verify -> JWT.
 *
 * ```ts
 * import { siweSignIn, GatewayClient } from "lightnode-sdk";
 * // browser: walletClient from wagmi's useWalletClient().data
 * const session = await siweSignIn(walletClient, "testnet");
 * const gateway = new GatewayClient({ network: "testnet", bearer: session.bearer });
 * // ... use the gateway normally (runInference, selectSession, etc.)
 * ```
 *
 * Pass `address` explicitly when the wallet client cannot expose its own
 * account (some viem clients are intentionally accountless).
 */
export async function siweSignIn(
  walletClient: SiweWalletClient,
  network: NetworkId | NetworkConfig,
  opts: { address?: `0x${string}`; signal?: AbortSignal } = {},
): Promise<SiweSession> {
  const cfg = resolveNetwork(network);
  const address = opts.address ?? walletClient.account?.address;
  if (!address) {
    throw new Error("siweSignIn: walletClient has no account; pass `address` explicitly");
  }
  const { message } = await siweChallenge(cfg, address, { signal: opts.signal });
  // viem's signMessage requires `account` even when one is set on the
  // client; passing it explicitly works with both wagmi and bare viem.
  const signature = await walletClient.signMessage({
    account: walletClient.account?.address ?? address,
    message,
  });
  const verified = await siweVerify(cfg, { message, signature }, { signal: opts.signal });
  const token = verified.token;
  return {
    token,
    address: verified.address ?? address,
    network: cfg.id,
    expiresAt: parseExpiry(message),
    bearer: () => token,
  };
}
