/**
 * Recipient risk checks for the send flow. The headline threat is address
 * poisoning: an attacker seeds your history with a "lookalike" address that
 * shares your real counterparty's first/last characters, hoping you copy it.
 *
 * Detection follows the USENIX Security 2025 study (Tsuchiya et al.): compare
 * leading + trailing hex characters (not Hamming distance) and flag a match of
 * prefix >= 3 AND suffix >= 4. Pure + unit-tested.
 */
export type RecipientKind = "known" | "lookalike" | "new" | "self";

export interface RecipientAssessment {
  kind: RecipientKind;
  similarTo?: string; // for "lookalike": the real address it imitates
}

function body(address: string): string {
  return address.toLowerCase().replace(/^0x/, "");
}

/** True when `a` resembles `b` (shared prefix+suffix) but is NOT the same address. */
export function looksAlike(a: string, b: string): boolean {
  const x = body(a);
  const y = body(b);
  if (x === y || x.length !== 40 || y.length !== 40) return false;
  let prefix = 0;
  while (prefix < 40 && x[prefix] === y[prefix]) prefix++;
  let suffix = 0;
  while (suffix < 40 && x[39 - suffix] === y[39 - suffix]) suffix++;
  return prefix >= 3 && suffix >= 4;
}

/**
 * Classify a recipient against the user's own accounts and known counterparties.
 * - self: one of your own addresses.
 * - known: you've sent here before (safe).
 * - lookalike: imitates a known/own address (likely a poisoning scam).
 * - new: never seen; worth a glance.
 */
export function assessRecipient(to: string, known: string[], own: string[]): RecipientAssessment {
  const t = body(to);
  if (own.some((a) => body(a) === t)) return { kind: "self" };
  const trusted = [...own, ...known];
  if (trusted.some((a) => body(a) === t)) return { kind: "known" };
  const imitated = trusted.find((a) => looksAlike(to, a));
  if (imitated) return { kind: "lookalike", similarTo: imitated };
  return { kind: "new" };
}
