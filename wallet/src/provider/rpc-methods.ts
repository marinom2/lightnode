/** What the dapp-facing provider is allowed to ask, and what needs human approval. */

export const APPROVAL_REQUIRED = new Set<string>([
  "eth_requestAccounts",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
]);

// Answered in the background without a popup.
export const LOCAL_READ = new Set<string>(["eth_accounts", "eth_chainId", "net_version"]);

// Read-only methods we forward to our own pinned RPC. We never accept a dapp RPC url,
// and never expose mutating/admin methods. wallet_addEthereumChain is intentionally
// absent (review H4): we support only the two pinned LightChain networks.
const READ_PASSTHROUGH = new Set<string>([
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_maxPriorityFeePerGas",
]);

export function isAllowedMethod(method: string): boolean {
  return APPROVAL_REQUIRED.has(method) || LOCAL_READ.has(method) || READ_PASSTHROUGH.has(method);
}
