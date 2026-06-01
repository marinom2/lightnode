import type { NetworkConfig } from "./types.js";
import { REGISTRY_TOPICS } from "./networks.js";

function addressTopic(address: string): string {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * Authoritative worker registration, read straight from the chain's WorkerRegistry
 * events (works for ANY worker, independent of the public indexer, which can lag a
 * deregister -> re-register cycle). Returns true/false from the latest join/exit
 * event, or null when the chain can't answer (RPC error, or no events for it).
 */
export async function isRegistered(cfg: NetworkConfig, address: string): Promise<boolean | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
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
    clearTimeout(timer);
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
): Promise<Map<string, boolean> | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address) || modelIds.length === 0) return null;
  const addrArg = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
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
    clearTimeout(timer);
  }
}
