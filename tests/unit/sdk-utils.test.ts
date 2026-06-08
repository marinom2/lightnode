import { describe, it, expect } from "vitest";
import { toWei, fromWei, checksum, isValidAddress, truncateAddress, mapWithConcurrency } from "../../sdk/src/index";

describe("toWei / fromWei", () => {
  it("converts whole and fractional LCAI to exact wei", () => {
    expect(toWei(1)).toBe(10n ** 18n);
    expect(toWei(0.001)).toBe(10n ** 15n);
    expect(toWei(50_000)).toBe(50_000n * 10n ** 18n);
    expect(toWei(0)).toBe(0n);
    expect(toWei(0.016)).toBe(16n * 10n ** 15n);
  });
  it("ignores precision past 18 decimals and handles non-finite", () => {
    expect(toWei(NaN)).toBe(0n);
    expect(toWei(Infinity)).toBe(0n);
  });
  it("handles exponential-range values without throwing (toString emits 1e+21 / 1e-7)", () => {
    expect(toWei(1e21)).toBe(10n ** 21n * 10n ** 18n); // large treasury amount
    expect(toWei(1e-7)).toBe(10n ** 11n); // sub-microtoken dust
    expect(toWei(-1)).toBe(-(10n ** 18n));
    expect(toWei(0.1)).toBe(10n ** 17n); // still exact for nice decimals
  });
  it("round-trips with fromWei for representative amounts", () => {
    expect(fromWei(toWei(0.016).toString())).toBeCloseTo(0.016, 9);
    // fromWei does Number(wei)/1e18, which loses precision past 2^53 - toWei is the
    // exact one. Round-trip is close, not bit-exact, for large amounts.
    expect(fromWei(toWei(50_000).toString())).toBeCloseTo(50_000, 3);
  });
});

describe("address helpers", () => {
  const lower = "0xdf589ff8897c351d4e09e688b333c67fcb027802";
  it("checksums a valid address and leaves junk untouched", () => {
    expect(checksum(lower)).toBe("0xdf589ff8897C351d4E09E688b333C67fcB027802");
    expect(checksum("not-an-address")).toBe("not-an-address");
  });
  it("validates address syntax", () => {
    expect(isValidAddress(lower)).toBe(true);
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
  it("truncates for display", () => {
    expect(truncateAddress(lower)).toBe("0xdf58…7802");
    expect(truncateAddress(lower, 6)).toBe("0xdf589f…027802");
    expect(truncateAddress("0xabc")).toBe("0xabc"); // too short to truncate
    expect(truncateAddress(lower, 0)).toBe("0xd…2"); // chars=0 must not return the whole string
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const out = await mapWithConcurrency([5, 1, 3], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6]);
  });
  it("never runs more than `limit` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("handles empty input and a limit larger than the list", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (x) => x * 10)).toEqual([10, 20]);
  });
});
