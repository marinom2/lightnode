import { describe, it, expect } from "vitest";
import { decodeTypedPermit, summarizeTypedData, siweOriginMismatch } from "./typed-data";

const SPENDER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const TOKEN = "0x9cA8530CA349c966Fe9ef903Df17a75B8A778927";
const MAX_UINT256 = ((1n << 256n) - 1n).toString();
const MAX_UINT160 = ((1n << 160n) - 1n).toString();

describe("decodeTypedPermit", () => {
  it("decodes ERC-2612 Permit and flags unlimited values", () => {
    const p = decodeTypedPermit("Permit", { owner: "0x1", spender: SPENDER, value: MAX_UINT256, nonce: 1, deadline: "1893456000" });
    expect(p.kind).toBe("permit");
    expect(p.spender).toBe(SPENDER);
    expect(p.unlimited).toBe(true);
    expect(p.summary).toContain("UNLIMITED");
  });
  it("decodes bounded Permit without the unlimited flag", () => {
    const p = decodeTypedPermit("Permit", { spender: SPENDER, value: "1000000", deadline: "1893456000" });
    expect(p.unlimited).toBe(false);
    expect(p.amount).toBe("1000000");
  });
  it("decodes Permit2 PermitSingle with the uint160 sentinel", () => {
    const p = decodeTypedPermit("PermitSingle", { spender: SPENDER, details: { token: TOKEN, amount: MAX_UINT160, expiration: "1893456000", nonce: 0 } });
    expect(p.kind).toBe("permit2");
    expect(p.token).toBe(TOKEN);
    expect(p.unlimited).toBe(true);
  });
  it("decodes Permit2 PermitBatch and counts items", () => {
    const p = decodeTypedPermit("PermitBatch", { spender: SPENDER, details: [{ token: TOKEN, amount: "5" }, { token: TOKEN, amount: MAX_UINT160 }] });
    expect(p.kind).toBe("permit2-batch");
    expect(p.itemCount).toBe(2);
    expect(p.unlimited).toBe(true);
    expect(p.summary).toContain("2 tokens");
  });
  it("summarizes Seaport orders", () => {
    const p = decodeTypedPermit("OrderComponents", { offer: [{}, {}], consideration: [{}] });
    expect(p.kind).toBe("seaport");
    expect(p.summary).toContain("OFFER 2 items");
  });
  it("returns none for unknown types and junk messages", () => {
    expect(decodeTypedPermit("Mail", { contents: "hi" }).kind).toBe("none");
    expect(decodeTypedPermit("Permit", null).kind).toBe("none");
    expect(decodeTypedPermit("Permit", { spender: "junk", value: "not-a-number" }).kind).toBe("none");
  });
});

describe("summarizeTypedData carries the decoded permit", () => {
  it("end to end through a JSON payload", () => {
    const payload = JSON.stringify({
      domain: { name: "USDC", chainId: 1, verifyingContract: TOKEN },
      primaryType: "Permit",
      message: { spender: SPENDER, value: MAX_UINT256, deadline: "0" },
    });
    const s = summarizeTypedData(payload, [1]);
    expect(s.chainIdOk).toBe(true);
    expect(s.permit.kind).toBe("permit");
    expect(s.permit.unlimited).toBe(true);
  });
});

describe("siweOriginMismatch", () => {
  it("flags a lookalike domain replaying a SIWE message", () => {
    const msg = "app.uniswap.org wants you to sign in with your Ethereum account:\n0xabc...";
    const r = siweOriginMismatch(msg, "https://app.unlswap.org");
    expect(r).toEqual({ stated: "app.uniswap.org", actual: "app.unlswap.org" });
  });
  it("accepts the EIP-4361 scheme-prefixed form without a false alarm", () => {
    const msg = "https://app.uniswap.org wants you to sign in with your Ethereum account:\n0xabc";
    expect(siweOriginMismatch(msg, "https://app.uniswap.org")).toBeNull();
  });
  it("passes a matching origin and ignores non-SIWE text", () => {
    const msg = "app.uniswap.org wants you to sign in with your Ethereum account:\n0xabc";
    expect(siweOriginMismatch(msg, "https://app.uniswap.org")).toBeNull();
    expect(siweOriginMismatch("hello world", "https://x.com")).toBeNull();
  });
});
