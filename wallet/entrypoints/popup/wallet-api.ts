import type { WalletOp } from "../../src/provider/protocol";

/** Round-trip a wallet op to the background service worker, surfacing its error. */
export async function wallet<T>(op: WalletOp): Promise<T> {
  const res = (await chrome.runtime.sendMessage({ kind: "wallet", op })) as { result?: T; error?: { message: string } };
  if (res?.error) throw new Error(res.error.message);
  return res.result as T;
}

export interface WalletState {
  hasVault: boolean;
  unlocked: boolean;
  accounts: string[];
  activeIndex: number;
  chainId: number;
}
export interface PendingRequest {
  id: string;
  method: string;
  origin: string;
  params?: unknown[];
}
export type { WorkerStatusView } from "../../src/rpc/worker";
