import { describe, it, expect } from "vitest";
import { humanizeError } from "../../lib/humanize-error";

describe("humanizeError", () => {
  it("maps fetch reachability errors to a network hint", () => {
    expect(humanizeError(new TypeError("Failed to fetch"))).toMatch(/Could not reach the network/i);
    expect(humanizeError(new Error("fetch failed"))).toMatch(/Could not reach the network/i);
  });

  it("maps Vercel function timeout to a budget hint", () => {
    expect(humanizeError(new Error("FUNCTION_INVOCATION_TIMEOUT"))).toMatch(/took longer to respond/i);
  });

  it("maps rate limit text and surfaces the actual cap", () => {
    expect(humanizeError(new Error("Demo rate limit hit (3 per hour per IP)."))).toMatch(/3 per hour/i);
    expect(humanizeError(new Error("HTTP 429 Too Many Requests"))).toMatch(/Rate limit hit/i);
  });

  it("maps wallet rejection to a clear, no-charge message", () => {
    expect(humanizeError(new Error("User rejected the request."))).toMatch(/rejected the request in your wallet/i);
    expect(humanizeError(new Error("MetaMask Tx Signature: User denied transaction signature."))).toMatch(/rejected the request in your wallet/i);
  });

  it("collapses the full viem rejection dump (calldata + ABI + docs) to one clean line", () => {
    // The exact shape viem throws on a rejected createSession: calldata, the
    // full ABI signature, a docs link, and the viem version. None of it may
    // reach the user.
    const viemDump =
      "User rejected the request. Request Arguments: from: 0x45c1a168E25e9cA85A730EC4F0daf50f7B9FF56c " +
      "to: 0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b data: 0xe80116b4f4a414fa51803433e9197f32cda96d5c " +
      "gas: 1000000 Contract Call: address: 0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b " +
      "function: createSession(bytes32 paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey, bytes initState, uint256 expiry) " +
      "Docs: https://viem.sh/docs/contract/writeContract Details: MetaMask Tx Signature: User denied transaction signature. Version: viem@2.50.4";
    const out = humanizeError(new Error(viemDump));
    expect(out).toMatch(/rejected the request in your wallet/i);
    expect(out).not.toMatch(/0xe80116|createSession|viem@|Docs:|Contract Call/);
    expect(out.length).toBeLessThan(120);
  });

  it("maps a too-low balance (pre-send) to a top-up hint", () => {
    expect(humanizeError(new Error("insufficient funds for gas * price + value"))).toMatch(/enough LCAI/i);
    expect(humanizeError(new Error("The total cost of executing this transaction exceeds the balance of the account."))).toMatch(/enough LCAI/i);
  });

  it("maps execution reverted to a one-liner without the hex", () => {
    expect(humanizeError(new Error("execution reverted: 0xdeadbeef"))).toMatch(/On-chain call reverted/i);
    expect(humanizeError(new Error("execution reverted: Pausable: paused"))).toMatch(/On-chain call reverted: Pausable: paused/i);
  });

  it("maps JSON-parse on HTML response to the proxy-error hint", () => {
    expect(humanizeError(new Error("Unexpected token 'A', \"An error o\"... is not valid JSON"))).toMatch(/unexpected response/i);
  });

  it("maps StalledWorkerError to the refund/retry hint", () => {
    expect(humanizeError(new Error("StalledWorkerError"))).toMatch(/Worker stalled/i);
  });

  it("falls back to the first sentence trimmed when nothing matches", () => {
    expect(humanizeError(new Error("Error: bizarre but short"))).toBe("bizarre but short");
  });

  it("falls back to a generic message when given null/empty", () => {
    expect(humanizeError(null)).toMatch(/Something went wrong/i);
    expect(humanizeError(new Error(""))).toMatch(/Something went wrong/i);
  });

  it("threads the action context into the generic fallback", () => {
    expect(humanizeError(null, { action: "the bridge quote" })).toMatch(/with the bridge quote/i);
  });
});
