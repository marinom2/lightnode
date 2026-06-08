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

// In browser-like contexts the gateway's CORS policy blocks third-party
// origins, so the SDK routes through lightnode.app's public proxy instead.
// The proxy is a thin pass-through (no state, no transformation), open to
// any origin. In a real Node process this isn't needed - the gateway is
// reached directly.
const PROXY_HOSTS = {
  mainnet: "https://lightnode.app/api/gw/mainnet",
  testnet: "https://lightnode.app/api/gw/testnet",
} as const;

/**
 * True when the current runtime is a browser, or a Node-in-browser shim
 * (StackBlitz WebContainer, Bolt, etc.) where `fetch` enforces browser-style
 * CORS. Used to decide whether to call the gateway direct or via the proxy.
 */
function looksLikeBrowserFetch(): boolean {
  if (typeof window !== "undefined" && typeof document !== "undefined") return true;
  // StackBlitz WebContainer exposes `process.versions.webcontainer`. Other
  // Node-in-browser runtimes (Bolt, RunKit) may not, so we also check for
  // the absence of a real Node TCP module via `process.versions.node` PLUS
  // the presence of a global `WebSocket` (browser-only by spec).
  const wc = (globalThis as { process?: { versions?: Record<string, string> } }).process?.versions?.webcontainer;
  if (wc) return true;
  return false;
}

/**
 * Default gateway URL for a network. In Node, returns the gateway directly.
 * In browser/WebContainer, returns the lightnode.app proxy (same upstream,
 * but with permissive CORS so third-party origins work).
 */
export function consumerGatewayUrl(net: "mainnet" | "testnet"): string {
  return looksLikeBrowserFetch() ? PROXY_HOSTS[net] : GATEWAY_HOSTS[net];
}

/** Gateway host without any proxy fallback. For diagnostics / advanced callers. */
export function consumerGatewayHost(net: "mainnet" | "testnet"): string {
  return GATEWAY_HOSTS[net];
}

/**
 * Either a fixed token, or a function that produces one. The function form is
 * called fresh on every request, so a thunk that caches-and-rotates handles
 * proactive expiry. It also receives `{ forceRefresh: true }` when the gateway
 * rejected the previous token with a 401 - return a newly-minted token in that
 * case (re-run SIWE) to recover from a server-side revocation or clock skew
 * without the caller catching the error. A static-string bearer cannot refresh,
 * so a 401 against it surfaces immediately.
 */
export type BearerSource = string | ((opts?: { forceRefresh?: boolean }) => string | Promise<string>);

async function resolveBearer(src: BearerSource, forceRefresh = false): Promise<string> {
  return typeof src === "function" ? await src({ forceRefresh }) : src;
}

export class GatewayHttpError extends Error {
  readonly status: number;
  readonly body: string;
  /** The server's Retry-After (ms), when it sent one on a 429/503. */
  readonly retryAfterMs?: number;
  constructor(status: number, body: string, retryAfterMs?: number) {
    super(`gateway ${status}: ${body.slice(0, 200)}`);
    this.name = "GatewayHttpError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
  /** 429 - the caller is being rate-limited; back off (respect retryAfterMs). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  /** 401/403 - the bearer is missing/expired/insufficient; re-auth, don't retry. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
  /** 5xx - a transient server fault; safe to retry with backoff. */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/** Parse an HTTP Retry-After header (delta-seconds or an HTTP date) to ms. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
  /**
   * Opaque correlation token added by the dispatcher in May 2026
   * (lcai-chat-v2 commit 33c70841, web-search epic / Story 16). The client
   * MUST echo it back to `prepareSession` so a later capability-aware
   * select cannot overwrite our pending slot. Optional for forward-compat
   * with older dispatchers that predate the token.
   *
   * Without this, any concurrent activity for the same wallet produces a
   * 409 selection_mismatch on prepare.
   */
  selectionId?: string;
  /** Worker capabilities reported by the dispatcher (web-search etc.). */
  workerCapabilities?: string[];
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
  /**
   * Auto-retry with exponential backoff, honoring a Retry-After header when
   * present. A 429 is retried for any method (the request was rejected before
   * any work); a 5xx is retried only for GETs (replaying a POST could duplicate
   * a side-effect). Defaults: maxRetries 2, baseDelayMs 500. Set maxRetries 0 to
   * disable.
   */
  retry?: { maxRetries?: number; baseDelayMs?: number };
}

/**
 * Thin HTTP client. Methods throw `GatewayHttpError` on non-2xx; protected
 * methods throw if no `bearer` was configured.
 */
export class GatewayClient {
  readonly baseUrl: string;
  private readonly bearer?: BearerSource;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(opts: GatewayClientOptions) {
    const net = typeof opts.network === "string" ? opts.network : opts.network.id;
    this.baseUrl = (opts.baseUrl ?? consumerGatewayUrl(net)).replace(/\/+$/, "");
    this.bearer = opts.bearer;
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.maxRetries = opts.retry?.maxRetries ?? 2;
    this.baseDelayMs = opts.retry?.baseDelayMs ?? 500;
  }

