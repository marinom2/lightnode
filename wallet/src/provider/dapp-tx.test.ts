import { describe, it, expect } from "vitest";
import { canonicalizeDappTx } from "./dapp-tx";

const TO = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

describe("canonicalizeDappTx", () => {
  it("REGRESSION: preserves the calldata verbatim (a dapp swap must not become an empty transfer)", () => {
    const data = `0x38ed1739${"ab".repeat(128)}`;
    const out = canonicalizeDappTx({ from: "0x1", to: TO, value: "0x0", data });
    expect(out.data).toBe(data);
    expect(out.to).toBe(TO);
    expect(out.value).toBe(0n);
  });
  it("parses hex and decimal values", () => {
    expect(canonicalizeDappTx({ from: "0x1", to: TO, value: "0xde0b6b3a7640000" }).value).toBe(10n ** 18n);
    expect(canonicalizeDappTx({ from: "0x1", to: TO }).value).toBe(0n);
  });
  it("drops empty/malformed data instead of signing junk", () => {
    expect(canonicalizeDappTx({ from: "0x1", to: TO, data: "0x" }).data).toBeUndefined();
    expect(canonicalizeDappTx({ from: "0x1", to: TO, data: "not-hex" }).data).toBeUndefined();
  });
  it("rejects contract creation and bad recipients", () => {
    expect(() => canonicalizeDappTx({ from: "0x1" })).toThrow(/recipient/);
    expect(() => canonicalizeDappTx({ from: "0x1", to: "0xshort" })).toThrow(/recipient/);
  });
  it("rejects unparseable or negative values", () => {
    expect(() => canonicalizeDappTx({ from: "0x1", to: TO, value: "12abc" })).toThrow(/value/);
    expect(() => canonicalizeDappTx({ from: "0x1", to: TO, value: "-5" })).toThrow(/value/);
  });
});
