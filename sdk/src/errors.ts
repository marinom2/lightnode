/**
 * Typed errors thrown by the high-level helpers (`runInference`, gateway calls
 * inside `prepareSession`, etc.). Catching by class lets callers branch on the
 * failure mode cleanly instead of regexing message strings.
 */

/**
 * The dispatcher picked a worker and the on-chain `submitJob` succeeded, but the
 * worker never emitted `JobCompleted` inside the deadline. The protocol times
 * out and refunds the escrowed fee after its dispute window (a few hours on
 * testnet, ~24h on mainnet); the consumer does not need to call any timeoutJob.
 *
 * Re-running creates a NEW session with a different worker - the assignment is
 * stochastic, so a retry almost always lands on a healthy one.
 */
export class StalledWorkerError extends Error {
  readonly jobId: bigint;
  readonly worker: `0x${string}`;
  readonly submitTx: `0x${string}`;
  readonly feeLcai: number;
  constructor(args: { jobId: bigint; worker: `0x${string}`; submitTx: `0x${string}`; feeLcai: number }) {
    super(
      `worker stalled (jobId=${args.jobId} worker=${args.worker}): no JobCompleted inside the deadline. The protocol will refund the ${args.feeLcai} LCAI fee after the dispute window.`,
    );
    this.name = "StalledWorkerError";
    this.jobId = args.jobId;
    this.worker = args.worker;
    this.submitTx = args.submitTx;
    this.feeLcai = args.feeLcai;
  }
}

/**
 * The on-chain `createSession` or `submitJob` reverted with a contract-level
 * error (NOT a "wallet too poor for gas" error, which surfaces as a viem error
 * before the tx broadcasts). Surfaces the function name and tx hash so the
 * caller can inspect on the explorer.
 */
export class OnChainRevertError extends Error {
  readonly fn: "createSession" | "submitJob";
  readonly tx: `0x${string}`;
  constructor(fn: "createSession" | "submitJob", tx: `0x${string}`) {
    super(`${fn} reverted on-chain (tx=${tx})`);
    this.name = "OnChainRevertError";
    this.fn = fn;
    this.tx = tx;
  }
}

/**
 * The relay token endpoint never returned a usable token inside the poll window.
 * Usually means the gateway dispatcher couldn't finalise the session - rare in
 * practice. Re-running creates a fresh session.
 */
export class RelayTokenTimeoutError extends Error {
  constructor() {
    super("the gateway never issued a relay token for this session (poll timed out)");
    this.name = "RelayTokenTimeoutError";
  }
}

/**
 * Authentication or authorisation issue with the consumer gateway - the caller
 * passed a bad/expired JWT, or the upstream rejected the SIWE handshake.
 */
export class GatewayAuthError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`gateway auth failed (${status}): ${body.slice(0, 200)}`);
    this.name = "GatewayAuthError";
    this.status = status;
  }
}

/**
 * The caller's `AbortSignal` fired, so the SDK stopped awaiting the relay /
 * on-chain proof and bailed out. Any `submitJob` already broadcast still settles
 * on chain (the protocol is the source of truth); the SDK just stops listening.
 *
 * `name` is the web-standard `"AbortError"`, so code that already branches on
 * `e.name === "AbortError"` (the same convention `fetch` uses) keeps working,
 * while `instanceof InferenceAbortedError` / `isAbortError(e)` give a typed path.
 */
export class InferenceAbortedError extends Error {
  /** Where in the flow the abort was observed (e.g. "relay-token", "job-completed"). */
  readonly stage: string;
  constructor(stage: string) {
    super(`inference aborted (${stage})`);
    this.name = "AbortError";
    this.stage = stage;
  }
}

/** Convenience predicate so callers don't need `instanceof` if they don't want it. */
export function isStalledWorker(e: unknown): e is StalledWorkerError {
  return e instanceof StalledWorkerError;
}

/** True for an abort raised by a fired `AbortSignal` (matches `name === "AbortError"`). */
export function isAbortError(e: unknown): e is Error {
  return e instanceof InferenceAbortedError || (e instanceof Error && e.name === "AbortError");
}

export type ErrorKind =
  | "stalled"
  | "revert"
  | "relay-timeout"
  | "auth"
  | "aborted"
  | "insufficient-funds"
  | "rejected"
  | "network"
  | "unknown";

/**
 * A structured, builder-facing remediation for any error thrown by the inference
 * flow - so a dApp writing its own catch block gets actionable guidance instead
 * of a raw message to regex. Pure; pass the live dispute window for exact refund
 * timing.
 */
export interface ErrorExplanation {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** Is the consumer's LCAI safe / will it refund automatically? */
  fundsSafe: boolean;
  /** Does re-running help (e.g. a fresh session picks a different worker)? */
  retryable: boolean;
  /** The exact next action to take. */
  nextStep: string;
  jobId?: string;
  tx?: `0x${string}`;
}

