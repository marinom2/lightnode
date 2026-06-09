import { describe, it, expect } from "vitest";
import { aggregateFeeRevenue } from "../../lib/analytics";
import type { Job, ModelInfo } from "../../lib/subgraph";

const models: ModelInfo[] = [
  { id: "0xaaa", name: "llama3-8b", fee: "20000000000000000", max_output_tokens: 2048, is_whitelisted: true, is_enabled: true }, // 0.02
  { id: "0xbbb", name: "llama3-70b", fee: "150000000000000000", max_output_tokens: 4096, is_whitelisted: true, is_enabled: true }, // 0.15
];
const job = (state: string, model_id: string, completed_at?: number): Job => ({ id: `${state}-${model_id}-${completed_at}`, state, model_id, completed_at } as Job);
const jobs: Job[] = [
  job("Completed", "0xaaa", 1000),
  job("Released", "0xaaa", 1000 + 86400),
  job("Completed", "0xbbb", 1000 + 43200),
  job("TimedOut", "0xaaa"),
  job("Disputed", "0xbbb"),
];
const feeBps = { worker: 8000, protocol: 1500, feePool: 500 };

describe("aggregateFeeRevenue", () => {
  const r = aggregateFeeRevenue(jobs, models, feeBps, 2_000_000);

  it("counts settled vs refunded and the capture rate", () => {
    expect(r.settledCount).toBe(3);
    expect(r.refundedCount).toBe(2);
    expect(r.captureRate).toBeCloseTo(0.6, 5);
  });

  it("splits gross fee by the live fee bps", () => {
    expect(r.totalGrossLcai).toBeCloseTo(0.19, 6); // 0.02 + 0.02 + 0.15
    expect(r.protocolLcai).toBeCloseTo(0.0285, 6); // 15%
    expect(r.feePoolLcai).toBeCloseTo(0.0095, 6); // 5%
    expect(r.workerLcai).toBeCloseTo(0.152, 6); // 80%
  });

  it("derives per-day figures from the actual sample span", () => {
    expect(r.spanSec).toBe(86400); // first settled 1000, last 87400
    expect(r.perDay.grossLcai).toBeCloseTo(0.19, 6); // exactly one day of span
  });

  it("ranks per-model revenue by gross, highest first", () => {
    expect(r.perModel[0].name).toBe("llama3-70b");
    expect(r.perModel[0].grossLcai).toBeCloseTo(0.15, 6);
    expect(r.perModel[1].settled).toBe(2); // two llama3-8b jobs
  });

  it("handles an empty sample without dividing by zero", () => {
    const e = aggregateFeeRevenue([], models, feeBps, 1000);
    expect(e.captureRate).toBeNull();
    expect(e.perDay.protocolLcai).toBe(0);
    expect(e.totalGrossLcai).toBe(0);
  });
});
