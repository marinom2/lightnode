import { describe, it, expect } from "vitest";
import { parseWorkerHealth } from "@/lib/worker-health";

const RAW = `===PS===
Up 30 minutes
===STATS===
0.02%|341.5MiB / 3.827GiB
===METRICS===
# HELP worker_active_jobs ...
# TYPE worker_active_jobs gauge
worker_active_jobs 1
# TYPE worker_max_jobs gauge
worker_max_jobs 2
# TYPE worker_ollama_up gauge
worker_ollama_up 1
# TYPE worker_heartbeat_last_emit_timestamp_seconds gauge
worker_heartbeat_last_emit_timestamp_seconds 1.7798978316887481e+09
# TYPE worker_release_released_total counter
worker_release_released_total 7
# TYPE worker_release_pending gauge
worker_release_pending 3
# TYPE worker_release_reconcile_last_block gauge
worker_release_reconcile_last_block 319052
===LOGS===
{"time":"2026-05-27T16:02:51Z","level":"INFO","msg":"authenticated with worker-gateway"}
{"time":"2026-05-27T16:02:52Z","level":"INFO","msg":"websocket connected to gateway"}
===END===`;

describe("parseWorkerHealth", () => {
  it("parses the combined docker + metrics + logs read", () => {
    const h = parseWorkerHealth(RAW)!;
    expect(h.running).toBe(true);
    expect(h.uptime).toBe("30 minutes");
    expect(h.cpuPct).toBe(0.02);
    expect(h.memUsed).toBe("341.5MiB");
    expect(h.activeJobs).toBe(1);
    expect(h.maxJobs).toBe(2);
    expect(h.ollamaUp).toBe(true);
    expect(h.releasedTotal).toBe(7);
    expect(h.releasePending).toBe(3);
    expect(h.reconcileBlock).toBe(319052);
    expect(h.gatewayConnected).toBe(true);
    expect(h.recentEvents[0]).toBe("websocket connected to gateway"); // newest first
    expect(h.heartbeatAgoSec).not.toBeNull(); // parsed the scientific-notation timestamp
  });
  it("returns null when Docker is unreachable", () => {
    expect(parseWorkerHealth("===NODOCKER===")).toBeNull();
  });
  it("handles a stopped container", () => {
    const h = parseWorkerHealth("===PS===\nExited (0) 2 minutes ago\n===STATS===\n===METRICS===\n===LOGS===\n===END===")!;
    expect(h.running).toBe(false);
  });
});
