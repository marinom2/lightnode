import { describe, it, expect } from "vitest";
import { diffProtocolSnapshots, type ProtocolSnapshot } from "../../sdk/src/index";

const base: ProtocolSnapshot = {
  net: "mainnet",
  minStakeLcai: 50000,
  ackTimeoutSec: 60,
  completionTimeoutSec: 120,
  resolutionTimeoutSec: 600,
  disputeWindowSec: 86400,
  slashBps: { ackTimeout: 250, completionTimeout: 500, dispute: 1000, max: 5000 },
  feeBps: { worker: 8000, protocol: 1500, feePool: 500 },
  suspensionThreshold: 3,
  suspensionCooldownSec: 86400,
  models: [
    { id: "0xaaa", name: "llama3-8b", feeLcai: 0.02, enabled: true },
    { id: "0xbbb", name: "llama3-70b", feeLcai: 0.15, enabled: true },
  ],
};
const clone = (s: ProtocolSnapshot): ProtocolSnapshot => JSON.parse(JSON.stringify(s));

describe("diffProtocolSnapshots", () => {
  it("reports no changes for an identical snapshot", () => {
    expect(diffProtocolSnapshots(base, clone(base))).toEqual([]);
  });

  it("catches a slash-bps change with from/to", () => {
    const next = clone(base);
    next.slashBps.completionTimeout = 750;
    const d = diffProtocolSnapshots(base, next);
    expect(d).toEqual([{ path: "slashBps.completionTimeout", from: 500, to: 750 }]);
  });

  it("catches a model fee change and an enabled flip", () => {
    const next = clone(base);
    next.models[0].feeLcai = 0.03;
    next.models[1].enabled = false;
    const d = diffProtocolSnapshots(base, next);
    expect(d).toContainEqual({ path: "model.llama3-8b.feeLcai", from: 0.02, to: 0.03 });
    expect(d).toContainEqual({ path: "model.llama3-70b.enabled", from: "true", to: "false" });
  });

  it("flags an added and a removed model", () => {
    const next = clone(base);
    next.models = [base.models[0], { id: "0xccc", name: "llama3-405b", feeLcai: 0.5, enabled: true }];
    const d = diffProtocolSnapshots(base, next);
    expect(d.find((c) => c.path === "model.llama3-405b.feeLcai")?.from).toBe("(absent)");
    expect(d.find((c) => c.path === "model.llama3-70b.feeLcai")?.to).toBe("(removed)");
  });

  it("catches a fee-split rebalance", () => {
    const next = clone(base);
    next.feeBps = { worker: 7500, protocol: 2000, feePool: 500 };
    const paths = diffProtocolSnapshots(base, next).map((c) => c.path);
    expect(paths).toContain("feeBps.worker");
    expect(paths).toContain("feeBps.protocol");
    expect(paths).not.toContain("feeBps.feePool");
  });
});
