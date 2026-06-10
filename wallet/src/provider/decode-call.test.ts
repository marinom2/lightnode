import { describe, it, expect } from "vitest";
import { encodeFunctionData, maxUint256, type Hex } from "viem";
import { decodeDangerousCall } from "./decode-call";
import { summarizeTypedData } from "./typed-data";

const SPENDER = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";

const erc20 = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] },
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }] },
  { type: "function", name: "setApprovalForAll", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }] },
  { type: "function", name: "safeTransferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }, { name: "data", type: "bytes" }] },
] as const;
const data = (name: string, args: readonly unknown[]): Hex => encodeFunctionData({ abi: erc20, functionName: name, args });

describe("decodeDangerousCall", () => {
  it("treats no data as a native transfer", () => {
    expect(decodeDangerousCall("0x").kind).toBe("empty");
    expect(decodeDangerousCall(undefined).kind).toBe("empty");
  });
  it("flags an UNLIMITED approve as danger", () => {
    const d = decodeDangerousCall(data("approve", [SPENDER, maxUint256]));
    expect(d.kind).toBe("approve");
    expect(d.severity).toBe("danger");
    expect(d.unlimited).toBe(true);
    expect(d.detail).toContain("UNLIMITED");
  });
  it("reports a bounded approve without the unlimited flag", () => {
    const d = decodeDangerousCall(data("approve", [SPENDER, 1000n]));
    expect(d.unlimited).toBe(false);
    expect(d.severity).toBe("danger");
    expect(d.spender?.toLowerCase()).toBe(SPENDER);
  });
  it("hard-flags setApprovalForAll(true) and softens revoke", () => {
    expect(decodeDangerousCall(data("setApprovalForAll", [SPENDER, true])).severity).toBe("danger");
    expect(decodeDangerousCall(data("setApprovalForAll", [SPENDER, false])).severity).toBe("info");
  });
  it("classifies transfer + 4-arg safeTransferFrom (review fix) as transfers", () => {
    expect(decodeDangerousCall(data("transfer", [TO, 5n])).kind).toBe("transfer");
    const st = decodeDangerousCall(data("safeTransferFrom", [SPENDER, TO, 7n, "0x"]));
    expect(st.kind).toBe("transferFrom");
    expect(st.recipient?.toLowerCase()).toBe(TO);
  });
  it("falls back to a guarded 'unknown' for unrecognized selectors", () => {
    expect(decodeDangerousCall("0xdeadbeef00000000").kind).toBe("unknown");
  });
});

describe("summarizeTypedData", () => {
  const base = { domain: { name: "Uniswap", chainId: 9200, verifyingContract: SPENDER }, primaryType: "Mail", message: {} };
  it("accepts a payload whose chainId is allowed", () => {
    const s = summarizeTypedData(JSON.stringify(base), [9200, 8200]);
    expect(s.chainIdOk).toBe(true);
    expect(s.domainName).toBe("Uniswap");
    expect(s.verifyingContract).toBe(SPENDER);
  });
  it("rejects a mismatched chainId", () => {
    expect(summarizeTypedData(JSON.stringify({ ...base, domain: { ...base.domain, chainId: 1 } }), [9200]).chainIdOk).toBe(false);
  });
  it("warns on Permit primary types", () => {
    expect(summarizeTypedData(JSON.stringify({ ...base, primaryType: "Permit" }), [9200]).warning).toBeTruthy();
  });
  it("handles malformed input safely", () => {
    expect(summarizeTypedData("{not json", [9200]).error).toBeTruthy();
  });
});
