import { describe, it, expect } from "vitest";
import { tiersFrom } from "./gas";
import { looksLikeEnsName } from "./ens";

describe("tiersFrom", () => {
  it("builds three tiers with base-fee headroom plus the percentile tip", () => {
    const base = 10n * 10n ** 9n; // 10 gwei
    const t = tiersFrom(base, [1n * 10n ** 9n, 2n * 10n ** 9n, 5n * 10n ** 9n]);
    expect(t.slow.maxPriorityFeePerGas).toBe((1n * 10n ** 9n).toString());
    expect(t.fast.maxPriorityFeePerGas).toBe((5n * 10n ** 9n).toString());
    expect(BigInt(t.normal.maxFeePerGas)).toBe(base * 2n + 2n * 10n ** 9n);
    expect(BigInt(t.fast.maxFeePerGas)).toBeGreaterThan(BigInt(t.slow.maxFeePerGas));
  });
  it("floors zero percentiles to a non-zero includable tip", () => {
    const t = tiersFrom(0n, [0n, 0n, 0n]);
    expect(BigInt(t.slow.maxPriorityFeePerGas)).toBeGreaterThan(0n);
  });
});

describe("looksLikeEnsName", () => {
  it("accepts plausible .eth names and rejects addresses/garbage", () => {
    expect(looksLikeEnsName("vitalik.eth")).toBe(true);
    expect(looksLikeEnsName("sub.domain.eth")).toBe(true);
    expect(looksLikeEnsName("0x742d35Cc6634C0532925a3b844Bc454e4438f44e")).toBe(false);
    expect(looksLikeEnsName("hello")).toBe(false);
    expect(looksLikeEnsName(".eth")).toBe(false);
  });
});
