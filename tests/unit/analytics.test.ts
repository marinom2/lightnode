import { describe, it, expect } from "vitest";
import { aggregateModelStats, aggregateWorkerStats, networkAnalytics, percentile, modelStatsCsv } from "@/lib/analytics";
import type { Job, ModelInfo } from "@/lib/subgraph";

const NOW = 1000;
const MODELS: ModelInfo[] = [
  { id: "0xAAA", name: "llama3-8b", fee: "0", max_output_tokens: 2048, is_whitelisted: true, is_enabled: true },
  { id: "0xBBB", name: "llama3-70b", fee: "0", max_output_tokens: 4096, is_whitelisted: true, is_enabled: true },
];

// 0xAAA: 2 released (latency 10s/30s, +share), 1 timed out, 1 acked-stuck (ack 700s ago),
//        1 acked-recent (in-flight), 1 submitted (in-flight)
// 0xBBB: 1 completed
const JOBS: Job[] = [
  { id: "1", state: "Released", model_id: "0xaaa", ack_at: 100, completed_at: 110, worker_share: "16000000000000000" },
  { id: "2", state: "Released", model_id: "0xAAA", ack_at: 200, completed_at: 230, worker_share: "16000000000000000" },
  { id: "3", state: "TimedOut", model_id: "0xAAA" },
  { id: "4", state: "Acknowledged", model_id: "0xAAA", ack_at: 300 }, // 700s ago -> stuck
  { id: "5", state: "Acknowledged", model_id: "0xAAA", ack_at: 900 }, // 100s ago -> in-flight
  { id: "6", state: "Submitted", model_id: "0xAAA", submitted_at: 950 }, // in-flight
  { id: "7", state: "Completed", model_id: "0xBBB", ack_at: 400, completed_at: 460, worker_share: "0" },
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
  const stats = aggregateModelStats(JOBS, MODELS, NOW);
  const a = stats.find((s) => s.modelId === "0xaaa")!;

  it("counts acked-but-never-finished jobs as INCOMPLETE, not in-flight", () => {
    expect(a.timedOut).toBe(1);
    expect(a.stuck).toBe(1); // job #4 acked 700s ago, never completed
    expect(a.incomplete).toBe(2); // timedOut + stuck
    expect(a.inFlight).toBe(2); // recent ack (#5) + submitted (#6)
  });

  it("computes completion over success + incomplete + disputed (not inflating)", () => {
    expect(a.success).toBe(2);
    // resolved = 2 success + 2 incomplete + 0 disputed = 4 -> 50%, NOT ~100%
    expect(a.completionRate).toBe(0.5);
  });

  it("latency percentiles + settled earnings", () => {
    expect(a.p50).toBe(10);
    expect(a.p95).toBe(30);
    expect(a.earnings).toBeCloseTo(0.032, 6);
  });

  it("a recent acked job is in-flight (not stuck) and excluded from completion", () => {
    const recent = aggregateModelStats([{ id: "9", state: "Acknowledged", model_id: "0xAAA", ack_at: NOW - 60 }], MODELS, NOW);
    expect(recent[0].stuck).toBe(0);
    expect(recent[0].inFlight).toBe(1);
    expect(recent[0].completionRate).toBeNull();
  });
});

describe("networkAnalytics rollup", () => {
  it("sums across models and reflects real completion", () => {
    const n = networkAnalytics(aggregateModelStats(JOBS, MODELS, NOW));
    expect(n.models).toBe(2);
    expect(n.jobs).toBe(7);
    expect(n.success).toBe(3); // 2 (AAA) + 1 (BBB)
    expect(n.incomplete).toBe(2);
    expect(n.completionRate).toBeCloseTo(3 / 5, 5); // 3 / (3+2+0)
  });
});

describe("aggregateWorkerStats (per-worker reliability)", () => {
  const WJOBS: Job[] = [
    { id: "1", state: "Released", worker: "0xWORKER_A", ack_at: 100, completed_at: 130, worker_share: "16000000000000000" },
    { id: "2", state: "Released", worker: "0xWORKER_A", ack_at: 200, completed_at: 220, worker_share: "16000000000000000" },
    { id: "3", state: "Acknowledged", worker: "0xWORKER_A", ack_at: 300 }, // stuck (>600s ago)
    { id: "4", state: "Completed", worker: "0xWORKER_B", ack_at: 400, completed_at: 460, worker_share: "0" },
  ];
  it("groups by worker, computes reliability, sorts busiest first", () => {
    const ws = aggregateWorkerStats(WJOBS, NOW);
    expect(ws[0].address).toBe("0xWORKER_A");
    expect(ws[0].total).toBe(3);
    expect(ws[0].success).toBe(2);
    expect(ws[0].stuck).toBe(1);
    expect(ws[0].completionRate).toBeCloseTo(2 / 3, 5);
    expect(ws[0].earnings).toBeCloseTo(0.032, 6);
    const b = ws.find((w) => w.address === "0xWORKER_B")!;
    expect(b.completionRate).toBe(1);
  });
  it("honors the limit", () => {
    expect(aggregateWorkerStats(WJOBS, NOW, 1)).toHaveLength(1);
  });
});

describe("modelStatsCsv", () => {
  it("emits a header (with incomplete/stuck) + one row per model", () => {
    const csv = modelStatsCsv(aggregateModelStats(JOBS, MODELS, NOW));
    const lines = csv.split("\n");
    expect(lines[0]).toContain("incomplete");
    expect(lines[0]).toContain("stuck");
    expect(lines).toHaveLength(3);
  });
});