function refundPhrase(refundWindowSec?: number): string {
  if (refundWindowSec && refundWindowSec > 0) {
    const h = refundWindowSec / 3600;
    return h >= 1 ? `after the ~${h.toFixed(0)}h dispute window` : `after the ~${Math.round(refundWindowSec / 60)}m dispute window`;
  }
  return "after the protocol's dispute window (a few hours on testnet, ~24h on mainnet)";
}

/**
 * Map any thrown value from the inference flow to a structured {@link ErrorExplanation}.
 * Recognises every typed SDK error plus the common viem/wallet message cases.
 * Read-only and pure - safe to call inside a UI or a catch block. For exact
 * refund timing on a stall, pass `refundWindowSec` (e.g. from `config()`).
 */
export function explainInferenceError(e: unknown, opts: { refundWindowSec?: number } = {}): ErrorExplanation {
  if (e instanceof StalledWorkerError) {
    return {
      kind: "stalled",
      title: "Worker stalled - fee auto-refunds",
      detail: `The assigned worker accepted the job but never produced a result. The protocol times it out and refunds your ${e.feeLcai} LCAI ${refundPhrase(opts.refundWindowSec)} - you do NOT need to call timeoutJob.`,
      fundsSafe: true,
      retryable: true,
      nextStep: "Re-run: a fresh session is assigned a different worker (assignment is stochastic, so a retry almost always lands on a healthy one).",
      jobId: e.jobId.toString(),
      tx: e.submitTx,
    };
  }
  if (e instanceof OnChainRevertError) {
    return {
      kind: "revert",
      title: `${e.fn} reverted on-chain`,
      detail: `The ${e.fn} transaction reverted with a contract-level error. ${e.fn === "createSession" ? "No fee was escrowed." : "The escrow is released by the revert."} Open the tx on the explorer for the exact reason.`,
      fundsSafe: true,
      retryable: e.fn === "createSession",
      nextStep: e.fn === "submitJob" ? "Check your stake/balance and that the model is enabled, then retry." : "Inspect the tx on the explorer; retry if it was a transient nonce/gas issue.",
      tx: e.tx,
    };
  }
  if (e instanceof RelayTokenTimeoutError) {
    return {
      kind: "relay-timeout",
      title: "Relay token never issued",
      detail: "The gateway didn't finalise the session (no relay token inside the poll window) - usually a transient dispatcher hiccup. No inference fee was charged.",
      fundsSafe: true,
      retryable: true,
      nextStep: "Re-run to open a fresh session.",
    };
  }
  if (e instanceof GatewayAuthError) {
    return {
      kind: "auth",
      title: "Gateway authentication failed",
      detail: e.status === 401 ? "Your sign-in token is missing or expired." : `The gateway rejected the request (HTTP ${e.status}).`,
      fundsSafe: true,
      retryable: true,
      nextStep: "Re-run the SIWE sign-in for a fresh bearer token, then retry.",
    };
  }
  if (isAbortError(e)) {
    return {
      kind: "aborted",
      title: "Inference aborted",
      detail: "The request was cancelled via its AbortSignal. If submitJob had already broadcast, that job still settles on-chain; the SDK just stopped listening.",
      fundsSafe: true,
      retryable: true,
      nextStep: "Re-run when ready.",
    };
  }
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (/user rejected|user denied|denied transaction|rejected the request/i.test(msg)) {
    return {
      kind: "rejected",
      title: "Signature rejected",
      detail: "You declined the request in your wallet; nothing was charged.",
      fundsSafe: true,
      retryable: true,
      nextStep: "Re-run and approve the prompt in your wallet.",
    };
  }
  if (/insufficient funds|exceeds the balance|gas \* price/i.test(msg)) {
    return {
      kind: "insufficient-funds",
      title: "Not enough LCAI for fee + gas",
      detail: "Your wallet can't cover the inference fee plus gas.",
      fundsSafe: true,
      retryable: true,
      nextStep: "Top up the wallet (use the faucet on testnet) and retry.",
    };
  }
  if (/failed to fetch|fetch failed|enotfound|econn|network error/i.test(msg)) {
    return {
      kind: "network",
      title: "Network error",
      detail: "Could not reach the gateway or RPC endpoint.",
      fundsSafe: true,
      retryable: true,
      nextStep: "Check connectivity and retry.",
    };
  }
  return {
    kind: "unknown",
    title: "Unexpected error",
    detail: (msg || "An unrecognised error occurred.").split("\n")[0].slice(0, 200),
    fundsSafe: true,
    retryable: true,
    nextStep: "Retry; if it persists, paste any revert data into the decoder below to identify the contract error.",
  };
}
