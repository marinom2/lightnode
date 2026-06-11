import { describe, it, expect } from "vitest";
import { humanizeError } from "./humanize";

describe("humanizeError", () => {
  it("maps insufficient funds to a short sentence with the asset symbol", () => {
    const raw = "insufficient funds for gas * price + value: address 0x9A2e have 0 want 1000000000000000000";
    expect(humanizeError(raw, "LCAI")).toBe("Not enough LCAI to cover the amount plus the network fee.");
  });

  it("maps user rejection", () => {
    expect(humanizeError("User rejected the request.")).toBe("Request rejected.");
  });

  it("maps nonce conflicts to pending-transaction guidance", () => {
    expect(humanizeError("nonce too low: next nonce 5, tx nonce 4")).toContain("pending transaction");
    expect(humanizeError("replacement transaction underpriced")).toContain("pending transaction");
  });

  it("maps gas shortfalls", () => {
    expect(humanizeError("intrinsic gas too low")).toBe("The network fee could not be covered. Lower the amount.");
  });

  it("maps network failures", () => {
    expect(humanizeError("Failed to fetch")).toBe("Network error. Check your connection and try again.");
  });

  it("truncates unknown errors to the first line, capped at 120 chars", () => {
    const raw = `${"x".repeat(200)}\nsecond line`;
    const out = humanizeError(raw);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("second line");
  });
});
