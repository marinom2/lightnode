/** Message envelopes for page <-> content <-> background. Narrow + typed on purpose. */

export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown[];
}

export interface ActivityEntry {
  hash: string;
  to: string;
  amount: string;
  symbol: string;
  chainId: number;
  ts: number;
}
export interface JsonRpcResult {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// page (MAIN) <-> content (ISOLATED)
export const PAGE_TO_CONTENT = "lc-wallet:to-content";
export const CONTENT_TO_PAGE = "lc-wallet:to-page";

export interface PageMessage {
  target: typeof PAGE_TO_CONTENT;
  request: JsonRpcRequest;
}
export interface ContentMessage {
  target: typeof CONTENT_TO_PAGE;
  response: JsonRpcResult;
}

// content/popup -> background (chrome.runtime.sendMessage). `kind` discriminates.
export type BgMessage =
  | { kind: "dapp-rpc"; request: JsonRpcRequest } // relayed from a page (origin from sender)
  | { kind: "wallet"; op: WalletOp }; // from our own popup

export type WalletOp =
  | { type: "getState" }
  | { type: "createVault"; mnemonic: string; password: string }
  | { type: "importVault"; mnemonic: string; password: string }
  | { type: "unlock"; password: string }
  | { type: "lock" }
  | { type: "addAccount" }
  | { type: "setActiveAccount"; index: number }
  | { type: "revealMnemonic"; password: string }
  | { type: "removeWallet" }
  | { type: "getBalance"; address: string }
  | { type: "setChain"; chainId: number }
  | { type: "getTokens"; address: string }
  | { type: "addToken"; chainId: number; address: string }
  | { type: "workerStatus"; address: string }
  | { type: "send"; from: string; to: string; valueWei: string }
  | { type: "sendToken"; from: string; token: string; to: string; amount: string; decimals: number }
  | { type: "addActivity"; entry: ActivityEntry }
  | { type: "getActivity"; chainId: number }
  | { type: "listPending" }
  | { type: "resolvePending"; id: string; approved: boolean };

// EIP-1193 error codes (subset) - never leak internals across the boundary.
export const RpcError = {
  userRejected: { code: 4001, message: "User rejected the request" },
  unauthorized: { code: 4100, message: "Unauthorized" },
  unsupported: { code: 4200, message: "Unsupported method" },
  invalidParams: { code: -32602, message: "Invalid params" },
  locked: { code: 4100, message: "Wallet is locked" },
} as const;
