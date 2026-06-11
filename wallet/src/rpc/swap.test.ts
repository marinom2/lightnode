import { describe, it, expect } from "vitest";
import { buildSwapCall, minOutFor, DEX } from "./swap";

const ME = "0x73c0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaeb5e" as const;
const LCAI = "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927" as const;
const SEL_EXACT_INPUT = "04e45aaf"; // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
const SEL_UNWRAP = "49404b7c"; // unwrapWETH9(uint256,address)
const SEL_MULTICALL_DL = "0x5ae401dc"; // multicall(uint256,bytes[])
const DL = 1893456000n; // fixed deadline

describe("minOutFor", () => {
  it("applies 0.5% default slippage, rounding down", () => {
    expect(minOutFor(10000n)).toBe(9950n);
    expect(minOutFor(1n)).toBe(1n); // floor division keeps tiny amounts intact
  });
});

describe("buildSwapCall", () => {
  it("every swap is a deadline-bounded multicall to the router", () => {
    const c = buildSwapCall(1, ME, { token: LCAI, decimals: 18 }, { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }, 10n ** 18n, 1n, 3000, DL);
    expect(c.to).toBe(DEX[1]!.router);
    expect(c.value).toBe(0n);
    expect(c.data.startsWith(SEL_MULTICALL_DL)).toBe(true);
    expect(c.data).toContain(SEL_EXACT_INPUT); // inner swap
    expect(c.data.toLowerCase()).toContain(ME.slice(2).toLowerCase()); // recipient = user
  });

  it("native -> ERC20: tokenIn is WETH9 and value carries the amount", () => {
    const c = buildSwapCall(1, ME, { token: null, decimals: 18 }, { token: LCAI, decimals: 18 }, 5n * 10n ** 17n, 1n, 3000, DL);
    expect(c.value).toBe(5n * 10n ** 17n);
    expect(c.data.startsWith(SEL_MULTICALL_DL)).toBe(true);
    expect(c.data.toLowerCase()).toContain(DEX[1]!.weth.slice(2).toLowerCase());
  });

  it("ERC20 -> native: inner swap-to-router + unwrapWETH9 to the user", () => {
    const c = buildSwapCall(1, ME, { token: LCAI, decimals: 18 }, { token: null, decimals: 18 }, 10n ** 18n, 99n, 3000, DL);
    expect(c.value).toBe(0n);
    expect(c.data.startsWith(SEL_MULTICALL_DL)).toBe(true);
    expect(c.data).toContain(SEL_EXACT_INPUT);
    expect(c.data).toContain(SEL_UNWRAP);
    // ADDRESS_THIS sentinel routes the intermediate WETH to the router
    expect(c.data).toContain("0000000000000000000000000000000000000002");
    expect(c.data.toLowerCase()).toContain(ME.slice(2).toLowerCase()); // unwrap recipient = user
  });

  it("throws on unsupported chains (LightChain has no DEX)", () => {
    expect(() => buildSwapCall(9200, ME, { token: null, decimals: 18 }, { token: LCAI, decimals: 18 }, 1n, 1n, 3000, DL)).toThrow();
  });
});
