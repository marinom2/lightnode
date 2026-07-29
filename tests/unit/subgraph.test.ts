import { describe, it, expect, vi, afterEach } from "vitest";
import { summarize, isLive, fetchModels, fetchWorkerModels, type Worker, type ModelInfo } from "@/lib/subgraph";
import { modelIdForTag, resolveModel } from "@/lib/model-catalog";

const now = Math.floor(Date.now() / 1000);

const workers: Worker[] = [
  { id: "0xA", status: "active", stake: "50000000000000000000000", jobs_completed: 100, total_earned: "1600000000000000000", last_seen_at: now - 60 },
  { id: "0xB", status: "active", stake: "50000000000000000000000", jobs_completed: 50, total_earned: "800000000000000000", last_seen_at: now - 7200 },
  { id: "0xC", status: "deregistered", stake: "0", jobs_completed: 10, total_earned: "160000000000000000", last_seen_at: now - 100 },
];

const models: ModelInfo[] = [
  { id: "1", name: "llama3-8b", fee: "20000000000000000", max_output_tokens: 2048, is_whitelisted: true, is_enabled: true },
  { id: "2", name: "llama3-70b", fee: "150000000000000000", max_output_tokens: 4096, is_whitelisted: true, is_enabled: true },
  { id: "3", name: "draft", fee: "0", max_output_tokens: 0, is_whitelisted: false, is_enabled: false },
];

describe("isLive", () => {
  it("is true for any active worker, regardless of last_seen (subgraph last_seen isn't a real-time heartbeat)", () => {
    expect(isLive({ status: "active", last_seen_at: now - 60 })).toBe(true);
    expect(isLive({ status: "active", last_seen_at: now - 7200 })).toBe(true);
  });
  it("is false for non-active status", () => {
    expect(isLive({ status: "deregistered", last_seen_at: now })).toBe(false);
  });
});

describe("summarize", () => {
  const s = summarize(workers, models);
  it("counts total / active / live correctly", () => {
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.live).toBe(2); // both active workers (0xA, 0xB); last_seen no longer matters
  });
  it("counts only enabled+whitelisted models", () => {
    expect(s.models).toBe(2);
  });
  it("sums jobs + earnings", () => {
    expect(s.jobsCompleted).toBe(160);
    expect(s.totalEarnedLcai).toBeCloseTo(2.56);
  });
});

/*
 * NAME REPAIR AT THE SUBGRAPH BOUNDARY
 * ------------------------------------
 * `id = keccak256(tag)` and the registry stores nothing else, so a model
 * whitelisted without its tag comes back with `name === id`. fetchModels repairs
 * that once, here, and records the verdict ON the row as `unnamed`. These tests
 * pin the verdict, not just the label: a consumer that has to re-derive trust by
 * re-resolving the display string is one placeholder away from hashing
 * "unnamed 0x1234abcd…" into a second, bogus model id that nothing serves.
 */
const GPT20 = modelIdForTag("gpt-oss:20b"); // in the catalog: recoverable from the id alone
const GHOST = modelIdForTag("a-model-that-was-never-published"); // not in the catalog: unrecoverable

type WireModel = { id: string; name: string | null; fee: string; max_output_tokens: number; is_whitelisted: boolean; is_enabled: boolean };

function wire(id: string, name: string | null, over: Partial<WireModel> = {}): WireModel {
  return { id, name, fee: "20000000000000000", max_output_tokens: 2048, is_whitelisted: true, is_enabled: true, ...over };
}

/**
 * One stub for both queries. fetchWorkerModels fires `workermodels` and the
 * models registry in parallel, so the responder dispatches on the query text
 * rather than on call order.
 */
