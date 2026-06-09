/**
 * Map a raw thrown value (fetch error, RPC error, JSON parse, etc.) to a
 * short user-facing message. The two goals:
 *   1. Never render `(e as Error).message` verbatim - those strings include
 *      stack traces, internal paths, RPC method names, and provider-specific
 *      jargon that a visitor cannot act on.
 *   2. Give the visitor ONE clear sentence about what happened, plus a
 *      sensible next step (retry, try later, check input).
 *
 * Patterns covered are the common ones the audit found:
 *   - "Failed to fetch" / "fetch failed" / undici reachability errors
 *   - HTTP error pages parsed as JSON ("Unexpected token A...")
 *   - Vercel function timeouts (FUNCTION_INVOCATION_TIMEOUT)
 *   - Rate limit responses (429)
 *   - RPC reverts with hex data
 *   - SIWE 401 / Gateway auth errors
 *   - Aborted requests
 */
export function humanizeError(e: unknown, ctx?: { action?: string }): string {
  const raw = extractMessage(e);
  const action = ctx?.action ?? "the request";

  // Lossless empty -> generic fallback
  if (!raw) return `Something went wrong with ${action}. Try again.`;

  // Vercel hard cap. Any long-running serverless route can hit it.
  if (/FUNCTION_INVOCATION_TIMEOUT/i.test(raw) || /\b504\b/.test(raw)) {
    return "The network took longer to respond than the demo budget allows. Try again, or run the example locally.";
  }
  // Generic fetch reachability - includes browser "Failed to fetch", undici
  // "fetch failed", Node ENOTFOUND. Distinguish from server-side errors.
  if (/Failed to fetch|fetch failed|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT/i.test(raw)) {
    return "Could not reach the network. Check your connection and try again.";
  }
  // 401 / SIWE
  if (/\b401\b|GatewayAuthError|SIWE/i.test(raw)) {
    return "Authentication failed. Refresh the page and try again.";
  }
  // Rate limiting
  if (/\b429\b|rate.?limit|too many requests/i.test(raw)) {
    const limit = raw.match(/(\d+)\s*per\s*(hour|minute|day)/i);
    return limit ? `Demo rate limit hit (${limit[1]} per ${limit[2]}). Try again later, or run the example locally.` : "Rate limit hit. Try again later, or run the example locally.";
  }
  // User cancellation - aborted via AbortSignal
  if (/abort|cancelled|canceled/i.test(raw) && !/aborted on chain/i.test(raw)) {
    return "Cancelled.";
  }
  // User rejected wallet signature (checked before reverts: viem's rejection
  // error embeds the full calldata + ABI, which must never reach the user).
  if (/user rejected|user denied|user closed|denied transaction|rejected the request/i.test(raw)) {
    return "You rejected the request in your wallet. Nothing was charged - run it again when you're ready.";
  }
  // Not enough balance to cover fee + gas (a pre-send viem error, not a revert).
  if (/insufficient funds|exceeds the balance|gas \* price/i.test(raw)) {
    return "Your wallet doesn't have enough LCAI to cover the fee plus gas. Top up (use the faucet on testnet) and try again.";
  }
  // RPC reverts with selector-only data are useless to surface raw.
  if (/execution reverted/i.test(raw)) {
    const reason = raw.match(/execution reverted:?\s*([^\n]+)/i)?.[1]?.trim();
    return reason && !/^0x[0-9a-f]+$/i.test(reason) ? `On-chain call reverted: ${reason}.` : "On-chain call reverted. Check the wallet has enough LCAI for the fee and try again.";
  }
  // JSON parse - usually means the server returned HTML instead (e.g. proxy error page)
  if (/Unexpected token|JSON\.parse|is not valid JSON/i.test(raw)) {
    return "The server returned an unexpected response (likely a timeout or proxy error). Try again.";
  }
  // Specific stalled-worker hint
  if (/stalled|StalledWorkerError/i.test(raw)) {
    return "Worker stalled mid-job. The protocol refunds the fee after the dispute window. Try again - a different worker is picked next.";
  }
  // 5xx generic
  if (/\b5\d\d\b/.test(raw)) {
    return `The network returned a server error. Try again, or run the example locally.`;
  }

  // Last resort: surface the first sentence only, capped at 140 chars, with
  // the leading exception class stripped so we don't show "Error: Error: ...".
  const trimmed = raw
    .replace(/^Error:\s*/i, "")
    .replace(/^TypeError:\s*/i, "")
    .split(/[.\n]/)[0]
    .trim();
  if (trimmed.length > 140) return trimmed.slice(0, 137) + "...";
  return trimmed || `Something went wrong with ${action}. Try again.`;
}

function extractMessage(e: unknown): string {
  if (e == null) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message ?? "";
  if (typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  try {
    return String(e);
  } catch {
    return "";
  }
}
