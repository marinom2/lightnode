import { describe, it, expect } from "vitest";
import { aggregateModelStats, percentile, modelStatsCsv } from "@/lib/analytics";
import type { Job, ModelInfo } from "@/lib/subgraph";

const MODELS: ModelInfo[] = [
  { id: "0xAAA", name: "llama3-8b", fee: "0", max_output_tokens: 2048, is_whitelisted: true, is_enabled: true },
  { id: "0xBBB", name: "llama3-70b", fee: "0", max_output_tokens: 4096, is_whitelisted: true, is_enabled: true },
];

// 0xAAA: 2 released (+share), 1 timed out, 1 in-flight; latencies 10s, 30s
// 0xBBB: 1 completed (no share yet)
const JOBS: Job[] = [
  { id: "1", state: "Released", model_id: "0xaaa", ack_at: 100, completed_at: 110, worker_share: "16000000000000000" },
  { id: "2", state: "Released", model_id: "0xAAA", ack_at: 200, completed_at: 230, worker_share: "16000000000000000" },
  { id: "3", state: "TimedOut", model_id: "0xAAA" },
  { id: "4", state: "Acknowledged", model_id: "0xAAA", ack_at: 300 },
  { id: "5", state: "Completed", model_id: "0xBBB", ack_at: 400, completed_at: 460, worker_share: "0" },
];

describe("percentile (nearest-rank)", () => {
  it("handles empty + single + ranks", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });
});

describe("aggregateModelStats", () => {
  const stats = aggregateModelStats(JOBS, MODELS);
  const a = stats.find((s) => s.modelId === "0xaaa")!;
  const b = stats.find((s) => s.modelId === "0xbbb")!;

  it("maps model_id to name case-insensitively and groups", () => {
    expect(a.name).toBe("llama3-8b");
    expect(a.total).toBe(4);
    expect(b.name).toBe("llama3-70b");
  });

  it("classifies success / timeout / in-flight and computes completion over RESOLVED only", () => {
    expect(a.success).toBe(2);
    expect(a.timedOut).toBe(1);
    expect(a.inFlight).toBe(1);
    // resolved = 2 success + 1 timeout = 3 -> 2/3
    expect(a.completionRate).toBeCloseTo(2 / 3, 5);
  });

  it("computes ack->complete latency percentiles", () => {
    expect(a.p50).toBe(10); // latencies [10,30], nearest-rank p50 -> 10
    expect(a.p95).toBe(30);
  });

  it("sums settled worker share as earnings", () => {
    expect(a.earnings).toBeCloseTo(0.032, 6); // 2 x 0.016
    expect(b.earnings).toBe(0); // completed but not released
  });

  it("orders busiest model first", () => {
    expect(stats[0].modelId).toBe("0xaaa");
  });

  it("completionRate is null when nothing has resolved", () => {
    const onlyInflight = aggregateModelStats([{ id: "9", state: "Submitted", model_id: "0xAAA" }], MODELS);
    expect(onlyInflight[0].completionRate).toBeNull();
  });
});

describe("modelStatsCsv", () => {
  it("emits a header + one row per model", () => {
    const csv = modelStatsCsv(aggregateModelStats(JOBS, MODELS));
    const lines = csv.split("\n");
    expect(lines[0]).toContain("model,jobs,success");
    expect(lines).toHaveLength(3); // header + 2 models
    expect(csv).toContain("llama3-8b");
  });
});
