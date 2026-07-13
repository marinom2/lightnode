import { describe, it, expect } from "vitest";
import { parseBitmartTicker } from "./markets";

// A real BitMart v3 ticker envelope for LCAI_USDT.
const REAL = {
  code: 1000,
  message: "success",
  trace: "abc",
  data: {
    v_24h: "27980788.06",
    qv_24h: "84484.156761",
    open_24h: "0.002200",
    high_24h: "0.003251",
    low_24h: "0.002200",
    fluctuation: "0.36500",
    bid_px: "0.003001",
    bid_sz: "6664.45",
    ask_px: "0.003013",
    symbol: "LCAI_USDT",
    ts: "1783578455628",
    last: "0.003003",
    ask_sz: "6667.39",
  },
};

describe("parseBitmartTicker", () => {
  it("parses the real envelope into typed numbers", () => {
    const m = parseBitmartTicker(REAL);
    expect(m).not.toBeNull();
    expect(m!.symbol).toBe("LCAI_USDT");
    expect(m!.lastUsd).toBeCloseTo(0.003003, 8);
    expect(m!.high24h).toBeCloseTo(0.003251, 8);
    expect(m!.low24h).toBeCloseTo(0.0022, 8);
    expect(m!.baseVol24h).toBeCloseTo(27980788.06, 2);
    expect(m!.quoteVol24h).toBeCloseTo(84484.156761, 6);
    expect(m!.ts).toBe(1783578455628);
  });

  it("reads fluctuation as a ratio -> percent", () => {
    expect(parseBitmartTicker(REAL)!.changePct24h).toBeCloseTo(36.5, 3);
  });

  it("handles a negative fluctuation", () => {
    const m = parseBitmartTicker({ data: { ...REAL.data, fluctuation: "-0.05" } });
    expect(m!.changePct24h).toBeCloseTo(-5, 6);
  });

  it("derives change from open when fluctuation is missing", () => {
    const noFlux = { data: { ...REAL.data, fluctuation: undefined } };
    // (0.003003 - 0.0022) / 0.0022 * 100
    expect(parseBitmartTicker(noFlux)!.changePct24h).toBeCloseTo(36.5, 1);
  });

  it("rejects junk, missing data, and a non-positive last price", () => {
    expect(parseBitmartTicker(null)).toBeNull();
    expect(parseBitmartTicker({})).toBeNull();
    expect(parseBitmartTicker({ data: {} })).toBeNull();
    expect(parseBitmartTicker({ data: { last: "0" } })).toBeNull();
    expect(parseBitmartTicker({ data: { last: "notanumber" } })).toBeNull();
  });
});
