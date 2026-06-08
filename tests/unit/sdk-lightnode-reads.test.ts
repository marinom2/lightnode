import { describe, it, expect, vi, afterEach } from "vitest";
import { LightNode } from "../../sdk/src/index";

// ---------------------------------------------------------------------------
// All reads under test hit one of two endpoints:
//   - the subgraph (POST {graphql}, body { query }) -> { data: { ... } }
//   - the raw RPC  (POST {rpc},     body { method: "eth_call" }) -> { result }
// We stub global fetch and route by URL so the same handler can serve a method
// that touches both (getServedModels). Every response mimics the real wire
// shapes from sdk/src/subgraph.ts + sdk/src/onchain.ts + sdk/src/inference.ts.
// No network, no chain.
// ---------------------------------------------------------------------------

const RPC = "https://rpc.mainnet.lightchain.ai";
const SUBGRAPH = "https://workers-api.mainnet.lightchain.ai/graphql";
const WORKER = "0x1111111111111111111111111111111111111111";

type JsonBody = Record<string, unknown>;

/** A Response-ish object good enough for the SDK's `res.ok` / `res.json()` use. */
function jsonResponse(body: JsonBody, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Build a fetch double that dispatches on URL. `subgraph` answers the GraphQL
 * POST with a `data` payload; `rpc` answers the JSON-RPC POST with a `result`
 * (or an error/throw to exercise fallbacks). Records call counts per channel.
 */
function routedFetch(opts: {
  subgraph?: (query: string) => JsonBody | Response;
  rpc?: (body: JsonBody) => JsonBody | Response | Promise<JsonBody | Response>;
}): typeof fetch & { calls: { subgraph: number; rpc: number } } {
  const calls = { subgraph: 0, rpc: 0 };
  const fn = (async (url: string, init?: { body?: string }) => {
    const parsed = init?.body ? (JSON.parse(init.body) as JsonBody) : {};
    if (url === SUBGRAPH) {
      calls.subgraph++;
      const out = opts.subgraph?.(String(parsed.query ?? "")) ?? { data: {} };
      return out instanceof Object && "json" in out ? (out as Response) : jsonResponse(out as JsonBody);
    }
    if (url === RPC) {
      calls.rpc++;
      const out = (await opts.rpc?.(parsed)) ?? { result: "0x" };
      return out instanceof Object && "json" in out ? (out as Response) : jsonResponse(out as JsonBody);
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }) as unknown as typeof fetch & { calls: typeof calls };
  return Object.assign(fn, { calls });
}

const WORKER_FIXTURE = {
  id: WORKER,
  status: "active",
  stake: "1000000000000000000000",
  active_job_count: 2,
  jobs_completed: 17,
  jobs_timed_out: 1,
  total_earned: "5000000000000000000", // 5 LCAI in wei
  last_seen_at: 1700000000,
  created_at: 1690000000,
};

describe("LightNode.getWorker (subgraph record vs null)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the full worker record on a hit", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { worker: WORKER_FIXTURE } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const w = await ln.getWorker(WORKER);
    expect(w).toEqual(WORKER_FIXTURE);
    expect(f.calls.subgraph).toBe(1);
  });

  it("returns null when the indexer has no such worker (data.worker === null)", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { worker: null } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getWorker(WORKER)).resolves.toBeNull();
  });

  it("maps a 'not found' GraphQL error to null rather than throwing", async () => {
    const f = routedFetch({ subgraph: () => ({ errors: [{ message: "worker not found" }] }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getWorker(WORKER)).resolves.toBeNull();
  });
});

describe("LightNode.getWorkerJobs (records vs empty)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the jobs array on a hit", async () => {
    const jobs = [
      { id: "42", state: "Completed", model_id: "0xabc", submitted_at: 100, ack_at: 110, completed_at: 130, worker_share: "1000000000000000000" },
      { id: "41", state: "Submitted", model_id: "0xabc", submitted_at: 90 },
    ];
    const f = routedFetch({ subgraph: () => ({ data: { jobs } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const out = await ln.getWorkerJobs(WORKER);
    expect(out).toEqual(jobs);
  });

  it("returns [] when data.jobs is absent (null)", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { jobs: null } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getWorkerJobs(WORKER)).resolves.toEqual([]);
  });
});

