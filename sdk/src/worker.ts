/**
 * SDK-level worker preflight + watch.
 *
 * The desktop app already has local worker-health parsers (parseWorkerHealth,
 * parseSpeedTest) that need shell access to the running container. Those are
 * great for operators ON the worker box, but useless for a builder watching
 * the network from anywhere else.
 *
 * This module fills the remote-only gap:
 *   - `preflight()` runs ONE real test inference against the live network
 *     and returns a verdict (works / over-deadline / failed). This is the
 *     "test job before joining a worker pool" the community has been asking
 *     for; works from any machine with a funded wallet.
 *   - `watch()` polls a worker's on-chain + indexer status on a fixed
 *     interval and yields an event each time the status meaningfully
 *     changes (registered <-> deregistered, last-seen went stale, completion
 *     rate dropped). Suitable for a CI gate or a `cron` job.
 *
 * Both are pure SDK calls. No Docker, no SSH, no privileged access.
 */

import { runInferenceWithKey, type RunInferenceWithKeyArgs } from "./inference.js";
import { LightNode } from "./index.js";
import { isStalledWorker } from "./errors.js";

// =============================================================================
// preflight() - submit one real test inference, report verdict.
// =============================================================================

export interface WorkerPreflightArgs extends Omit<RunInferenceWithKeyArgs, "prompt"> {
  /**
   * Prompt to send. Defaults to a tiny, deterministic prompt so the test is
   * cheap (one short answer is enough to verify the round trip).
   */
  prompt?: string;
  /**
   * Verdict deadline. If the inference takes longer than this many ms but
   * still completes, the verdict is "over-deadline" instead of "ok". Default
   * 60s, matching the protocol's typical good-worker p95.
   */
  deadlineMs?: number;
}

export interface WorkerPreflightResult {
  verdict: "ok" | "over-deadline" | "stalled" | "failed";
  /** Total elapsed milliseconds from the first SDK call to the decrypted answer. */
  elapsedMs: number;
  /** Plain-English summary suitable for printing to a CLI or alerting. */
  summary: string;
  /** The actual decrypted answer (may be empty on failure). */
  answer: string;
  /** Address of the dispatcher-assigned worker that produced (or failed) the response. */
  worker: `0x${string}` | null;
  /** On-chain receipts. `jobCompleted` may be null when the WS delivered the answer but the on-chain event is still propagating. */
  txs: {
    createSession: `0x${string}` | null;
    submitJob: `0x${string}` | null;
    jobCompleted: `0x${string}` | null;
  };
  /** Underlying error if the test did not complete cleanly. */
  error: string | null;
}

const DEFAULT_PROMPT = "Reply with the single word OK.";

/**
 * Run one real encrypted inference against the live network and classify
 * the result. Useful as a CI gate ("did the wallet survive a real call this
 * deploy?") or as a pre-join check for a worker operator who wants to test
 * the protocol path before staking.
 */
export async function preflight(args: WorkerPreflightArgs): Promise<WorkerPreflightResult> {
  const deadlineMs = args.deadlineMs ?? 60_000;
  const prompt = args.prompt ?? DEFAULT_PROMPT;
  const t0 = Date.now();
  try {
    const r = await runInferenceWithKey({ ...args, prompt });
    const elapsedMs = Date.now() - t0;
    const verdict: WorkerPreflightResult["verdict"] = elapsedMs > deadlineMs ? "over-deadline" : "ok";
    return {
      verdict,
      elapsedMs,
      summary:
        verdict === "ok"
          ? `OK in ${(elapsedMs / 1000).toFixed(1)}s. Worker ${r.worker} replied with ${r.answer.length} chars.`
          : `Answer arrived but took ${(elapsedMs / 1000).toFixed(1)}s, over the ${(deadlineMs / 1000).toFixed(0)}s deadline.`,
      answer: r.answer,
      worker: r.worker,
      txs: r.txs,
      error: null,
    };
  } catch (e) {
    const elapsedMs = Date.now() - t0;
    if (isStalledWorker(e)) {
      return {
        verdict: "stalled",
        elapsedMs,
        summary: "All retry attempts stalled (workers never produced an answer). Protocol refunds the fees automatically.",
        answer: "",
        worker: null,
        txs: { createSession: null, submitJob: null, jobCompleted: null },
        error: (e as Error).message,
      };
    }
    return {
      verdict: "failed",
      elapsedMs,
      summary: `Test inference failed: ${(e as Error).message}`,
      answer: "",
      worker: null,
      txs: { createSession: null, submitJob: null, jobCompleted: null },
      error: (e as Error).message,
    };
  }
}

// =============================================================================
// watch() - poll worker status, emit events on meaningful change.
// =============================================================================

