/**
 * Parse + validate an EIP-712 payload for the approval popup. EIP-712 phishing
 * spoofs domain.name / verifyingContract while keeping chainId correct, so we
 * surface the full domain and hard-warn on Permit / order-style primary types.
 */
export interface TypedDataSummary {
  chainIdOk: boolean;
  chainId?: number;
  primaryType: string;
  domainName?: string;
  verifyingContract?: string;
  warning?: string;
  error?: string;
}

interface RawTypedData {
  domain?: { name?: string; chainId?: number | string; verifyingContract?: string };
  primaryType?: string;
  message?: unknown;
  types?: Record<string, unknown>;
}

const RISKY_PRIMARY = /permit|order|approv/i;

export function summarizeTypedData(payload: unknown, allowedChainIds: number[]): TypedDataSummary {
  const td = parseTypedData(payload);
  if (!td) return { chainIdOk: false, primaryType: "?", error: "Could not parse the typed-data payload." };
  const chainId = td.domain?.chainId != null ? Number(td.domain.chainId) : undefined;
  const primaryType = td.primaryType ?? "?";
  return {
    chainId,
    chainIdOk: chainId != null && allowedChainIds.includes(chainId),
    primaryType,
    domainName: td.domain?.name,
    verifyingContract: td.domain?.verifyingContract,
    warning: RISKY_PRIMARY.test(primaryType)
      ? "This authorizes spending/an order via signature (no transaction needed). Verify the contract."
      : undefined,
  };
}

export function parseTypedData(payload: unknown): RawTypedData | null {
  try {
    const obj = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!obj || typeof obj !== "object") return null;
    return obj as RawTypedData;
  } catch {
    return null;
  }
}
