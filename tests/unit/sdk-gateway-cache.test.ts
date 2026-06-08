import { describe, it, expect, vi, afterEach } from "vitest";
import { GatewayClient, GatewayHttpError, LightNode } from "../../sdk/src/index";

type MockRes = { status: number; body?: unknown; headers?: Record<string, string> };
function mockFetch(seq: MockRes[]) {
  const calls = { n: 0 };
  const fn = async () => {
    const r = seq[Math.min(calls.n++, seq.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => r.body ?? {},
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")),
    } as unknown as Response;
  };
  return Object.assign(fn, { calls });
}

describe("GatewayHttpError classification", () => {
  it("classifies status families", () => {
    expect(new GatewayHttpError(429, "").isRateLimited).toBe(true);
    expect(new GatewayHttpError(401, "").isAuthError).toBe(true);
    expect(new GatewayHttpError(403, "").isAuthError).toBe(true);
    expect(new GatewayHttpError(503, "").isServerError).toBe(true);
    expect(new GatewayHttpError(404, "").isRateLimited).toBe(false);
    expect(new GatewayHttpError(429, "", 1500).retryAfterMs).toBe(1500);
  });
});

describe("GatewayClient retry", () => {
  it("retries a 429 then succeeds", async () => {
    const f = mockFetch([{ status: 429, headers: { "retry-after": "0" } }, { status: 200, body: { models: [{ id: "1", name: "m" }] } }]);
    const gw = new GatewayClient({ network: "mainnet", fetch: f as unknown as typeof fetch, retry: { baseDelayMs: 1 } });
    const r = await gw.getModels();
    expect(r.models[0].name).toBe("m");
    expect(f.calls.n).toBe(2); // one retry
  });

  it("retries 5xx up to maxRetries then throws", async () => {
    const f = mockFetch([{ status: 500 }]);
    const gw = new GatewayClient({ network: "mainnet", fetch: f as unknown as typeof fetch, retry: { maxRetries: 2, baseDelayMs: 1 } });
    await expect(gw.getModels()).rejects.toMatchObject({ status: 500 });
    expect(f.calls.n).toBe(3); // initial + 2 retries
  });

  it("does NOT retry an auth error (401)", async () => {
    const f = mockFetch([{ status: 401 }]);
    const gw = new GatewayClient({ network: "mainnet", fetch: f as unknown as typeof fetch, retry: { maxRetries: 3, baseDelayMs: 1 } });
    await expect(gw.getModels()).rejects.toMatchObject({ status: 401 });
    expect(f.calls.n).toBe(1); // no retries
  });

  it("maxRetries 0 disables retry", async () => {
    const f = mockFetch([{ status: 429 }]);
    const gw = new GatewayClient({ network: "mainnet", fetch: f as unknown as typeof fetch, retry: { maxRetries: 0 } });
    await expect(gw.getModels()).rejects.toBeInstanceOf(GatewayHttpError);
    expect(f.calls.n).toBe(1);
  });

  it("does NOT retry a POST on 5xx (avoids duplicate wallet-scoped selectSession)", async () => {
    const f = mockFetch([{ status: 500 }]);
    const gw = new GatewayClient({ network: "mainnet", bearer: "tok", fetch: f as unknown as typeof fetch, retry: { maxRetries: 3, baseDelayMs: 1 } });
    await expect(gw.selectSession("0xabc")).rejects.toMatchObject({ status: 500 });
    expect(f.calls.n).toBe(1); // POST 5xx is not safe to replay
  });

  it("DOES retry a POST on 429 (rejected before any work)", async () => {
    const f = mockFetch([{ status: 429, headers: { "retry-after": "0" } }, { status: 200, body: { worker: "0x1", workerEncryptionKey: "k", nonce: 1, expiry: 2 } }]);
    const gw = new GatewayClient({ network: "mainnet", bearer: "tok", fetch: f as unknown as typeof fetch, retry: { baseDelayMs: 1 } });
    const r = await gw.selectSession("0xabc");
    expect(r.worker).toBe("0x1");
    expect(f.calls.n).toBe(2);
  });

  it("tolerates an empty 202 body (relay-token still pending)", async () => {
    const f = mockFetch([{ status: 202, body: "" }]); // empty body
    const gw = new GatewayClient({ network: "mainnet", bearer: "tok", fetch: f as unknown as typeof fetch });
    await expect(gw.getSessionToken(1)).resolves.toEqual({});
  });
});

describe("LightNode TTL cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  const modelsResponse = {
    ok: true,
    status: 200,
    json: async () => ({ data: { modelinfos: [{ id: "0x1", name: "m", fee: "0", max_output_tokens: 1, is_whitelisted: true, is_enabled: true }] } }),
  };

  it("memoizes a network read within the TTL and refetches after clearCache", async () => {
    const spy = vi.fn(async () => modelsResponse as unknown as Response);
    vi.stubGlobal("fetch", spy);
    const ln = new LightNode("mainnet", { cacheTtlMs: 10_000 });
    await ln.getModels();
    await ln.getModels();
    expect(spy).toHaveBeenCalledTimes(1); // second served from cache
    ln.clearCache();
    await ln.getModels();
    expect(spy).toHaveBeenCalledTimes(2); // refetched after clear
  });

  it("does not cache when cacheTtlMs is 0 (default)", async () => {
    const spy = vi.fn(async () => modelsResponse as unknown as Response);
    vi.stubGlobal("fetch", spy);
    const ln = new LightNode("mainnet"); // default: no cache
    await ln.getModels();
    await ln.getModels();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
