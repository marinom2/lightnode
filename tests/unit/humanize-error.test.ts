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

  it("maps wallet rejection to a clear instruction", () => {
    expect(humanizeError(new Error("User rejected the request."))).toMatch(/Signature request rejected/i);
  });

  it("maps execution reverted to a one-liner without the hex", () => {
    expect(humanizeError(new Error("execution reverted: 0xdeadbeef"))).toMatch(/On-chain call reverted/i);
    expect(humanizeError(new Error("execution reverted: insufficient funds"))).toMatch(/insufficient funds/i);
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
