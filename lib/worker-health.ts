/**
 * Live worker health, parsed from a single combined shell read on the desktop
 * (docker ps/stats + the worker's local Prometheus metrics at 127.0.0.1:9101,
 * reached via `docker exec`, + a tail of the worker log). This is the real-time
 * telemetry the on-chain subgraph cannot see. See `fetchWorkerHealth` in tauri.ts.
 */
export interface WorkerHealth {
  running: boolean;
  uptime: string; // human, e.g. "30 minutes" (from docker "Up 30 minutes")
  cpuPct: number | null;
  memUsed: string | null; // e.g. "341.5MiB"
  activeJobs: number | null;
  maxJobs: number | null;
  ollamaUp: boolean | null;
  heartbeatAgoSec: number | null; // seconds since the worker's last heartbeat
  releasedTotal: number | null; // cumulative jobs released on-chain
  releasePending: number | null; // jobs awaiting on-chain release
  reconcileBlock: number | null; // highest block the release reconciler scanned
  gatewayConnected: boolean;
  recentEvents: string[]; // recent worker log messages, newest first
  chainId: number | null; // the network the running container actually serves
}

function section(raw: string, name: string): string {
  const m = raw.match(new RegExp(`===${name}===\\n([\\s\\S]*?)(?:\\n===|$)`));
  return m ? m[1].trim() : "";
}

function metric(metrics: string, name: string): number | null {
  const m = metrics.match(new RegExp(`^${name}\\s+([0-9.eE+-]+)`, "m"));
  return m ? Number(m[1]) : null;
}

/** Parse the delimited combined output. Returns null if Docker was unreachable. */
export function parseWorkerHealth(raw: string): WorkerHealth | null {
  if (/===NODOCKER===/.test(raw)) return null;
  const ps = section(raw, "PS");
  const stats = section(raw, "STATS");
  const metrics = section(raw, "METRICS");
  const logs = section(raw, "LOGS");
  const chainRaw = section(raw, "CHAIN");
  const chainId = chainRaw && /^\d+$/.test(chainRaw) ? Number(chainRaw) : null;

  const running = /^Up\b/i.test(ps);
  const uptime = (ps.match(/^Up\s+(.*?)(?:\s*\(|$)/i)?.[1] ?? "").trim();
  const [cpuRaw, memRaw] = stats.split("|");
  const cpuNum = cpuRaw ? Number(cpuRaw.replace("%", "").trim()) : NaN;
  const memUsed = memRaw ? memRaw.split("/")[0].trim() : null;

  const ollamaUpVal = metric(metrics, "worker_ollama_up");
  const hbTs = metric(metrics, "worker_heartbeat_last_emit_timestamp_seconds");

  const recentEvents = logs
    .split("\n")
    .map((l) => {
      try {
        return (JSON.parse(l).msg as string) ?? "";
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .reverse()
    .slice(0, 6);

  return {
    running,
    uptime,
    cpuPct: Number.isFinite(cpuNum) ? cpuNum : null,
    memUsed,
    activeJobs: metric(metrics, "worker_active_jobs"),
    maxJobs: metric(metrics, "worker_max_jobs"),
    ollamaUp: ollamaUpVal == null ? null : ollamaUpVal >= 1,
    heartbeatAgoSec: hbTs ? Math.max(0, Math.floor(Date.now() / 1000 - hbTs)) : null,
    releasedTotal: metric(metrics, "worker_release_released_total"),
    releasePending: metric(metrics, "worker_release_pending"),
    reconcileBlock: metric(metrics, "worker_release_reconcile_last_block"),
    gatewayConnected: /websocket connected to gateway|authenticated with worker-gateway/i.test(logs),
    recentEvents,
    chainId,
  };
}

/** The combined read command (unix shell). Windows uses the same docker calls. */
export const WORKER_HEALTH_CMD = [
  'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
  'docker info >/dev/null 2>&1 || { echo "===NODOCKER==="; exit 0; }',
  'echo "===PS==="; docker ps -a --filter name=lightchain-worker --format "{{.Status}}" 2>/dev/null',
  'echo "===STATS==="; docker stats --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}" lightchain-worker 2>/dev/null',
  'echo "===METRICS==="; docker exec lightchain-worker sh -c "command -v curl >/dev/null && curl -s http://127.0.0.1:9101/metrics || wget -qO- http://127.0.0.1:9101/metrics" 2>/dev/null',
  'echo "===LOGS==="; docker logs --tail 10 lightchain-worker 2>&1',
  'echo "===CHAIN==="; docker inspect lightchain-worker --format "{{range .Config.Env}}{{println .}}{{end}}" 2>/dev/null | grep "^CHAIN_ID=" | head -1 | cut -d= -f2',
  'echo "===END==="',
].join("\n");
