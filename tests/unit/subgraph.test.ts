import { describe, it, expect } from "vitest";
import { summarize, isLive, type Worker, type ModelInfo } from "@/lib/subgraph";

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
  it("is true for an active worker seen within 20m", () => {
    expect(isLive({ status: "active", last_seen_at: now - 60 })).toBe(true);
  });
  it("is false when stale (>20m)", () => {
    expect(isLive({ status: "active", last_seen_at: now - 7200 })).toBe(false);
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
    expect(s.live).toBe(1); // only 0xA is fresh + active
  });
  it("counts only enabled+whitelisted models", () => {
    expect(s.models).toBe(2);
  });
  it("sums jobs + earnings", () => {
    expect(s.jobsCompleted).toBe(160);
    expect(s.totalEarnedLcai).toBeCloseTo(2.56);
  });
});
