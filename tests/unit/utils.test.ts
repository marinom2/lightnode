import { describe, it, expect } from "vitest";
import { fromWei, compact, fmt, timeAgo, shortAddr } from "@/lib/utils";

describe("fromWei", () => {
  it("converts 18-decimal wei to LCAI", () => {
    expect(fromWei("20000000000000000")).toBeCloseTo(0.02);
    // large values lose float precision (fine — display always rounds)
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

describe("timeAgo", () => {
  it("renders relative time", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(timeAgo(now - 10)).toMatch(/s ago/);
    expect(timeAgo(now - 3600)).toMatch(/h ago/);
    expect(timeAgo(undefined)).toBe("never");
  });
});
