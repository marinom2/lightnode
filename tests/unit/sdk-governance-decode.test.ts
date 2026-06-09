import { describe, it, expect } from "vitest";
import { decodeGovernanceAction } from "../../sdk/src/index";
import { encodeFunctionData, parseAbi } from "viem";

const ABI = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function upgradeTo(address newImplementation)",
  "function transferOwnership(address newOwner)",
  "function setVotingDelay(uint256 newVotingDelay)",
  "function pause()", // not in the decoder's known set -> unknown
]);
const A = ("0x" + "ab".repeat(20)) as `0x${string}`;
const B = ("0x" + "cd".repeat(20)) as `0x${string}`;

describe("decodeGovernanceAction", () => {
  it("flags a proxy upgrade as dangerous", () => {
    const d = decodeGovernanceAction({ target: A, value: 0n, calldata: encodeFunctionData({ abi: ABI, functionName: "upgradeTo", args: [B] }) });
    expect(d.kind).toBe("upgrade");
    expect(d.dangerous).toBe(true);
    expect(d.label).toMatch(/Upgrade/i);
  });

  it("decodes a token transfer with the amount in whole units", () => {
    const d = decodeGovernanceAction({ target: A, value: 0n, calldata: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [B, 500n * 10n ** 18n] }) });
    expect(d.kind).toBe("transfer");
    expect(d.label).toMatch(/Transfer 500 to/);
    expect(d.dangerous).toBe(true);
  });

  it("flags an ownership handover", () => {
    const d = decodeGovernanceAction({ target: A, value: 0n, calldata: encodeFunctionData({ abi: ABI, functionName: "transferOwnership", args: [B] }) });
    expect(d.kind).toBe("ownership");
    expect(d.dangerous).toBe(true);
  });

  it("labels a governor self-param change (not dangerous)", () => {
    const d = decodeGovernanceAction({ target: A, value: 0n, calldata: encodeFunctionData({ abi: ABI, functionName: "setVotingDelay", args: [42n] }) });
    expect(d.kind).toBe("governance-param");
    expect(d.dangerous).toBe(false);
    expect(d.label).toMatch(/setVotingDelay\(42\)/);
  });

  it("treats a pure native-value transfer as dangerous", () => {
    const d = decodeGovernanceAction({ target: A, value: 3n * 10n ** 18n, calldata: "0x" });
    expect(d.kind).toBe("value");
    expect(d.valueLcai).toBe(3);
    expect(d.dangerous).toBe(true);
    expect(d.label).toMatch(/Send 3/);
  });

  it("surfaces an unknown selector without throwing", () => {
    const d = decodeGovernanceAction({ target: A, value: 0n, calldata: "0xdeadbeef" });
    expect(d.kind).toBe("unknown");
    expect(d.label).toMatch(/Unknown call \(0xdeadbeef\)/);
  });
});
