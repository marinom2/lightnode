import { describe, it, expect } from "vitest";
import { parseWorkerHealth, WORKER_HEALTH_CMD, WORKER_HEALTH_CMD_WIN } from "@/lib/worker-health";

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
===OLLAMA===
{"models":[{"name":"llama3-8b:latest","size":4900000000}]}
===CHAIN===
9200
===SERVED===
llama3-8b
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
    expect(h.chainId).toBe(9200); // which network the container serves
    expect(h.servedModel).toBe("llama3-8b"); // from the container env, shown even when cold
    expect(h.servedModels).toEqual(["llama3-8b"]); // full SUPPORTED_MODELS set
    expect(h.modelMemBytes).toBe(4900000000); // model RAM lives in Ollama, not the container
  });
  it("returns null when Docker is unreachable", () => {
    expect(parseWorkerHealth("===NODOCKER===")).toBeNull();
  });
  it("handles a stopped container", () => {
    const h = parseWorkerHealth("===PS===\nExited (0) 2 minutes ago\n===STATS===\n===METRICS===\n===LOGS===\n===END===")!;
    expect(h.running).toBe(false);
  });
});

// The desktop app runs every native command through PowerShell on Windows and
// bash elsewhere (run_command_streamed). The Windows health command therefore
// must be valid PowerShell - the old bash-only form (export / >/dev/null / `||`)
// is a parse error there, which left every Windows worker stuck on "Stopped".
describe("WORKER_HEALTH_CMD_WIN (PowerShell health read)", () => {
  it("emits the same ===SECTION=== markers parseWorkerHealth expects", () => {
    for (const m of ["===NODOCKER===", "===PS===", "===STATS===", "===METRICS===", "===LOGS===", "===OLLAMA===", "===CHAIN===", "===SERVED===", "===END==="]) {
      expect(WORKER_HEALTH_CMD_WIN).toContain(m);
    }
  });
  it("uses PowerShell idioms, not bash ones that fail on Windows PowerShell 5.1", () => {
    expect(WORKER_HEALTH_CMD_WIN).not.toContain("export PATH");
    // Bash redirects / operators are only allowed INSIDE the container's
    // `sh -c "..."` string (that runs in the container, not PowerShell). The
    // PowerShell layer itself must contain none of them (5.1 has no `||`/`&&`).
    const psLayer = WORKER_HEALTH_CMD_WIN.split("sh -c")[0];
    expect(psLayer).not.toContain(">/dev/null");
    expect(psLayer).not.toMatch(/\|\||&&/);
  });
  it("reads the served set from container env dynamically (any/future model)", () => {
    expect(WORKER_HEALTH_CMD_WIN).toContain("SUPPORTED_MODELS");
    expect(WORKER_HEALTH_CMD_WIN).toContain("CHAIN_ID"); // network-agnostic, read live
  });
  it("keeps the unix command as bash (unchanged)", () => {
    expect(WORKER_HEALTH_CMD.startsWith("export PATH")).toBe(true);
  });
});
