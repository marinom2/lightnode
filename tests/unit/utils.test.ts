import { describe, it, expect } from "vitest";
import { fromWei, compact, fmt, timeAgo, shortAddr, stakeBelowFloor } from "@/lib/utils";

describe("fromWei", () => {
  it("converts 18-decimal wei to LCAI", () => {
    expect(fromWei("20000000000000000")).toBeCloseTo(0.02);
    // large values lose float precision (fine - display always rounds)
    expect(fromWei("50000000000000000000000")).toBeCloseTo(50000, 0);
  });
  it("handles null/garbage safely", () => {
    expect(fromWei(null)).toBe(0);
    expect(fromWei(undefined)).toBe(0);
    expect(fromWei("not-a-number")).toBe(0);
  });
});

describe("shortAddr", () => {
  it("truncates the middle", () => {
    expect(shortAddr("0x1F899FaD2C8BD70b6eF356ae6cC3c0abDbB15EB5")).toBe("0x1F89...5EB5");
  });
  it("returns empty for nullish", () => {
    expect(shortAddr(null)).toBe("");
  });
});

describe("compact / fmt", () => {
  it("compacts large numbers", () => {
    expect(compact(50000)).toMatch(/50K/i);
  });
  it("formats with digits", () => {
    expect(fmt(0.123456, 3)).toBe("0.123");
    expect(fmt(undefined)).toBe("0");
  });
});

describe("stakeBelowFloor", () => {
  it("does NOT flag a worker staked exactly at the floor (the 49999.999... float bug)", () => {
    // 50,000 LCAI in wei - fromWei()/1e18 gives 49999.99999999999, but the exact
    // integer comparison must read this as NOT below the 50,000 floor.
    expect(stakeBelowFloor("50000000000000000000000", 50000)).toBe(false);
  });
  it("flags a genuinely slashed (below-floor) stake", () => {
    expect(stakeBelowFloor("49999000000000000000000", 50000)).toBe(true);
    expect(stakeBelowFloor("4999000000000000000000", 5000)).toBe(true); // testnet floor
  });
  it("does not flag an above-floor stake, and is safe on garbage", () => {
    expect(stakeBelowFloor("50001000000000000000000", 50000)).toBe(false);
    expect(stakeBelowFloor(null, 50000)).toBe(false);
    expect(stakeBelowFloor("50000000000000000000000", undefined)).toBe(false);
  });
});

describe("timeAgo", () => {
  it("renders relative time", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 10)).toMatch(/s ago/);
    expect(timeAgo(now - 3600)).toMatch(/h ago/);
    expect(timeAgo(undefined)).toBe("never");
  });
});