function mockSubgraph(rows: { modelinfos?: WireModel[]; workermodels?: { model_id: string | null; is_active: boolean }[] }) {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const query = JSON.parse(init.body).query as string;
    const data = query.includes("workermodels")
      ? { workermodels: rows.workermodels ?? [] }
      : { modelinfos: rows.modelinfos ?? [] };
    return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchModels", () => {
  it("recovers a catalog tag from an echoed id and marks the row named", async () => {
    mockSubgraph({ modelinfos: [wire(GPT20, GPT20)] });
    const [m] = await fetchModels("testnet");
    expect(m.name).toBe("gpt-oss:20b");
    expect(m.unnamed).toBe(false);
  });

  it("recovers a catalog tag when the indexer sent no name at all", async () => {
    mockSubgraph({ modelinfos: [wire(GPT20, null)] });
    const [m] = await fetchModels("testnet");
    expect(m.name).toBe("gpt-oss:20b");
    expect(m.unnamed).toBe(false);
  });

  it("flags a row it cannot recover instead of leaking the hash or inventing a tag", async () => {
    mockSubgraph({ modelinfos: [wire(GHOST, GHOST)] });
    const [m] = await fetchModels("testnet");
    expect(m.unnamed).toBe(true);
    expect(m.name).not.toBe(GHOST); // no raw 66-char digest in the UI
    expect(m.name).toMatch(/^unnamed 0x[0-9a-f]{8}…$/);
  });

  it("keeps a genuine name - including a tag newer than our catalog - and marks it named", async () => {
    const future = "some-future-model:4b";
    mockSubgraph({ modelinfos: [wire(modelIdForTag("qwen3-vl:8b"), "qwen3-vl:8b"), wire(modelIdForTag(future), future)] });
    const [known, unseen] = await fetchModels("testnet");
    expect([known.name, known.unnamed]).toEqual(["qwen3-vl:8b", false]);
    expect([unseen.name, unseen.unnamed]).toEqual([future, false]);
  });

  it("sets unnamed on EVERY row, both verdicts - an absent flag would read as named", async () => {
    mockSubgraph({ modelinfos: [wire(GPT20, GPT20), wire(GHOST, GHOST), wire(modelIdForTag("llama3-8b"), "llama3-8b")] });
    const models = await fetchModels("testnet");
    expect(models.map((m) => m.unnamed)).toEqual([false, true, false]);
    for (const m of models) expect(typeof m.unnamed).toBe("boolean");
  });

  it("carries the same verdict the resolver would give, so no consumer must re-derive it", async () => {
    mockSubgraph({ modelinfos: [wire(GPT20, GPT20), wire(GHOST, GHOST)] });
    for (const m of await fetchModels("testnet")) {
      // Re-resolving the row is exactly what the picker used to do. It must
      // agree with the flag the row already carries - if it ever does not, the
      // flag is the truth and the re-derivation is the bug.
      expect(resolveModel(m.name, m.id).known).toBe(!m.unnamed);
    }
  });

  it("leaves fee, output cap and the whitelist/enabled flags alone, and passes id verbatim", async () => {
    // Mixed-case id: it is the subgraph's case-sensitive entity key and callers
    // join on it, so repair must not normalize it.
    const mixed = `0x${GHOST.slice(2).toUpperCase()}`;
    mockSubgraph({ modelinfos: [wire(mixed, mixed, { fee: "150000000000000000", max_output_tokens: 4096, is_whitelisted: false, is_enabled: false })] });
    const [m] = await fetchModels("testnet");
    expect(m.id).toBe(mixed);
    expect(m.fee).toBe("150000000000000000");
    expect(m.max_output_tokens).toBe(4096);
    expect(m.is_whitelisted).toBe(false);
    expect(m.is_enabled).toBe(false);
    expect(m.unnamed).toBe(true); // still resolved, despite the casing
  });
});

describe("fetchWorkerModels", () => {
  const addr = "0x1111111111111111111111111111111111111111";

  it("joins the registry row and marks a real tag named", async () => {
    mockSubgraph({
      modelinfos: [wire(GPT20, "gpt-oss:20b", { fee: "42", max_output_tokens: 1024 })],
      workermodels: [{ model_id: GPT20, is_active: true }],
    });
    const [s] = await fetchWorkerModels("testnet", addr);
    expect(s).toMatchObject({ name: "gpt-oss:20b", unnamed: false, modelId: GPT20, fee: "42", maxOutput: 1024, active: true });
  });

  it("does not re-flag an unnamed registry row as servable", async () => {
    // The registry row already carries a placeholder. Feeding that back in must
    // not make it look like a tag the worker could pull.
    mockSubgraph({ modelinfos: [wire(GHOST, GHOST)], workermodels: [{ model_id: GHOST, is_active: true }] });
    const [s] = await fetchWorkerModels("testnet", addr);
    expect(s.unnamed).toBe(true);
    expect(s.name).toMatch(/^unnamed 0x[0-9a-f]{8}…$/);
  });

  it("resolves from the id when the registry join misses entirely", async () => {
    // A worker can serve an id the models query did not return (whitelist pulled,
    // or the row is newer than the page) - the id still names a catalog model.
    mockSubgraph({ modelinfos: [], workermodels: [{ model_id: GPT20, is_active: false }] });
    const [s] = await fetchWorkerModels("testnet", addr);
    expect(s).toMatchObject({ name: "gpt-oss:20b", unnamed: false, active: false });
    expect(s.fee).toBeUndefined(); // no registry row to join, so no fee/limit
  });

  it("flags a joinless, uncatalogued id rather than showing a hash prefix", async () => {
    mockSubgraph({ modelinfos: [], workermodels: [{ model_id: GHOST, is_active: true }] });
    const [s] = await fetchWorkerModels("testnet", addr);
    expect(s.unnamed).toBe(true);
    expect(s.name).toMatch(/^unnamed 0x[0-9a-f]{8}…$/);
  });

  it("sets unnamed on every served row, and one malformed row does not blank the list", async () => {
    mockSubgraph({
      modelinfos: [wire(GPT20, "gpt-oss:20b")],
      workermodels: [{ model_id: null, is_active: true }, { model_id: GPT20, is_active: true }],
    });
    const served = await fetchWorkerModels("testnet", addr);
    expect(served).toHaveLength(2); // the null id used to throw the whole list away
    expect(served.map((s) => s.unnamed)).toEqual([true, false]);
    expect(served[1].name).toBe("gpt-oss:20b");
  });

  it("degrades to an empty list when the subgraph is down (never blocks the worker view)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    await expect(fetchWorkerModels("testnet", addr)).resolves.toEqual([]);
  });
});
