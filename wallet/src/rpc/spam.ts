/**
 * Heuristic scam flagging for indexer-discovered tokens and imported NFTs.
 * Airdropped junk follows recognizable patterns: URLs or claim-bait in the
 * name, impersonation of blue-chip symbols from the wrong contract, and
 * non-text glyph soup. Flagged assets are quarantined, never auto-trusted.
 */

const WELL_KNOWN_SYMBOLS = new Set(["usdc", "usdt", "dai", "weth", "wbtc", "eth", "lcai", "busd", "steth"]);

// Bait vocabulary + anything that smells like a URL or handle.
const BAIT = /(https?:|www\.|\.com|\.io|\.xyz|\.net|\.org|\.app|\.site|\.fi|t\.me|\bclaim\b|\breward(s)?\b|\bairdrop\b|\bvisit\b|\bbonus\b|\bfree\b|\bredeem\b|\bvoucher\b)/i;

// Confusable look-alikes (Cyrillic / Greek / fullwidth) for the ASCII letters
// that appear in WELL_KNOWN_SYMBOLS. Mapping these to a Latin skeleton defeats
// homoglyph impersonation: e.g. Cyrillic "С" in "USDС" folds back to "usdc".
const CONFUSABLES: Record<string, string> = {
  а: "a", А: "a", с: "c", С: "c", ԁ: "d", е: "e", Е: "e", һ: "h", Һ: "h",
  і: "i", І: "i", і̇: "i", о: "o", О: "o", р: "p", Р: "p", ѕ: "s", Ѕ: "s",
  т: "t", Т: "t", и: "u", Ь: "b", Ѵ: "v", ԝ: "w", Ԝ: "w",
  α: "a", Α: "a", ϲ: "c", Ϲ: "c", ϵ: "e", ε: "e", Ε: "e", ι: "i", Ι: "i",
  ο: "o", Ο: "o", ρ: "p", Ρ: "p", τ: "t", Τ: "t", υ: "u", Υ: "u", ν: "v",
  Η: "h",
  ｓ: "s", ｔ: "t", ｄ: "d", ｗ: "w", ｂ: "b",
};

export interface SpamVerdict {
  spam: boolean;
  reason: string;
}

const OK: SpamVerdict = { spam: false, reason: "" };

/**
 * Fold a symbol to a lowercase Latin skeleton: NFKC-normalize (collapses
 * fullwidth / ligatures), then swap known confusables for their ASCII letter.
 */
function toSkeleton(symbol: string): string {
  const normalized = symbol.normalize("NFKC").toLowerCase();
  return [...normalized].map((ch) => CONFUSABLES[ch] ?? ch).join("");
}

/** True when the post-NFKC symbol still carries any non-ASCII LETTER. */
function hasNonAsciiLetter(symbol: string): boolean {
  const normalized = symbol.normalize("NFKC");
  return [...normalized].some((ch) => ch.charCodeAt(0) > 126 && /\p{L}/u.test(ch));
}

/** Edit distance of 1 (single substitution / insertion / deletion). */
function isOneCharEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
    return diffs === 1;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/** True when a skeleton collides with, or is one edit away from, a blue-chip. */
function resemblesWellKnown(skeleton: string): boolean {
  if (WELL_KNOWN_SYMBOLS.has(skeleton)) return true;
  for (const known of WELL_KNOWN_SYMBOLS) {
    if (isOneCharEdit(skeleton, known)) return true;
  }
  return false;
}

/**
 * For DISCOVERED tokens only (user-added and shipped defaults are exempt:
 * the user chose those deliberately).
 */
export function assessTokenRisk(symbol: string, address: string, officialAddresses: Set<string>): SpamVerdict {
  const sym = symbol.trim();
  if (BAIT.test(sym)) return { spam: true, reason: "The token name advertises a site or a claim, the classic airdrop-scam pattern." };

  // Impersonation: fold homoglyphs to a Latin skeleton so a single Cyrillic /
  // Greek / fullwidth look-alike (e.g. Cyrillic "С" in "USDС") cannot slip the
  // exact-match check. An off-official address wearing a blue-chip skeleton is spam.
  const skeleton = toSkeleton(sym);
  const official = officialAddresses.has(address.toLowerCase());
  if (WELL_KNOWN_SYMBOLS.has(skeleton) && !official) {
    return { spam: true, reason: `Calls itself ${skeleton.toUpperCase()} but is NOT the official ${skeleton.toUpperCase()} contract.` };
  }
  // A non-ASCII letter that survives NFKC yet still resembles a blue-chip is a
  // disguised impersonator, even when the skeleton is one edit off.
  if (hasNonAsciiLetter(sym) && resemblesWellKnown(skeleton) && !official) {
    return { spam: true, reason: `Uses look-alike characters to imitate a well-known token symbol.` };
  }

  // Glyph soup: a symbol that is mostly non-ASCII after control stripping.
  const nonAscii = [...sym].filter((c) => c.charCodeAt(0) > 126).length;
  if (sym.length > 0 && nonAscii / sym.length > 0.5) return { spam: true, reason: "The symbol is mostly special characters." };
  return OK;
}

/** NFT names/collections carrying URLs or claim-bait are phishing fronts. */
export function assessNftRisk(name: string, collection: string): SpamVerdict {
  const text = `${name} ${collection}`;
  if (BAIT.test(text)) return { spam: true, reason: "The NFT name advertises a site or a claim. Visiting it is how these scams complete." };
  return OK;
}