describe("LightNode.getWorkerStats (aggregated over recent jobs)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups recent jobs by worker and buckets outcomes", async () => {
    const jobs = [
      // Two completed jobs for WORKER, each paying 1 LCAI, latency 20s.
      { id: "1", state: "Completed", worker: WORKER, ack_at: 100, completed_at: 120, worker_share: "1000000000000000000" },
      { id: "2", state: "Released", worker: WORKER, ack_at: 200, completed_at: 220, worker_share: "1000000000000000000" },
      // One timed-out job for WORKER -> incomplete.
      { id: "3", state: "TimedOut", worker: WORKER },
    ];
    const f = routedFetch({ subgraph: () => ({ data: { jobs } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const stats = await ln.getWorkerStats();
    expect(stats).toHaveLength(1);
    const s = stats[0];
    expect(s.address).toBe(WORKER);
    expect(s.total).toBe(3);
    expect(s.success).toBe(2);
    expect(s.timedOut).toBe(1);
    expect(s.incomplete).toBe(1);
    // 2 successes / (2 success + 1 incomplete) = 2/3.
    expect(s.completionRate).toBeCloseTo(2 / 3, 6);
    expect(s.earnings).toBeCloseTo(2, 6);
    expect(s.p50).toBe(20);
  });

  it("returns [] when there are no recent jobs", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { jobs: [] } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getWorkerStats()).resolves.toEqual([]);
  });
});

describe("LightNode.getJobStatus (classification + refundable + null)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function jobStatus(state: string) {
    const f = routedFetch({
      subgraph: () => ({
        data: {
          job: {
            id: "7",
            state,
            model_id: "0xmodel",
            worker: WORKER,
            submitted_at: 1000,
            completed_at: 1100,
            worker_share: "2000000000000000000", // 2 LCAI
            submit_block_number: 500,
            completion_block_number: 600,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", f);
    return new LightNode("mainnet").getJobStatus("7");
  }

  it("classifies a Completed job and is NOT refundable", async () => {
    const s = await jobStatus("Completed");
    expect(s).not.toBeNull();
    expect(s!.category).toBe("completed");
    expect(s!.raw).toBe("Completed");
    expect(s!.refundable).toBe(false);
    expect(s!.worker).toBe(WORKER);
    expect(s!.model).toBe("0xmodel");
    expect(s!.workerShareLcai).toBeCloseTo(2, 6);
    expect(s!.submitBlock).toBe(500);
    expect(s!.completionBlock).toBe(600);
    // withTransactions defaults off -> no extra RPC roundtrip, tx hashes null.
    expect(s!.submitTx).toBeNull();
    expect(s!.completionTx).toBeNull();
  });

  it("classifies an Acknowledged job as in-flight (not refundable)", async () => {
    const s = await jobStatus("Acknowledged");
    expect(s!.category).toBe("in-flight");
    expect(s!.refundable).toBe(false);
  });

  it("classifies a Submitted job as submitted", async () => {
    const s = await jobStatus("Submitted");
    expect(s!.category).toBe("submitted");
    expect(s!.refundable).toBe(false);
  });

  it("classifies a TimedOut job as stalled and refundable", async () => {
    const s = await jobStatus("TimedOut");
    expect(s!.category).toBe("stalled");
    expect(s!.refundable).toBe(true);
  });

  it("classifies a Disputed job as disputed and refundable", async () => {
    const s = await jobStatus("Disputed");
    expect(s!.category).toBe("disputed");
    expect(s!.refundable).toBe(true);
  });

  it("classifies a Resolved job as resolved (not refundable)", async () => {
    const s = await jobStatus("Resolved");
    expect(s!.category).toBe("resolved");
    expect(s!.refundable).toBe(false);
  });

  it("falls back to 'unknown' for an unrecognized state", async () => {
    const s = await jobStatus("Frobnicated");
    expect(s!.category).toBe("unknown");
    expect(s!.refundable).toBe(false);
  });

  it("returns null when the indexer has never seen the job", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { job: null } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getJobStatus("999")).resolves.toBeNull();
  });

  it("nulls a zero completion_block_number (job not yet completed on-chain)", async () => {
    const f = routedFetch({
      subgraph: () => ({
        data: { job: { id: "8", state: "Submitted", worker: WORKER, submit_block_number: 500, completion_block_number: 0 } },
      }),
    });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const s = await ln.getJobStatus("8");
    expect(s!.completionBlock).toBeNull();
    expect(s!.submitBlock).toBe(500);
  });
});

describe("LightNode.getEarningsLcai", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converts total_earned wei into whole LCAI", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { worker: WORKER_FIXTURE } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getEarningsLcai(WORKER)).resolves.toBeCloseTo(5, 6);
  });

  it("returns 0 when the worker is unknown to the indexer", async () => {
    const f = routedFetch({ subgraph: () => ({ data: { worker: null } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getEarningsLcai(WORKER)).resolves.toBe(0);
  });
});

describe("LightNode.estimateFee (AIConfig.calculateJobFee eth_call)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodes the eth_call result into whole LCAI", async () => {
    // 1 LCAI = 1e18 wei = 0xde0b6b3a7640000.
    const oneLcaiHex = "0x" + (10n ** 18n).toString(16);
    const f = routedFetch({
      rpc: (body) => {
        expect(body.method).toBe("eth_call");
        return { result: oneLcaiHex };
      },
    });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.estimateFee("llama3:8b")).resolves.toBeCloseTo(1, 6);
    expect(f.calls.rpc).toBe(1);
  });

  it("throws when the call returns empty data (0x)", async () => {
    const f = routedFetch({ rpc: () => ({ result: "0x" }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.estimateFee("llama3:8b")).rejects.toThrow(/no data/i);
  });

  it("surfaces an RPC error message", async () => {
    const f = routedFetch({ rpc: () => ({ error: { message: "execution reverted" } }) });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.estimateFee("llama3:8b")).rejects.toThrow(/execution reverted/i);
  });
});

