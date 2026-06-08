import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runJobOnSession,
  runInferenceWithKey,
  InferenceAbortedError,
  isAbortError,
  type OpenSession,
} from "../../sdk/src/index";

// A minimal OpenSession whose gateway keeps reporting the relay token as pending,
// so the only way runJobOnSession ends is via the abort signal (or the 20s
// deadline, which the prompt cancellation must beat).
function pendingSession(onTokenPoll?: () => void): OpenSession {
  const gateway = {
    async getSessionToken() {
      onTokenPoll?.();
      return { status: "pending" as const };
    },
  };
  return {
    gateway,
    wallet: {},
    publicClient: {},
    network: { id: "testnet" },
    sessionId: 1n,
    sessionKey: {},
    worker: "0x0000000000000000000000000000000000000000",
    fee: 0,
    createTx: "0x",
  } as unknown as OpenSession;
}

describe("runJobOnSession mid-stream cancellation", () => {
  it("throws immediately when the signal is already aborted at the start", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(runJobOnSession(pendingSession(), "hi", { signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
      stage: "start",
    });
  });

  it("aborts the relay-token poll promptly instead of running out the 20s deadline", async () => {
    const ac = new AbortController();
    // Abort on the first token poll: the next abortableSleep must reject at once.
    const session = pendingSession(() => ac.abort());
    const started = Date.now();
    await expect(runJobOnSession(session, "hi", { signal: ac.signal })).rejects.toMatchObject({
      name: "AbortError",
      stage: "relay-token",
    });
    // Far below the 20s relay-token deadline - proves the loop honored the signal.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("isAbortError recognizes the typed error and the name convention", () => {
    expect(isAbortError(new InferenceAbortedError("relay-token"))).toBe(true);
    const plain = new Error("x");
    plain.name = "AbortError";
    expect(isAbortError(plain)).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
  });
});

describe("runInferenceWithKey SIWE-stage cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-raises a SIWE-stage fetch abort as a typed AbortError (not a host-unreachable wrap)", async () => {
    // The first network touch is the SIWE challenge fetch; make it abort.
    vi.stubGlobal("fetch", async () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    });
    const ac = new AbortController();
    let caught: unknown;
    try {
      await runInferenceWithKey({
        network: "testnet",
        privateKey: "0x" + "1".repeat(64),
        prompt: "hi",
        signal: ac.signal,
      });
    } catch (e) {
      caught = e;
    }
    expect(isAbortError(caught)).toBe(true);
    expect((caught as InferenceAbortedError).stage).toBe("siwe");
  });
});
