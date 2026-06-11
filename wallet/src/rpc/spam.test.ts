import { describe, it, expect } from "vitest";
import { assessTokenRisk, assessNftRisk } from "./spam";

const OFFICIAL = new Set(["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"]);

describe("assessTokenRisk", () => {
  it("flags claim-bait and URL-bearing names", () => {
    expect(assessTokenRisk("Visit rewards.xyz", "0x1111111111111111111111111111111111111111", OFFICIAL).spam).toBe(true);
    expect(assessTokenRisk("$ CLAIM AIRDROP", "0x1111111111111111111111111111111111111111", OFFICIAL).spam).toBe(true);
  });
  it("flags blue-chip impersonation from the wrong contract", () => {
    const v = assessTokenRisk("USDC", "0x2222222222222222222222222222222222222222", OFFICIAL);
    expect(v.spam).toBe(true);
    expect(v.reason).toContain("official");
  });
  it("passes the REAL blue-chip contract and ordinary tokens", () => {
    expect(assessTokenRisk("USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", OFFICIAL).spam).toBe(false);
    expect(assessTokenRisk("ARB", "0x3333333333333333333333333333333333333333", OFFICIAL).spam).toBe(false);
  });
  it("flags glyph-soup symbols", () => {
    expect(assessTokenRisk("✅🎁💰", "0x4444444444444444444444444444444444444444", OFFICIAL).spam).toBe(true);
  });
});

describe("assessNftRisk", () => {
  it("flags claim-bait NFTs and passes normal ones", () => {
    expect(assessNftRisk("Claim 3000 USDT at site.xyz", "").spam).toBe(true);
    expect(assessNftRisk("Light Genesis #214", "LightChain Genesis").spam).toBe(false);
  });
});
