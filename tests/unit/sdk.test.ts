import { describe, it, expect } from "vitest";
import {
  aggregateModelStats,
  aggregateWorkerStats,
  networkAnalytics,
  modelStatsCsv,
  workerStatsCsv,
  workerJobsCsv,
  fromWei,
  modelId,
  NETWORKS,
  REGISTRY_TOPICS,
} from "../../sdk/src/index";
import type { Job, ModelInfo } from "../../sdk/src/types";

// Tests the SDK's OWN logic standalone (the consistency test only guards config drift).
describe("lightnode-sdk pure logic", () => {
  it("modelId = keccak of the exact tag (matches the live on-chain id)", () => {
    expect(modelId("llama3-8b")).toBe("0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848");
  });

  it("fromWei converts 18-decimal wei and tolerates junk", () => {
    expect(fromWei("16000000000000000")).toBeCloseTo(0.016, 9);
    expect(fromWei(undefined)).toBe(0);
    expect(fromWei("0")).toBe(0);
    expect(fromWei("not-a-number")).toBe(0);
  });

  it("aggregateModelStats: stuck counts as incomplete, completion not inflated", () => {
    const models: ModelInfo[] = [{ id: "0xAAA", name: "m", fee: "0", max_output_tokens: 0, is_whitelisted: true, is_enabled: true }];
    const jobs: Job[] = [
      { id: "1", state: "Released", model_id: "0xaaa", ack_at: 100, completed_at: 120, worker_share: "16000000000000000" },
      { id: "2", state: "Acknowledged", model_id: "0xAAA", ack_at: 200 }, // 800s before NOW=1000 -> stuck
    ];
    const [s] = aggregateModelStats(jobs, models, 1000);
    expect(s.success).toBe(1);
    expect(s.stuck).toBe(1);
    expect(s.incomplete).toBe(1);
    expect(s.completionRate).toBe(0.5);
    expect(s.p50).toBe(20);
    expect(s.earnings).toBeCloseTo(0.016, 9);
    // invariant: every job lands in exactly one outcome bucket
    expect(s.success + s.incomplete + s.inFlight + s.disputed).toBe(s.total);

    const n = networkAnalytics([s]);
    expect(n.jobs).toBe(2);
    expect(n.completionRate).toBe(0.5);
  });

  it("aggregateWorkerStats groups by worker address", () => {
    const jobs: Job[] = [{ id: "1", state: "Released", worker: "0xW", ack_at: 1, completed_at: 2, worker_share: "0" }];
    const [w] = aggregateWorkerStats(jobs, 1000);
    expect(w.address).toBe("0xW");
    expect(w.completionRate).toBe(1);
  });

  it("exports the verified network config + registry topics", () => {
    expect(NETWORKS.mainnet.chainId).toBe(9200);
    expect(NETWORKS.testnet.chainId).toBe(8200);
    expect(REGISTRY_TOPICS.registered).toMatch(/^0x[0-9a-f]{64}$/);
    expect(REGISTRY_TOPICS.exited).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("typed errors are constructable + identifiable via isStalledWorker / instanceof", async () => {
    const { StalledWorkerError, OnChainRevertError, RelayTokenTimeoutError, GatewayAuthError, isStalledWorker } =
      await import("../../sdk/src/index");
    const stall = new StalledWorkerError({
      jobId: 42n,
      worker: "0x1111111111111111111111111111111111111111",
      submitTx: "0xabc" as `0x${string}`,
      feeLcai: 0.02,
    });
    expect(stall.name).toBe("StalledWorkerError");
    expect(stall.jobId).toBe(42n);
    expect(isStalledWorker(stall)).toBe(true);
    expect(isStalledWorker(new Error("other"))).toBe(false);

    const revert = new OnChainRevertError("submitJob", "0xdeadbeef" as `0x${string}`);
    expect(revert.fn).toBe("submitJob");
    expect(revert.tx).toBe("0xdeadbeef");

    const relay = new RelayTokenTimeoutError();
    expect(relay.name).toBe("RelayTokenTimeoutError");

    const auth = new GatewayAuthError(401, "Unauthorized");
    expect(auth.status).toBe(401);
    expect(auth.message).toMatch(/401/);
  });

  it("CSV exporters emit a header + one row per record", () => {
    const models: ModelInfo[] = [{ id: "0xAAA", name: "llama3-8b", fee: "0", max_output_tokens: 0, is_whitelisted: true, is_enabled: true }];
    const jobs: Job[] = [
      { id: "1", state: "Released", model_id: "0xaaa", worker: "0xW", ack_at: 100, completed_at: 118, worker_share: "16000000000000000" },
      { id: "2", state: "Acknowledged", model_id: "0xAAA", worker: "0xW", ack_at: 200 },
    ];
    const modelCsv = modelStatsCsv(aggregateModelStats(jobs, models, 1000)).split("\n");
    expect(modelCsv[0].startsWith("model,")).toBe(true);
    expect(modelCsv).toHaveLength(2);

    const workerCsv = workerStatsCsv(aggregateWorkerStats(jobs, 1000)).split("\n");
    expect(workerCsv[0].startsWith("worker,")).toBe(true);
    expect(workerCsv[1]).toContain("0xW");

    const jobsCsv = workerJobsCsv(jobs).split("\n");
    expect(jobsCsv[0]).toBe("job_id,state,model_id,processing_s,worker_share_lcai,submitted_at,ack_at,completed_at");
    expect(jobsCsv[1]).toBe("1,Released,0xaaa,18,0.016000,,100,118");
    expect(jobsCsv).toHaveLength(3);
  });
});
