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
