import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWorker, DEFAULT_SUBGRAPH_TIMEOUT_MS } from "../../sdk/src/subgraph";
import { NETWORKS } from "../../sdk/src/networks";

const CFG = NETWORKS.mainnet;
const ADDR = "0x1111111111111111111111111111111111111111";

/** A fetch that never resolves on its own; it only rejects when the AbortSignal fires. */
function abortAwareHangingFetch(): typeof fetch {
  const fn = (_url: string, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // hangs forever - the test would time out, which is the failure we want to avoid
      if (signal.aborted) return reject(abortError());
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  return fn as unknown as typeof fetch;
}

function abortError(): Error {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
}

describe("subgraph configurable read timeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes the built-in default", () => {
    expect(DEFAULT_SUBGRAPH_TIMEOUT_MS).toBe(12_000);
  });

  it("aborts after the supplied timeoutMs and reports it in the error", async () => {
    vi.stubGlobal("fetch", abortAwareHangingFetch());
    await expect(fetchWorker(CFG, ADDR, 15)).rejects.toThrow(/subgraph timeout after 15ms/);
  });
});
