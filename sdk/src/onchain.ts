import type { NetworkConfig } from "./types.js";
import { REGISTRY_TOPICS } from "./networks.js";

/** Default RPC read timeout for the raw eth_call/eth_getLogs reads here. */
export const DEFAULT_ONCHAIN_TIMEOUT_MS = 8_000;

/** A timeout (ms) plus the AbortController/timer wired to it; <=0 disables the deadline. */
function makeDeadline(timeoutMs: number): { ctrl: AbortController; clear: () => void } {
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  return { ctrl, clear: () => timer && clearTimeout(timer) };
}

function addressTopic(address: string): string {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

// WorkerRegistry.isWorkerRegistered(address) selector. Unlike most of the
// predeploy's getters this view does NOT revert, and it reflects current state
// instantly - so it never lags a register/deregister the way the event log can
// when several happen in quick succession.
const IS_WORKER_REGISTERED_SELECTOR = "0xe798a7da";

/**
 * Authoritative worker registration from the chain. Prefers a direct
 * WorkerRegistry.isWorkerRegistered() eth_call (instant, current state); falls
 * back to scanning the join/exit event log if that read is unavailable. Both are
 * independent of the public indexer, which can lag a deregister -> re-register
 * cycle. Returns true/false, or null when the chain can't answer.
 */
export async function isRegistered(cfg: NetworkConfig, address: string, timeoutMs: number = DEFAULT_ONCHAIN_TIMEOUT_MS): Promise<boolean | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  const direct = await isRegisteredDirect(cfg, address, timeoutMs);
  if (direct !== null) return direct;
  return isRegisteredFromEvents(cfg, address, timeoutMs);
}

/** Direct contract read - the preferred, lag-free path. null on any failure. */
async function isRegisteredDirect(cfg: NetworkConfig, address: string, timeoutMs: number = DEFAULT_ONCHAIN_TIMEOUT_MS): Promise<boolean | null> {
  const { ctrl, clear } = makeDeadline(timeoutMs);
  try {
    const data = `${IS_WORKER_REGISTERED_SELECTOR}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
    const res = await fetch(cfg.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: cfg.workerRegistry, data }, "latest"],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string; error?: unknown };
    if (json.error || typeof json.result !== "string") return null;
    return /0*1$/.test(json.result.replace(/^0x/, ""));
  } catch {
    return null;
  } finally {
    clear();
  }
}

/**
 * Registration from the WorkerRegistry join/exit event log - the fallback when
 * the direct read is unavailable. Takes the latest of the worker's join/exit
 * events; null when the chain can't answer or there are no events for it.
 */
export async function isRegisteredFromEvents(cfg: NetworkConfig, address: string, timeoutMs: number = DEFAULT_ONCHAIN_TIMEOUT_MS): Promise<boolean | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  const { ctrl, clear } = makeDeadline(timeoutMs);
  try {
    const res = await fetch(cfg.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          {
            address: cfg.workerRegistry,
            topics: [[REGISTRY_TOPICS.registered, REGISTRY_TOPICS.exited], addressTopic(address)],
            fromBlock: "0x0",
            toBlock: "latest",
          },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: Array<{ blockNumber: string; logIndex: string; topics: string[] }> };
    const logs = json.result;
    if (!Array.isArray(logs) || logs.length === 0) return null;
    let latest = logs[0];
    for (const lg of logs) {
      const b = parseInt(lg.blockNumber, 16);
      const i = parseInt(lg.logIndex, 16);
      if (b > parseInt(latest.blockNumber, 16) || (b === parseInt(latest.blockNumber, 16) && i > parseInt(latest.logIndex, 16))) {
        latest = lg;
      }
    }
    return latest.topics?.[0]?.toLowerCase() === REGISTRY_TOPICS.registered;
  } catch {
    return null;
  } finally {
    clear();
  }
}

// WorkerRegistry.isEligible(address,bytes32) selector. This view does NOT revert
// on the deployed predeploy (unlike most of its getters), so it's a reliable
// on-chain read of whether a worker currently serves a given model.
const IS_ELIGIBLE_SELECTOR = "0xdb3ebef1";

/**
 * On-chain truth for which of `modelIds` a worker currently serves, via
 * WorkerRegistry.isEligible(worker, modelId). Stronger than the subgraph's
 * WorkerModel.is_active: the indexer lists a worker's models from its LAST
 * registration and never indexes removals, so it goes stale after a
 * deregister/re-register (it can show a model the worker no longer serves, or
 * miss the current one). Returns a Map keyed by lowercased modelId; null on any
 * RPC failure so callers can fall back to the index. One eth_call per model.
 */
export async function fetchOnchainEligibleModels(
  cfg: NetworkConfig,
  address: string,
  modelIds: string[],
  timeoutMs: number = DEFAULT_ONCHAIN_TIMEOUT_MS,
): Promise<Map<string, boolean> | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || modelIds.length === 0) return null;
  const addrArg = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const { ctrl, clear } = makeDeadline(timeoutMs);
  try {
    const entries = await Promise.all(
      modelIds.map(async (id) => {
        const idArg = id.toLowerCase().replace(/^0x/, "").padStart(64, "0");
        const res = await fetch(cfg.rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to: cfg.workerRegistry, data: `${IS_ELIGIBLE_SELECTOR}${addrArg}${idArg}` }, "latest"],
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`rpc ${res.status}`);
        const json = (await res.json()) as { result?: string; error?: unknown };
        if (json.error || typeof json.result !== "string") throw new Error("eth_call failed");
        // bool return: true iff the 32-byte word ends in 1.
        const eligible = /0*1$/.test(json.result.replace(/^0x/, ""));
        return [id.toLowerCase(), eligible] as const;
      }),
    );
    return new Map(entries);
  } catch {
    return null;
  } finally {
    clear();
  }
}