export interface WorkerWatchOptions {
  /** Polling interval in milliseconds. Default 30s. Indexer / RPC usage scales linearly. */
  intervalMs?: number;
  /**
   * Mark the worker as "stale" when its last_seen_at is older than this many
   * seconds. Default 90 (matches the worker daemon's heartbeat cadence + grace).
   */
  staleSecs?: number;
  /**
   * Stop polling automatically after this many events. Default Infinity (the
   * caller controls lifetime via the returned `stop()` function).
   */
  maxEvents?: number;
}

export type WorkerEventKind =
  | "snapshot" // first reading after watch started
  | "registered" // off -> on
  | "deregistered" // on -> off
  | "went-stale" // active -> stale
  | "back-online" // stale -> active
  | "jobs-completed" // jobs_completed increased
  | "earnings-up"; // total_earned increased

export interface WorkerEvent {
  kind: WorkerEventKind;
  at: number; // unix ms when the event was detected
  worker: string;
  network: "mainnet" | "testnet";
  /** Snapshot of the worker at the moment the event was raised. */
  state: {
    registered: boolean | null;
    lastSeenSecsAgo: number | null;
    jobsCompleted: number | null;
    earningsLcai: number;
    activeJobs: number | null;
    isStale: boolean;
  };
}

export interface WorkerWatchHandle {
  /** AsyncIterable of events; consume with `for await (const e of handle.events) ...`. */
  events: AsyncIterable<WorkerEvent>;
  /** Stop polling and end the iterator gracefully. */
  stop: () => void;
}

/**
 * Poll one worker's on-chain + indexer status and yield an event each time
 * something meaningful changes (registration, staleness, completed-jobs
 * counter, earnings). Runs until `handle.stop()` is called or `maxEvents`
 * is reached.
 */
export function watch(ln: LightNode, address: string, opts: WorkerWatchOptions = {}): WorkerWatchHandle {
  const intervalMs = opts.intervalMs ?? 30_000;
  const staleSecs = opts.staleSecs ?? 90;
  const maxEvents = opts.maxEvents ?? Number.POSITIVE_INFINITY;
  const networkId = ln.network.label.toLowerCase().includes("mainnet") ? "mainnet" : "testnet";

  const queue: WorkerEvent[] = [];
  const waiters: Array<(v: IteratorResult<WorkerEvent>) => void> = [];
  let stopped = false;
  let eventCount = 0;
  let prevReg: boolean | null = null;
  let prevStale: boolean | null = null;
  let prevJobs: number | null = null;
  let prevEarn: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const push = (kind: WorkerEventKind, state: WorkerEvent["state"]) => {
    const event: WorkerEvent = { kind, at: Date.now(), worker: address, network: networkId, state };
    eventCount++;
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      if (resolve) resolve({ value: event, done: false });
    } else {
      queue.push(event);
    }
    if (eventCount >= maxEvents) stop();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      if (resolve) resolve({ value: undefined, done: true });
    }
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const [reg, worker] = await Promise.all([ln.isRegistered(address), ln.getWorker(address)]);
      const now = Math.floor(Date.now() / 1000);
      const lastSeenSecsAgo = worker?.last_seen_at != null ? Math.max(0, now - worker.last_seen_at) : null;
      const isStale = lastSeenSecsAgo == null ? false : lastSeenSecsAgo > staleSecs;
      const jobs = worker?.jobs_completed ?? null;
      const earn = worker ? Number(BigInt(worker.total_earned ?? "0")) / 1e18 : 0;
      const state: WorkerEvent["state"] = {
        registered: reg,
        lastSeenSecsAgo,
        jobsCompleted: jobs,
        earningsLcai: earn,
        activeJobs: worker?.active_job_count ?? null,
        isStale,
      };
      // First poll: emit a snapshot so the caller always sees an initial event.
      if (prevReg === null && prevStale === null && prevJobs === null && prevEarn === null) {
        push("snapshot", state);
      } else {
        if (prevReg === false && reg === true) push("registered", state);
        if (prevReg === true && reg === false) push("deregistered", state);
        if (prevStale === false && isStale) push("went-stale", state);
        if (prevStale === true && !isStale) push("back-online", state);
        if (jobs != null && prevJobs != null && jobs > prevJobs) push("jobs-completed", state);
        if (earn > (prevEarn ?? 0) + 1e-9) push("earnings-up", state);
      }
      prevReg = reg;
      prevStale = isStale;
      prevJobs = jobs;
      prevEarn = earn;
    } catch {
      // Transient indexer / RPC error - do nothing, the next poll will retry.
    }
    if (!stopped) timer = setTimeout(poll, intervalMs);
  };

  // Kick off the first poll immediately.
  void poll();

  return {
    events: {
      [Symbol.asyncIterator](): AsyncIterator<WorkerEvent> {
        return {
          async next(): Promise<IteratorResult<WorkerEvent>> {
            if (queue.length > 0) return { value: queue.shift()!, done: false };
            if (stopped) return { value: undefined, done: true };
            return new Promise<IteratorResult<WorkerEvent>>((resolve) => waiters.push(resolve));
          },
        };
      },
    },
    stop,
  };
}
