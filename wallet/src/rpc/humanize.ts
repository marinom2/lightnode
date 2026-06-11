/**
 * Map raw node/viem errors to one short human sentence. Raw errors leak long
 * internals ("insufficient funds for gas * price + value: address 0x... have 0
 * want 1000...") that mean nothing to a wallet user.
 */
export function humanizeError(raw: string, symbol = "funds"): string {
  const m = raw.toLowerCase();
  if (m.includes("insufficient funds")) return `Not enough ${symbol} to cover the amount plus the network fee.`;
  if (m.includes("user rejected") || m.includes("user denied")) return "Request rejected.";
  if (m.includes("nonce too low") || m.includes("replacement transaction underpriced")) {
    return "A pending transaction is in the way. Speed it up or wait for it to confirm.";
  }
  if (m.includes("intrinsic gas") || m.includes("gas required exceeds")) {
    return "The network fee could not be covered. Lower the amount.";
  }
  if (m.includes("fetch") || m.includes("timeout") || m.includes("network")) {
    return "Network error. Check your connection and try again.";
  }
  const first = raw.split("\n")[0] ?? raw;
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}
