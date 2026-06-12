import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi, parseEther } from "viem";
import { recognizeLightChainCall } from "./lightchain-calls";

const JOB_REGISTRY = "0xfB15F90298e4CcD7106E76fFB5e520315cC42B0b";
const GOVERNOR_9200 = "0x262E9f9232933E8565253918db703baD58DE93aB";
const BRIDGE_LC = "0xEc7096A3116EE769457C939617375Ec1785AA6f1";
const WORKER_REGISTRY = "0x0000000000000000000000000000000000001002";

const REGISTRY_ABI = parseAbi([
  "function createSession(bytes32 paramsHash, address worker, bytes encWorkerKey, bytes ephemeralPubKey, bytes initState, uint256 expiry) payable returns (uint256)",
  "function submitJob(uint256 sessionId, bytes32 promptHash) payable returns (uint256)",
  "function withdraw()",
]);
const GOV_ABI = parseAbi(["function castVote(uint256 proposalId, uint8 support) returns (uint256)"]);
const BRIDGE_ABI = parseAbi(["function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32)"]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

const B32 = `0x${"11".repeat(32)}` as const;

describe("recognizeLightChainCall", () => {
  it("labels submitJob with the inference fee from the tx value", () => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "submitJob", args: [1n, B32] });
    const r = recognizeLightChainCall(JOB_REGISTRY, data, 9200, parseEther("0.02"));
    expect(r?.contract).toBe("LightChain JobRegistry");
    expect(r?.action).toBe("Submit an AI prompt");
    expect(r?.detail).toContain("0.02 LCAI");
  });

  it("labels createSession as a session open with no token movement", () => {
    const data = encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "createSession",
      args: [B32, "0x0000000000000000000000000000000000000abc", "0x", "0x", "0x", 0n],
    });
    const r = recognizeLightChainCall(JOB_REGISTRY, data, 9200);
    expect(r?.action).toBe("Start an encrypted AI session");
  });

  it("labels a DAO vote with the choice and proposal id", () => {
    const data = encodeFunctionData({ abi: GOV_ABI, functionName: "castVote", args: [42n, 1] });
    const r = recognizeLightChainCall(GOVERNOR_9200, data, 9200);
    expect(r?.action).toBe("Cast a DAO vote");
    expect(r?.detail).toContain("Votes For on proposal #42");
  });

  it("labels a bridge transfer with the amount", () => {
    const data = encodeFunctionData({ abi: BRIDGE_ABI, functionName: "transferRemote", args: [1, B32, parseEther("5")] });
    const r = recognizeLightChainCall(BRIDGE_LC, data, 9200);
    expect(r?.contract).toBe("LCAI Bridge");
    expect(r?.detail).toContain("5 LCAI");
  });

  it("recognizes the worker-registry predeploy by its genesis address", () => {
    const data = encodeFunctionData({ abi: parseAbi(["function deregisterWorker()"]), functionName: "deregisterWorker", args: [] });
    expect(recognizeLightChainCall(WORKER_REGISTRY, data, 9200)?.action).toBe("Deregister your worker");
  });

  it("is case-insensitive on the destination address", () => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "withdraw", args: [] });
    expect(recognizeLightChainCall(JOB_REGISTRY.toLowerCase(), data, 9200)?.action).toBe("Withdraw worker earnings");
  });

  it("refuses to vouch for a lookalike contract that copies a selector", () => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "submitJob", args: [1n, B32] });
    const impostor = "0x000000000000000000000000000000000000dead";
    expect(recognizeLightChainCall(impostor, data, 9200)).toBeNull();
  });

  it("does not recognize the JobRegistry on the wrong chain", () => {
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "submitJob", args: [1n, B32] });
    expect(recognizeLightChainCall(JOB_REGISTRY, data, 1)).toBeNull();
  });

  it("returns null for an unknown selector on a known contract", () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: ["0x000000000000000000000000000000000000beef", 1n] });
    expect(recognizeLightChainCall(JOB_REGISTRY, data, 9200)).toBeNull();
  });

  it("returns null for a bare value transfer (no calldata) and missing chain", () => {
    expect(recognizeLightChainCall(JOB_REGISTRY, "0x", 9200)).toBeNull();
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "withdraw", args: [] });
    expect(recognizeLightChainCall(JOB_REGISTRY, data, undefined)).toBeNull();
  });
});
