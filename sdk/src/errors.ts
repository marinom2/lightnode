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

/** Convenience predicate so callers don't need `instanceof` if they don't want it. */
export function isStalledWorker(e: unknown): e is StalledWorkerError {
  return e instanceof StalledWorkerError;
}
