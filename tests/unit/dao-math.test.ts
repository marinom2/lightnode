import { describe, it, expect } from "vitest";
import { quorumStatus, delegationStatus, quorumPercent, formatLcaiWei } from "../../app/build/dao/dao-math";

const e = (n: number) => BigInt(n) * 10n ** 18n; // n LCAI in wei
const ZERO = "0x0000000000000000000000000000000000000000";
const ME = "0x45c1a168E25e9cA85A730EC4F0daf50f7B9FF56c";

describe("quorumStatus (OZ GovernorCountingSimple: For + Abstain count)", () => {
  it("reports distance when below quorum", () => {
    const s = quorumStatus(e(100), e(50), e(300)); // progress 150 of 300
    expect(s.progressWei).toBe(e(150));
    expect(s.distanceWei).toBe(e(150));
    expect(s.met).toBe(false);
    expect(s.pct).toBe(50);
  });

  it("excludes Against votes from quorum progress", () => {
    // Against is huge but must NOT count toward quorum.
    const s = quorumStatus(e(10), e(0), e(300));
    expect(s.progressWei).toBe(e(10));
    expect(s.distanceWei).toBe(e(290));
  });

  it("marks quorum met and clamps distance to zero", () => {
    const s = quorumStatus(e(400), e(0), e(300));
    expect(s.met).toBe(true);
    expect(s.distanceWei).toBe(0n);
    expect(s.pct).toBe(100);
  });

  it("treats a zero quorum as unknown", () => {
    const s = quorumStatus(e(100), e(0), 0n);
    expect(s.known).toBe(false);
    expect(s.met).toBe(false);
    expect(s.pct).toBe(0);
  });

  it("stays precise at 1e28-scale supplies (no float overflow)", () => {
    const supply = 10_000_000_000n * 10n ** 18n; // 10B tokens
    const quorum = (supply * 3n) / 100n; // 3% = 300M
    const s = quorumStatus(quorum, 0n, quorum);
    expect(s.met).toBe(true);
    expect(s.distanceWei).toBe(0n);
  });
});

describe("delegationStatus (balance vs active power)", () => {
  it("flags an undelegated holder", () => {
    const s = delegationStatus(0n, e(500), ZERO, ME);
    expect(s.kind).toBe("undelegated");
    expect(s.gapWei).toBe(e(500));
  });

  it("recognises self-delegation with no gap", () => {
    const s = delegationStatus(e(500), e(500), ME, ME);
    expect(s.kind).toBe("self");
    expect(s.gapWei).toBe(0n);
  });

  it("is case-insensitive on the self check", () => {
    const s = delegationStatus(e(10), e(10), ME.toLowerCase(), ME.toUpperCase());
    expect(s.kind).toBe("self");
  });

  it("flags delegation to another address", () => {
    const s = delegationStatus(0n, e(100), "0x1111111111111111111111111111111111111111", ME);
    expect(s.kind).toBe("other");
  });

  it("surfaces a pending gap after a fresh delegation checkpoint", () => {
    const s = delegationStatus(e(100), e(150), ME, ME);
    expect(s.kind).toBe("self");
    expect(s.gapWei).toBe(e(50));
  });
});

describe("quorumPercent", () => {
  it("computes 3/100 as 3%", () => {
    expect(quorumPercent("3", "100")).toBe(3);
  });
  it("computes 30/100 as 30%", () => {
    expect(quorumPercent("30", "100")).toBe(30);
  });
  it("guards against a zero denominator", () => {
    expect(quorumPercent("3", "0")).toBe(0);
  });
});

describe("formatLcaiWei", () => {
  it("formats whole tokens with grouping", () => {
    expect(formatLcaiWei(e(1_234_567), 0)).toBe((1234567).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  });
  it("shows a floor for dust", () => {
    expect(formatLcaiWei(1n)).toBe("<0.0001");
  });
  it("formats zero as 0", () => {
    expect(formatLcaiWei(0n)).toBe("0");
  });
});
