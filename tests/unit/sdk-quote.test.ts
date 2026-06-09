import { describe, it, expect } from "vitest";
import { quoteVerdict, rankModelChoice } from "../../sdk/src/index";

describe("preInferenceQuote verdict composer", () => {
  const base = { feeLcai: 0.02, enabled: true, eligibleWorkers: 4, completionRate: 0.91, p95: 7.8, refundWindowSec: 24 * 3600 };

  it("fuses fee, eligible-worker depth, completion, p95, and refund window", () => {
    const v = quoteVerdict(base);
    expect(v).toContain("fee 0.02 LCAI");
    expect(v).toContain("4 eligible workers");
    expect(v).toContain("91% completion");
    expect(v).toContain("p95 7.8s");
    expect(v).toMatch(/refund in ~1\.0d if stalled/);
  });

  it("warns when a model is served by a single worker (no redundancy)", () => {
    const v = quoteVerdict({ ...base, eligibleWorkers: 1 });
    expect(v).toContain("1 eligible worker");
    expect(v).toContain("single worker, no redundancy");
  });

  it("refuses to route when no workers are eligible", () => {
    expect(quoteVerdict({ ...base, eligibleWorkers: 0 })).toMatch(/no workers are currently eligible/i);
  });

  it("refuses to route when the model is disabled", () => {
    expect(quoteVerdict({ ...base, enabled: false })).toMatch(/not currently enabled/i);
  });

  it("omits completion and p95 cleanly when there's no sample", () => {
    const v = quoteVerdict({ ...base, completionRate: null, p95: null });
    expect(v).not.toContain("completion");
    expect(v).not.toContain("p95");
    expect(v).toContain("4 eligible workers");
  });

  it("humanizes the refund window across scales", () => {
    expect(quoteVerdict({ ...base, refundWindowSec: 45 })).toMatch(/~45s/);
    expect(quoteVerdict({ ...base, refundWindowSec: 600 })).toMatch(/~10m/);
    expect(quoteVerdict({ ...base, refundWindowSec: 3 * 3600 })).toMatch(/~3\.0h/);
  });
});

describe("chooseModel ranker (rankModelChoice)", () => {
  const ok = { feeLcai: 0.02, enabled: true, eligibleWorkers: 10, completionRate: 0.94, p95: 36 };

  it("meets when all constraints pass", () => {
    const r = rankModelChoice(ok, { maxFeeLcai: 0.05, maxP95Sec: 60, minCompletionRate: 0.9, minEligibleWorkers: 3 });
    expect(r.meets).toBe(true);
    expect(r.dropReasons).toEqual([]);
  });

  it("drops with a reason for each violated constraint", () => {
    expect(rankModelChoice(ok, { maxFeeLcai: 0.01 }).dropReasons.join()).toMatch(/fee/);
    expect(rankModelChoice(ok, { minEligibleWorkers: 50 }).dropReasons.join()).toMatch(/eligible < min/);
    expect(rankModelChoice(ok, { minCompletionRate: 0.99 }).dropReasons.join()).toMatch(/completion/);
    expect(rankModelChoice(ok, { maxP95Sec: 10 }).dropReasons.join()).toMatch(/p95/);
    expect(rankModelChoice(ok, { maxP95Sec: 10 }).meets).toBe(false);
  });

  it("always drops a disabled model or one with no eligible workers", () => {
    expect(rankModelChoice({ ...ok, enabled: false }, {}).dropReasons).toContain("model disabled");
    expect(rankModelChoice({ ...ok, eligibleWorkers: 0 }, {}).dropReasons).toContain("no eligible workers");
  });

  it("scores higher completion + redundancy above a fragile single-worker model", () => {
    const strong = rankModelChoice(ok, {}).score;
    const fragile = rankModelChoice({ ...ok, eligibleWorkers: 1, completionRate: 0.6 }, {}).score;
    expect(strong).toBeGreaterThan(fragile);
  });

  it("does not drop on completion when there is no sample (null)", () => {
    const r = rankModelChoice({ ...ok, completionRate: null }, { minCompletionRate: 0.9 });
    expect(r.dropReasons.join()).not.toMatch(/completion/);
  });
});
