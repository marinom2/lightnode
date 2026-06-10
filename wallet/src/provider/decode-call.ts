/**
 * Decode an eth_sendTransaction `data` field into a human-facing danger summary
 * so the approval popup never blind-signs. Pure + unit-tested (no DOM). Covers
 * the ERC-20/721/1155 + Permit methods that drain wallets; everything else is
 * surfaced as "unrecognized contract call, only approve if you trust this site".
 */
import { decodeFunctionData, getAddress, type Hex } from "viem";

export type Severity = "info" | "warn" | "danger";
export type DangerKind =
  | "approve"
  | "increaseAllowance"
  | "setApprovalForAll"
  | "permit"
  | "transfer"
  | "transferFrom"
  | "unknown"
  | "empty";

export interface DecodedCall {
  kind: DangerKind;
  label: string;
  severity: Severity;
  detail: string;
  unlimited?: boolean;
  spender?: string;
  recipient?: string;
}

// >= 2^255 is the standard "effectively unlimited" heuristic (catches MAX_UINT256
// and the 2^255 sentinel dapps use).
const UNLIMITED = 1n << 255n;

// Both safeTransferFrom overloads (3-arg 0x42842e0e and 4-arg-with-bytes 0xb88d4fde)
// are included so marketplace transfers don't fall through to "unknown".
const DANGEROUS_ABI = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }] },
  { type: "function", name: "increaseAllowance", inputs: [{ name: "spender", type: "address" }, { name: "addedValue", type: "uint256" }] },
  { type: "function", name: "setApprovalForAll", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }] },
  { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }] },
  { type: "function", name: "transferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }] },
  { type: "function", name: "safeTransferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }] },
  { type: "function", name: "safeTransferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "id", type: "uint256" }, { name: "data", type: "bytes" }] },
  { type: "function", name: "permit", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }] },
] as const;

const EMPTY: DecodedCall = { kind: "empty", label: "Native transfer", severity: "info", detail: "No contract call data." };
const UNKNOWN: DecodedCall = { kind: "unknown", label: "Contract interaction", severity: "warn", detail: "Unrecognized contract call. Only approve if you trust this site - it can move tokens." };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const addr = (v: unknown): string => {
  try {
    return getAddress(String(v));
  } catch {
    return String(v);
  }
};
const big = (v: unknown): bigint => {
  try {
    return BigInt(v as bigint);
  } catch {
    return 0n;
  }
};

export function decodeDangerousCall(data: Hex | undefined | null): DecodedCall {
  if (!data || data === "0x" || data.length < 10) return EMPTY;
  try {
    const { functionName, args } = decodeFunctionData({ abi: DANGEROUS_ABI, data });
    return summarize(functionName, (args ?? []) as readonly unknown[]);
  } catch {
    return UNKNOWN;
  }
}

function summarize(fn: string, args: readonly unknown[]): DecodedCall {
  if (fn === "approve") return spendApproval("approve", "Token spending approval", addr(args[0]), big(args[1]));
  if (fn === "increaseAllowance") return spendApproval("increaseAllowance", "Increase token allowance", addr(args[0]), big(args[1]));
  if (fn === "permit") return spendApproval("permit", "Gasless spending permit", addr(args[1]), big(args[2]));
  if (fn === "setApprovalForAll") return setApprovalAll(addr(args[0]), Boolean(args[1]));
  if (fn === "transfer") return { kind: "transfer", label: "Token transfer", severity: "warn", detail: `Sends tokens to ${short(addr(args[0]))}.`, recipient: addr(args[0]) };
  if (fn === "transferFrom" || fn === "safeTransferFrom") return { kind: "transferFrom", label: "Token transfer", severity: "warn", detail: `Moves tokens to ${short(addr(args[1]))}.`, recipient: addr(args[1]) };
  return UNKNOWN;
}

function spendApproval(kind: DangerKind, label: string, spender: string, value: bigint): DecodedCall {
  const unlimited = value >= UNLIMITED;
  return {
    kind,
    label,
    severity: "danger",
    spender,
    unlimited,
    detail: unlimited
      ? `UNLIMITED: ${short(spender)} could spend ALL of this token, now and later.`
      : `Lets ${short(spender)} spend up to ${value.toString()} raw units.`,
  };
}

function setApprovalAll(operator: string, approved: boolean): DecodedCall {
  return {
    kind: "setApprovalForAll",
    label: "Approve ALL NFTs",
    severity: approved ? "danger" : "info",
    spender: operator,
    unlimited: approved,
    detail: approved
      ? `Grants ${short(operator)} control of EVERY NFT in this collection you own.`
      : `Revokes ${short(operator)}'s approval for this collection.`,
  };
}
