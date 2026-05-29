/**
 * HTTP client for the LightChain consumer gateway (a.k.a. chat-api). Exposes
 * just the endpoints a third-party consumer needs to submit an inference job
 * and read its result back.
 *
 * Auth: the gateway requires a bearer JWT obtained via the consumer-api's SIWE
 * sign-in flow. The SDK does NOT bundle SIWE; the caller obtains a token (or a
 * fresh-each-call thunk) by whatever means they prefer and hands it here.
 */

import type { NetworkConfig } from "./types.js";

const GATEWAY_HOSTS = {
  mainnet: "https://chat-api.mainnet.lightchain.ai",
  testnet: "https://chat-api.testnet.lightchain.ai",
} as const;

export function consumerGatewayUrl(net: "mainnet" | "testnet"): string {
  return GATEWAY_HOSTS[net];
}

/** Either a fixed token, or a function that produces (or refreshes) one. */
export type BearerSource = string | (() => string | Promise<string>);

async function resolveBearer(src: BearerSource): Promise<string> {
  return typeof src === "function" ? await src() : src;
}

export class GatewayHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`gateway ${status}: ${body.slice(0, 200)}`);
    this.name = "GatewayHttpError";
    this.status = status;
    this.body = body;
  }
}

export interface SelectSessionResult {
  worker: `0x${string}`;
  /**
   * ECDH P-256 uncompressed public key of the selected worker. The gateway
   * historically returns this as **base64** for the worker and **hex** for the
   * disputer; the SDK's `decodePublicKey` accepts either, so callers do not need
   * to branch.
   */
  workerEncryptionKey: string;
  disputerEncryptionKey?: string;
  nonce: number;
  expiry: number;
}

export interface PrepareSessionResult {
  worker: `0x${string}`;
  /** Dispatcher EIP-712 signature authorising createSession on-chain. */
  signature: `0x${string}`;
  nonce: number;
  expiry: number;
}

export interface UploadBlobResult {
  blobHashes: `0x${string}`[];
}

export type SessionTokenResult =
  | { token: string; expiresAt: string }
  | { status: "pending"; message?: string };

export interface GatewayClientOptions {
  /** Network ('mainnet' | 'testnet') OR a verified `NetworkConfig`. */
  network: "mainnet" | "testnet" | NetworkConfig;
  /** Override the gateway base URL (rarely needed; default is consumerGatewayUrl). */
  baseUrl?: string;
  /** Bearer token (or thunk) for authenticated calls. */
  bearer?: BearerSource;
  /** Fetch override (testing). */
  fetch?: typeof fetch;
}

/**
 * Thin HTTP client. Methods throw `GatewayHttpError` on non-2xx; protected
 * methods throw if no `bearer` was configured.
 */
export class GatewayClient {
  readonly baseUrl: string;
  private readonly bearer?: BearerSource;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GatewayClientOptions) {
    const net = typeof opts.network === "string" ? opts.network : opts.network.id;
    this.baseUrl = (opts.baseUrl ?? consumerGatewayUrl(net)).replace(/\/+$/, "");
    this.bearer = opts.bearer;
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
  }

  /** Public: registered models the gateway will accept. */
  getModels(): Promise<{ models: { id: string; name: string }[] }> {
    return this.req("GET", "/api/models");
  }

  /** Protected: dispatcher picks a worker for a session and returns its pubkey. */
  selectSession(modelId: `0x${string}`): Promise<SelectSessionResult> {
    return this.req("POST", "/api/sessions/select", { modelId });
  }

  /**
   * Protected: hand the dispatcher the encrypted session key it can give the
   * worker, get back the EIP-712 signature authorising on-chain createSession.
   *
   * NOTE: the gateway expects `encWorkerKey` / `encDisputerKey` as **base64**
   * (NOT hex). The same bytes are passed as **hex** to the on-chain
   * `createSession`. The high-level `prepareSession(gateway, modelTag)` in
   * `inference.ts` handles both encodings; if you call this lower-level method
   * directly, base64-encode the wire bytes before passing them in.
   */
  prepareSession(input: {
    modelId: `0x${string}`;
    encWorkerKey: string;
    encDisputerKey: string;
  }): Promise<PrepareSessionResult> {
    return this.req("POST", "/api/sessions/prepare", input);
  }

  /** Protected: upload an encrypted prompt blob; returns the EIP-4844 blob hash. */
  uploadBlob(base64Data: string): Promise<UploadBlobResult> {
    return this.req("POST", "/api/blobs", { data: base64Data });
  }

  /** Protected: fetch the relay JWT for an active session (202 = pending). */
  getSessionToken(sessionId: number): Promise<SessionTokenResult> {
    return this.req("GET", `/api/sessions/${sessionId}/token`);
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.bearer != null) headers["Authorization"] = `Bearer ${await resolveBearer(this.bearer)}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 202) {
      // The session-token endpoint returns 202 while pending; surface as JSON.
      return (await res.json()) as T;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GatewayHttpError(res.status, text);
    }
    return (await res.json()) as T;
  }
}
