import { runInferenceWithKey, type RunInferenceWithKeyArgs, type RunInferenceResult } from "./inference.js";
import { StalledWorkerError } from "./errors.js";

/**
 * One slot in a batch run. `prompt` is the only required field; everything
 * else inherits from the shared base args passed to `runInferenceBatch`.
 * A per-prompt `model` / `system` overrides the base when set.
 */
export interface BatchPrompt {
  prompt: string;
  model?: string;
  system?: string;
  /** Opaque per-slot tag returned on the result so the caller can correlate. */
  tag?: string;
}

/** One slot's outcome. `error` is set on failure; `result` on success. Always exactly one. */
export type BatchResult =
  | {
      index: number;
      tag?: string;
      prompt: string;
      result: RunInferenceResult;
      error: null;
    }
  | {
      index: number;
      tag?: string;
      prompt: string;
      result: null;
      error: { name: string; message: string; jobId?: string };
    };

export interface RunInferenceBatchArgs extends Omit<RunInferenceWithKeyArgs, "prompt"> {
  /** Prompts to run. Each slot becomes one independent encrypted inference. */
  prompts: ReadonlyArray<string | BatchPrompt>;
  /**
   * Shared system prompt prepended to every slot. A per-slot `system`
   * overrides this. Implemented by prefixing the prompt at submit time
   * (the underlying inference call has no native system role).
   */
  system?: string;
  /**
   * Max parallel inferences in flight (default 4). Each slot is one
   * createSession + submitJob pair, so this caps the concurrent wallet
   * nonce pressure as well as the gateway socket fan-out.
   */
  concurrency?: number;
  /**
   * Called when ANY slot resolves (success or failure), useful for live
   * progress UI. Fires in order of completion, not submission.
   */
  onSlotComplete?: (result: BatchResult) => void;
  /**
   * When set, abort all in-flight + queued slots if this signal fires.
   * Slots already submitted on chain still settle on chain; the SDK just
   * stops awaiting their answer.
   */
  signal?: AbortSignal;
}

/**
 * Run many prompts as parallel encrypted inferences against the same
 * worker pool. Returns a stable array indexed by submission order.
 *
 * Slots fail independently - a stalled worker on one prompt does not
 * cancel the others. The caller decides what to retry from the per-slot
 * error.
 *
 * @example
 * ```ts
 * import { runInferenceBatch } from "lightnode-sdk";
 *
 * const results = await runInferenceBatch({
 *   network: "testnet",
 *   privateKey: process.env.PRIVATE_KEY!,
 *   model: "llama3-8b",
 *   prompts: ["one", "two", "three"],
 *   concurrency: 3,
 *   onSlotComplete: ({ index, result, error }) => {
 *     console.log(`#${index}:`, error?.message ?? result?.answer);
 *   },
 * });
 *
 * for (const r of results) {
 *   if (r.error) console.warn(`slot ${r.index} failed:`, r.error.message);
 *   else console.log(r.result.answer);
 * }
 * ```
 */
export async function runInferenceBatch(args: RunInferenceBatchArgs): Promise<BatchResult[]> {
  const concurrency = Math.max(1, args.concurrency ?? 4);
  const slots: BatchPrompt[] = args.prompts.map((p) => (typeof p === "string" ? { prompt: p } : p));
  const out: BatchResult[] = new Array(slots.length);

  let nextIndex = 0;
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
  };
  if (args.signal) {
    if (args.signal.aborted) aborted = true;
    else args.signal.addEventListener("abort", onAbort, { once: true });
  }

  const runOne = async (index: number): Promise<void> => {
    if (aborted) {
      out[index] = {
        index,
        tag: slots[index].tag,
        prompt: slots[index].prompt,
        result: null,
        error: { name: "AbortError", message: "batch aborted before this slot ran" },
      };
      return;
    }
    const slot = slots[index];
    try {
      const system = slot.system ?? args.system;
      const finalPrompt = system ? `${system.trim()}\n\n${slot.prompt}` : slot.prompt;
      // Strip batch-only fields before passing through to runInferenceWithKey.
      const passthrough = { ...args } as Partial<RunInferenceBatchArgs>;
      delete passthrough.prompts;
      delete passthrough.system;
      delete passthrough.concurrency;
      delete passthrough.onSlotComplete;
      const result = await runInferenceWithKey({
        ...(passthrough as RunInferenceWithKeyArgs),
        prompt: finalPrompt,
        model: slot.model ?? args.model,
      });
      out[index] = { index, tag: slot.tag, prompt: slot.prompt, result, error: null };
    } catch (err) {
      const e = err as Error & { jobId?: bigint };
      const jobId = e instanceof StalledWorkerError ? e.jobId.toString() : undefined;
      out[index] = {
        index,
        tag: slot.tag,
        prompt: slot.prompt,
        result: null,
        error: { name: e.name ?? "Error", message: e.message, jobId },
      };
    }
    args.onSlotComplete?.(out[index]);
  };

  // N parallel workers pulling off the queue. Order of completion is
  // non-deterministic, order of OUTPUT is stable via `index`.
  const workers = new Array(Math.min(concurrency, slots.length)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= slots.length) return;
      await runOne(i);
    }
  });
  await Promise.all(workers);
  if (args.signal) args.signal.removeEventListener("abort", onAbort);
  return out;
}
