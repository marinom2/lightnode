import { describe, it, expect } from "vitest";
import { parseTokenBalances } from "./tokens";

const tok = (over: Record<string, unknown> = {}) => ({
  token: { address_hash: "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927", symbol: "LCAI", decimals: "18", type: "ERC-20", ...over },
  value: "1000000000000000000",
});

describe("parseTokenBalances", () => {
  it("parses ERC-20 holdings and supports both address field names", () => {
    const legacy = { token: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: "6", type: "ERC-20" }, value: "5" };
    const out = parseTokenBalances([tok(), legacy]);
    expect(out).toHaveLength(2);
    expect(out[1]!.symbol).toBe("USDC");
  });
  it("drops zero balances, NFT types, bad addresses, and clamps hostile symbols", () => {
    const out = parseTokenBalances([
      { ...tok(), value: "0" },
      tok({ type: "ERC-721" }),
      tok({ address_hash: "0xshort" }),
      tok({ symbol: "\u202Eevil" + "X".repeat(40) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol.length).toBeLessThanOrEqual(12);
    expect(out[0]!.symbol).not.toContain("\u202E");
  });
  it("caps the list and survives junk", () => {
    expect(parseTokenBalances(null)).toEqual([]);
    expect(parseTokenBalances([{ a: 1 }, null])).toEqual([]);
    const many = Array.from({ length: 50 }, () => tok());
    expect(parseTokenBalances(many).length).toBeLessThanOrEqual(30);
  });
});
