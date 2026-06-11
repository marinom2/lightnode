/**
 * Parse + validate an EIP-712 payload for the approval popup. EIP-712 phishing
 * spoofs domain.name / verifyingContract while keeping chainId correct, so we
 * surface the full domain AND decode the fields the user is actually
 * authorizing: gasless Permit / Permit2 / Seaport signatures are the dominant
 * drainer vector, and an undecoded "Sign typed data" is a blind signature.
 */
export interface DecodedPermit {
  kind: "permit" | "permit2" | "permit2-batch" | "seaport" | "none";
  spender?: string;
  token?: string;
  amount?: string; // raw units as decimal string
  unlimited?: boolean;
  deadline?: string; // unix seconds as string, "" when absent
  itemCount?: number; // batch/order size
  summary: string; // one human sentence, "" when kind === "none"
}

export interface TypedDataSummary {
  chainIdOk: boolean;
  chainId?: number;
  primaryType: string;
  domainName?: string;
  verifyingContract?: string;
  warning?: string;
  error?: string;
  permit: DecodedPermit;
}

interface RawTypedData {
  domain?: { name?: string; chainId?: number | string; verifyingContract?: string };
  primaryType?: string;
  message?: unknown;
  types?: Record<string, unknown>;
}

const RISKY_PRIMARY = /permit|order|approv/i;
// ERC-2612 convention: values at/above 2^255 read as "everything, forever".
const UNLIMITED_FLOOR = 1n << 255n;
// Permit2 uses uint160 max as its unlimited sentinel.
const PERMIT2_UNLIMITED = (1n << 160n) - 1n;
const NONE: DecodedPermit = { kind: "none", summary: "" };

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? String(v) : "");
const addr = (v: unknown): string => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : "");
function big(v: unknown): bigint | null {
  try {
    const s = str(v);
    return s === "" ? null : BigInt(s);
  } catch {
    return null;
  }
}
const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** ERC-2612 Permit: { owner, spender, value, nonce, deadline }. */
function decodePermit(m: Record<string, unknown>): DecodedPermit {
  const spender = addr(m.spender);
  const value = big(m.value);
  if (!spender || value === null) return NONE;
  const unlimited = value >= UNLIMITED_FLOOR;
  return {
    kind: "permit",
    spender,
    amount: value.toString(),
    unlimited,
    deadline: str(m.deadline),
    summary: unlimited
      ? `UNLIMITED gasless approval: ${shortAddr(spender)} could spend ALL of this token, now and later, with no transaction from you.`
      : `Gasless approval: lets ${shortAddr(spender)} spend up to ${value.toString()} raw units of this token.`,
  };
}

/** Permit2 PermitSingle: { details: { token, amount, expiration, nonce }, spender, sigDeadline }. */
function decodePermit2(m: Record<string, unknown>): DecodedPermit {
  const details = (m.details ?? {}) as Record<string, unknown>;
  const spender = addr(m.spender);
  const token = addr(details.token);
  const amount = big(details.amount);
  if (!spender || !token || amount === null) return NONE;
  const unlimited = amount >= PERMIT2_UNLIMITED;
  return {
    kind: "permit2",
    spender,
    token,
    amount: amount.toString(),
    unlimited,
    deadline: str(details.expiration),
    summary: unlimited
      ? `UNLIMITED Permit2 approval: ${shortAddr(spender)} could spend ALL of token ${shortAddr(token)}.`
      : `Permit2 approval: lets ${shortAddr(spender)} spend up to ${amount.toString()} raw units of ${shortAddr(token)}.`,
  };
}

/** Permit2 PermitBatch: { details: [...], spender, sigDeadline }. */
function decodePermit2Batch(m: Record<string, unknown>): DecodedPermit {
  const spender = addr(m.spender);
  const details = Array.isArray(m.details) ? m.details : null;
  if (!spender || !details || details.length === 0) return NONE;
  const anyUnlimited = details.some((d) => {
    const a = big((d as Record<string, unknown>)?.amount);
    return a !== null && a >= PERMIT2_UNLIMITED;
  });
  return {
    kind: "permit2-batch",
    spender,
    unlimited: anyUnlimited,
    itemCount: details.length,
    summary: `Permit2 BATCH approval: ${shortAddr(spender)} gains spending rights over ${details.length} tokens at once${anyUnlimited ? ", at least one UNLIMITED" : ""}.`,
  };
}

/** Seaport OrderComponents: { offer: [...], consideration: [...], ... }. */
function decodeSeaport(m: Record<string, unknown>): DecodedPermit {
  const offer = Array.isArray(m.offer) ? m.offer : [];
  const consideration = Array.isArray(m.consideration) ? m.consideration : [];
  if (offer.length === 0 && consideration.length === 0) return NONE;
  return {
    kind: "seaport",
    itemCount: offer.length,
    summary: `Marketplace order: you OFFER ${offer.length} item${offer.length === 1 ? "" : "s"} for ${consideration.length} in return. A spoofed order can transfer your NFTs for nothing; trust the site before signing.`,
  };
}

export function decodeTypedPermit(primaryType: string, message: unknown): DecodedPermit {
  if (typeof message !== "object" || message === null) return NONE;
  const m = message as Record<string, unknown>;
  if (primaryType === "Permit") return decodePermit(m);
  if (primaryType === "PermitSingle") return decodePermit2(m);
  if (primaryType === "PermitBatch") return decodePermit2Batch(m);
  if (primaryType === "OrderComponents" || primaryType === "BulkOrder") return decodeSeaport(m);
  return NONE;
}

export function summarizeTypedData(payload: unknown, allowedChainIds: number[]): TypedDataSummary {
  const td = parseTypedData(payload);
  if (!td) return { chainIdOk: false, primaryType: "?", error: "Could not parse the typed-data payload.", permit: NONE };
  const chainId = td.domain?.chainId != null ? Number(td.domain.chainId) : undefined;
  const primaryType = td.primaryType ?? "?";
  const permit = decodeTypedPermit(primaryType, td.message);
  return {
    chainId,
    chainIdOk: chainId != null && allowedChainIds.includes(chainId),
    primaryType,
    domainName: td.domain?.name,
    verifyingContract: td.domain?.verifyingContract,
    permit,
    warning:
      permit.kind === "none" && RISKY_PRIMARY.test(primaryType)
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

// ---- SIWE origin check (personal_sign) ----------------------------------------

/**
 * EIP-4361 Sign-In-With-Ethereum: the message states the domain requesting the
 * signature. A lookalike site replaying a legit SIWE message is the classic
 * auth phish; flag any mismatch between the stated domain and the real origin.
 */
export function siweOriginMismatch(messageText: string, requestOrigin: string): { stated: string; actual: string } | null {
  const firstLine = messageText.split("\n")[0] ?? "";
  const m = firstLine.match(/^([^\s]+) wants you to sign in with your Ethereum account/);
  if (!m) return null; // not a SIWE message
  // EIP-4361 allows an optional scheme prefix on the stated domain.
  const stated = m[1]!.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").toLowerCase();
  let actual = "";
  try {
    actual = new URL(requestOrigin).host.toLowerCase();
  } catch {
    actual = requestOrigin.toLowerCase();
  }
  if (stated === actual) return null;
  return { stated, actual };
}