describe("LightNode.getServedModels (subgraph rows reconciled with on-chain eligibility)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const MODEL_ID = "0xAAAA";
  function subgraphHandler(query: string): JsonBody {
    // fetchWorkerModels asks for `workermodels`; fetchModels asks for `modelinfos`.
    if (query.includes("workermodels")) {
      return { data: { workermodels: [{ id: `${WORKER}/${MODEL_ID}`, worker: WORKER, model_id: MODEL_ID, is_active: true }] } };
    }
    return {
      data: {
        modelinfos: [{ id: MODEL_ID.toLowerCase(), name: "llama3", fee: "1000000000000000000", max_output_tokens: 4096, is_whitelisted: true, is_enabled: true }],
      },
    };
  }

  it("joins model names and the on-chain isEligible result (success path)", async () => {
    const f = routedFetch({
      subgraph: subgraphHandler,
      // isEligible bool: 32-byte word ending in 1 -> eligible true.
      rpc: () => ({ result: "0x" + "0".repeat(63) + "1" }),
    });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const served = await ln.getServedModels(WORKER);
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({
      modelId: MODEL_ID,
      name: "llama3",
      feeWei: "1000000000000000000",
      maxOutputTokens: 4096,
      indexedActive: true,
      onchainEligible: true,
    });
    expect(f.calls.rpc).toBe(1);
  });

  it("falls back to onchainEligible: null when the on-chain read fails", async () => {
    const f = routedFetch({
      subgraph: subgraphHandler,
      // Non-OK RPC response makes fetchOnchainEligibleModels throw -> .catch(() => null).
      rpc: () => jsonResponse({ error: { message: "boom" } }, 500),
    });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    const served = await ln.getServedModels(WORKER);
    expect(served).toHaveLength(1);
    expect(served[0].indexedActive).toBe(true);
    expect(served[0].onchainEligible).toBeNull();
  });

  it("returns [] without any RPC read when the worker has no model rows", async () => {
    const f = routedFetch({
      subgraph: (query) => (query.includes("workermodels") ? { data: { workermodels: [] } } : { data: { modelinfos: [] } }),
    });
    vi.stubGlobal("fetch", f);
    const ln = new LightNode("mainnet");
    await expect(ln.getServedModels(WORKER)).resolves.toEqual([]);
    expect(f.calls.rpc).toBe(0);
  });
});
