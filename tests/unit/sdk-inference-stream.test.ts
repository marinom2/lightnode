import { describe, it, expect, vi, afterEach } from "vitest";
import { runInferenceStream, runInferenceWithKey, isAbortError, NETWORKS } from "../../sdk/src/index";

const KEY = "0x" + "1".repeat(64);

describe("runInferenceStream error propagation", () => {
  it("throws a mid-stream error/abort INTO the for-await loop (not a silent done)", async () => {
    // An already-aborted signal makes the underlying inference reject; the
    // stream must surface that to a consumer iterating it, not end cleanly.
    const ac = new AbortController();
    ac.abort();
    const stream = runInferenceStream({ network: "testnet", privateKey: KEY, prompt: "hi", signal: ac.signal });
    // Swallow the done rejection so it isn't an unhandled rejection; we assert on the loop.
    stream.done.catch(() => {});
    let threw: unknown;
    try {
      for await (const _chunk of stream) {
        void _chunk;
      }
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeDefined();
    expect(isAbortError(threw)).toBe(true);
  });
});

describe("runInferenceWithKey key validation", () => {
  it("rejects a 0x-prefixed, right-length key with non-hex chars before any network call", async () => {
    const badKey = "0x" + "z".repeat(64); // right shape, wrong alphabet
    await expect(
      runInferenceWithKey({ network: "testnet", privateKey: badKey, prompt: "hi" }),
    ).rejects.toThrow(/0x-prefixed 32-byte hex/);
  });

  it("rejects a key of the wrong length", async () => {
    await expect(
      runInferenceWithKey({ network: "testnet", privateKey: "0xabc", prompt: "hi" }),
    ).rejects.toThrow(/0x-prefixed 32-byte hex/);
  });
});

describe("runInferenceWithKey network resolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives the gateway from a custom NetworkConfig's id, not a hardcoded mainnet", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: unknown) => {
      urls.push(String(u));
      throw new Error("stop after capturing the gateway URL");
    });
    try {
      // Pass the testnet config as an OBJECT (the path that used to force mainnet).
      await runInferenceWithKey({ network: NETWORKS.testnet, privateKey: KEY, prompt: "hi" });
    } catch {
      /* expected - we only care about the URL the SIWE call targeted */
    }
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[0]).toContain("testnet");
    expect(urls[0]).not.toContain("mainnet");
  });
});
