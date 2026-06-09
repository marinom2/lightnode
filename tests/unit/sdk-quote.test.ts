import { describe, it, expect } from "vitest";
import { quoteVerdict } from "../../sdk/src/index";

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
