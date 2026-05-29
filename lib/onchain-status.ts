import { NETWORKS, type NetworkId } from "./network";

/**
 * Authoritative worker registration, read straight from the chain.
 *
 * The public workers-api index can report a registered worker as "deregistered"
 * indefinitely (it doesn't reset is_registered after a deregister -> re-register
 * cycle). The on-chain WorkerRegistry predeploy is the truth, but its *view*
 * methods revert on the deployed build - so instead we read its *events*, which
 * are reliable, and take the latest registration vs exit. This is exactly what an
 * indexer does, run on demand, so it works for ANY worker without trusting theirs.
 *
 * Topics are derived empirically from the deployed predeploy (same bytecode on
 * testnet + mainnet); the registry's source ABI differs from what's deployed, so
 * we do NOT compute these from a signature.
 */
const REGISTERED_TOPIC = "0x27987c0173113d0f969d0abbf00a8c583fd7f7f44c05af3739f808d2a0afba6f"; // WorkerJoined
const DEREGISTERED_TOPIC = "0xde576c51e7828c269f7a259c68554d25364b596a7bd816f01d9b8cdb52e88d43"; // worker exit/finalize

function addressTopic(address: string): string {
  return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/**
 * True/false if the chain can tell us; null if it can't (RPC error, unknown topics,
 * or no join/exit events for this worker) so the caller falls back to the index.
 */
export async function fetchOnchainRegistered(network: NetworkId, address: string): Promise<boolean | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  const cfg = NETWORKS[network];
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_getLogs",
    params: [
      {
        address: cfg.workerRegistry,
        topics: [[REGISTERED_TOPIC, DEREGISTERED_TOPIC], addressTopic(address)],
        fromBlock: "0x0",
        toBlock: "latest",
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(cfg.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: Array<{ blockNumber: string; logIndex: string; topics: string[] }> };
    const logs = json.result;
    if (!Array.isArray(logs) || logs.length === 0) return null;
    // The latest of the worker's register/exit events decides the current state.
    let latest = logs[0];
    for (const lg of logs) {
      const b = parseInt(lg.blockNumber, 16);
      const i = parseInt(lg.logIndex, 16);
      const lb = parseInt(latest.blockNumber, 16);
      const li = parseInt(latest.logIndex, 16);
      if (b > lb || (b === lb && i > li)) latest = lg;
    }
    return latest.topics?.[0]?.toLowerCase() === REGISTERED_TOPIC;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
