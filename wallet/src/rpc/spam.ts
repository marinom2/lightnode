/**
 * Heuristic scam flagging for indexer-discovered tokens and imported NFTs.
 * Airdropped junk follows recognizable patterns: URLs or claim-bait in the
 * name, impersonation of blue-chip symbols from the wrong contract, and
 * non-text glyph soup. Flagged assets are quarantined, never auto-trusted.
 */

const WELL_KNOWN_SYMBOLS = new Set(["usdc", "usdt", "dai", "weth", "wbtc", "eth", "lcai", "busd", "steth"]);

// Bait vocabulary + anything that smells like a URL or handle.
const BAIT = /(https?:|www\.|\.com|\.io|\.xyz|\.net|\.org|\.app|\.site|\.fi|t\.me|\bclaim\b|\breward(s)?\b|\bairdrop\b|\bvisit\b|\bbonus\b|\bfree\b|\bredeem\b|\bvoucher\b)/i;

export interface SpamVerdict {
  spam: boolean;
  reason: string;
}

const OK: SpamVerdict = { spam: false, reason: "" };

/**
 * For DISCOVERED tokens only (user-added and shipped defaults are exempt:
 * the user chose those deliberately).
 */
export function assessTokenRisk(symbol: string, address: string, officialAddresses: Set<string>): SpamVerdict {
  const sym = symbol.trim();
  if (BAIT.test(sym)) return { spam: true, reason: "The token name advertises a site or a claim, the classic airdrop-scam pattern." };
  if (WELL_KNOWN_SYMBOLS.has(sym.toLowerCase()) && !officialAddresses.has(address.toLowerCase())) {
    return { spam: true, reason: `Calls itself ${sym.toUpperCase()} but is NOT the official ${sym.toUpperCase()} contract.` };
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