  /** Public: registered models the gateway will accept. */
  getModels(): Promise<{ models: { id: string; name: string }[] }> {
    return this.req("GET", "/api/models");
  }

  /** Protected: dispatcher picks a worker for a session and returns its pubkey.
   *  Pass requiredCapabilities (e.g. ["search"]) to bind only to a worker that
   *  advertises them. */
  selectSession(modelId: `0x${string}`, opts?: { requiredCapabilities?: string[] }): Promise<SelectSessionResult> {
    const body: Record<string, unknown> = { modelId };
    if (opts?.requiredCapabilities && opts.requiredCapabilities.length > 0) {
      body.requiredCapabilities = opts.requiredCapabilities;
    }
    return this.req("POST", "/api/sessions/select", body);
  }

  /** Public: union of capabilities advertised by active workers for a model
   *  (e.g. ["search"]). Used to gate UI before a session binds. Note: this
   *  endpoint may 404 on networks where consumer-api hasn't deployed it yet. */
  getModelCapabilities(modelIdHex: `0x${string}`): Promise<{ modelId: string; capabilities: string[] }> {
    return this.req("GET", `/api/models/${modelIdHex}/capabilities`);
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
    /**
     * Correlation token from {@link SelectSessionResult.selectionId}. Required
     * by the May 2026 dispatcher to avoid 409 selection_mismatch when a newer
     * select for the same wallet has overwritten the pending slot.
     */
    selectionId?: string;
    requiredCapabilities?: string[];
  }): Promise<PrepareSessionResult> {
    return this.req("POST", "/api/sessions/prepare", input);
  }

  /** Protected: upload an encrypted prompt blob; returns the EIP-4844 blob hash.
   *  Pass { searchEnabled: true } to opt this job into worker-side web search. */
  uploadBlob(base64Data: string, opts?: { searchEnabled?: boolean }): Promise<UploadBlobResult> {
    const body: Record<string, unknown> = { data: base64Data };
    if (opts?.searchEnabled === true) body.searchEnabled = true;
    return this.req("POST", "/api/blobs", body);
  }

  /** Protected: fetch the relay JWT for an active session (202 = pending). */
  getSessionToken(sessionId: number): Promise<SessionTokenResult> {
    return this.req("GET", `/api/sessions/${sessionId}/token`);
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    // Retry policy by failure type:
    //  - 429 (rate-limited): the request was rejected BEFORE any work, so it's
    //    safe to retry for any method.
    //  - 5xx (transient server fault): only retry GETs. A 5xx on a POST may mean
    //    the upstream DID process it but the response was lost - re-sending a POST
    //    selectSession would make a SECOND wallet-scoped selection (the exact
    //    duplicate-select race the SDK avoids with selectionId). Better to surface
    //    the error than risk a double side-effect.
    // Auth: a 401 against a FUNCTION bearer triggers one force-refresh retry
    // (the token may have been revoked server-side before its local expiry); a
    // static-string bearer can't refresh, so its 401 surfaces immediately. Other
    // 4xx (403 included) are never retried - they won't fix themselves.
    let authRefreshed = false;
    let forceRefresh = false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.bearer != null) headers["Authorization"] = `Bearer ${await resolveBearer(this.bearer, forceRefresh)}`;
      forceRefresh = false; // consumed by this request
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      // 202 = the session-token endpoint is still pending; surface its body as JSON.
      // Tolerate an empty 2xx/202 body (some "Accepted, nothing yet" responses send
      // none) - res.json() would throw SyntaxError and abort the poll otherwise.
      if (res.status === 202 || res.ok) {
        const t = await res.text();
        return (t ? JSON.parse(t) : {}) as T;
      }

      const text = await res.text().catch(() => "");
      const retryAfterMs = parseRetryAfterMs(res.headers?.get?.("retry-after") ?? null);
      // Reactive token refresh: ask the bearer thunk for a fresh token exactly
      // once, then replay. Independent of the backoff budget below.
      if (res.status === 401 && typeof this.bearer === "function" && !authRefreshed) {
        authRefreshed = true;
        forceRefresh = true;
        continue;
      }
      const retryable = res.status === 429 || (res.status >= 500 && method === "GET");
      if (retryable && attempt < this.maxRetries) {
        // A non-positive Retry-After is not a useful hint; fall back to backoff.
        const waitMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : this.baseDelayMs * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }
      throw new GatewayHttpError(res.status, text, retryAfterMs);
    }
  }
}
