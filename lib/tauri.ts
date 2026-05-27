/**
 * Bridge to the LightNode desktop shell (Tauri). The web UI runs inside the
 * desktop app loaded from a remote URL. Tauri v2 always injects
 * `window.__TAURI_INTERNALS__` (the IPC bridge) into the page, and with
 * `withGlobalTauri` also wraps it as `window.__TAURI__`. The global wrapper can
 * be missing/flaky on remote pages, so we detect and invoke through whichever is
 * present, preferring internals. On the web both are absent → no-ops/null.
 */

import { parseWorkerHealth, WORKER_HEALTH_CMD, type WorkerHealth } from "./worker-health";

export type { WorkerHealth };

export interface NativeHardware {
  os: "macos" | "linux" | "windows";
  cores: number;
  ram_gb: number;
  gpu: string;
  vram_gb: number | null;
  unified: boolean;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriInternals {
  invoke: Invoke;
}

interface TauriGlobal {
  core?: { invoke: Invoke };
  event?: {
    listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function win():
  | (Window & { __TAURI__?: TauriGlobal; __TAURI_INTERNALS__?: TauriInternals })
  | null {
  return typeof window === "undefined" ? null : (window as never);
}

/** Lowest-level IPC entry that works on remote pages: internals first, then the
 *  global wrapper. Null when not running inside the desktop shell. */
function getInvoke(): Invoke | null {
  const w = win();
  if (!w) return null;
  if (w.__TAURI_INTERNALS__?.invoke) return w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
  if (w.__TAURI__?.core?.invoke) return w.__TAURI__.core.invoke.bind(w.__TAURI__.core);
  return null;
}

export function isDesktop(): boolean {
  return getInvoke() !== null;
}

/**
 * Open a URL in the user's real browser. In a normal browser tab `window.open`
 * works; the desktop webview can't spawn tabs, so we shell out to the OS opener
 * (`open` / `xdg-open` / `Start-Process`) through the existing native runner -
 * no extra plugin or release needed. Only http(s) URLs are allowed.
 */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\/[^\s"'`]+$/.test(url)) return; // guard against anything but a clean URL
  const invoke = getInvoke();
  if (!invoke) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const cmd = /Windows/i.test(ua)
    ? `Start-Process "${url}"`
    : /Mac|Macintosh/i.test(ua)
      ? `open "${url}"`
      : `xdg-open "${url}" >/dev/null 2>&1 || true`;
  try {
    await invoke("run_command_streamed", { command: cmd, env: {} });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer"); // last-ditch fallback
  }
}

export interface BridgeInfo {
  inDesktop: boolean;
  hasInternals: boolean;
  hasGlobal: boolean;
}

/** What IPC surface (if any) the page sees - used to diagnose desktop detection. */
export function bridgeInfo(): BridgeInfo {
  const w = win();
  return {
    inDesktop: getInvoke() !== null,
    hasInternals: !!w?.__TAURI_INTERNALS__?.invoke,
    hasGlobal: !!w?.__TAURI__?.core?.invoke,
  };
}

let lastDetectError: string | null = null;
/** The last detect_hardware error message, if any (for on-screen diagnostics). */
export function lastHardwareError(): string | null {
  return lastDetectError;
}

/** Real CPU/RAM/GPU/VRAM from the OS - only available in the desktop shell. */
export async function detectNativeHardware(): Promise<NativeHardware | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    const hw = await invoke<NativeHardware>("detect_hardware");
    lastDetectError = null;
    return hw;
  } catch (err) {
    lastDetectError = err instanceof Error ? err.message : String(err);
    console.error("[tauri] detect_hardware failed:", err);
    return null;
  }
}

/**
 * Native OS-keychain secret store (Keychain / Credential Manager / Secret
 * Service). Only available in the desktop shell - on the web these return
 * null/false so callers fall back to localStorage.
 */
// The desktop app loads the hosted UI, so a freshly-deployed web build can run
// inside an OLDER binary that lacks the keychain commands. Probe once for the
// real capability (not just isDesktop) so callers fall back to env-passing on
// old binaries instead of relying on keychain injection that can't happen.
let _secretsProbe: boolean | null = null;
export async function nativeSecretsAvailable(): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  if (_secretsProbe !== null) return _secretsProbe;
  try {
    await invoke("secret_get", { name: "__lightnode_probe__" }); // resolves (null) if the command exists
    _secretsProbe = true;
  } catch {
    _secretsProbe = false; // old binary: command not registered / not allowed
  }
  return _secretsProbe;
}

export async function secretSet(name: string, value: string): Promise<boolean> {
  const invoke = getInvoke();
  if (!invoke) return false;
  try {
    await invoke("secret_set", { name, value });
    return true;
  } catch (e) {
    console.error("[tauri] secret_set failed:", e);
    return false;
  }
}

export async function secretGet(name: string): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    return (await invoke<string | null>("secret_get", { name })) ?? null;
  } catch (e) {
    console.error("[tauri] secret_get failed:", e);
    return null;
  }
}

export async function secretDelete(name: string): Promise<void> {
  const invoke = getInvoke();
  if (!invoke) return;
  try {
    await invoke("secret_delete", { name });
  } catch (e) {
    console.error("[tauri] secret_delete failed:", e);
  }
}

/**
 * Generate a worker key NATIVELY: the key is created in Rust, stored in the
 * keychain under `name`, and only the public address is returned - the raw key
 * never enters the web layer. Null on the web (caller falls back to viem).
 */
export async function generateWorkerKey(name: string): Promise<string | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<string>("generate_worker_key", { name });
  } catch (e) {
    console.error("[tauri] generate_worker_key failed:", e);
    return null;
  }
}

export type LocalContainerStatus = "running" | "stopped" | "missing" | "unknown";

// The native runner emits on shared global events (`setup-log` / `setup-exit`),
// so only one streamed consumer may be active at a time or their output bleeds
// together. This flag marks an in-flight `runSetupStreamed`; the status poller
// checks it (via `isStreamBusy`) and skips, so a `docker ps` status check can't
// leak "Up N minutes" lines into a running command's log.
let streamBusy = false;
export function isStreamBusy(): boolean {
  return streamBusy;
}

/**
 * Real local state of the worker container on this machine - the one thing the
 * on-chain subgraph can't see. Runs `docker ps` natively and parses the result.
 * "unknown" when not in the desktop shell or Docker is unreachable (we do NOT
 * auto-start Docker here - this is a read-only check).
 */
export async function localContainerStatus(): Promise<LocalContainerStatus> {
  const invoke = getInvoke();
  const events = win()?.__TAURI__?.event;
  if (!invoke || !events || streamBusy) return "unknown"; // never share the channel with another reader/command
  const cmd =
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"; ' +
    'docker info >/dev/null 2>&1 || { echo "__NODOCKER__"; exit 0; }; ' +
    "docker ps -a --filter name=lightchain-worker --format '{{.Status}}' 2>/dev/null";
  streamBusy = true;
  return new Promise<LocalContainerStatus>((resolve) => {
    let out = "";
    let settled = false;
    const unsubs: Array<() => void> = [];
    const finish = (v: LocalContainerStatus) => {
      if (settled) return;
      settled = true;
      streamBusy = false;
      unsubs.forEach((u) => u());
      resolve(v);
    };
    const classify = () => {
      if (/__NODOCKER__/.test(out)) return finish("unknown");
      if (/^\s*Up\b/im.test(out)) return finish("running");
      if (/\bExited\b|\bCreated\b/i.test(out)) return finish("stopped");
      return finish("missing");
    };
    Promise.all([
      events.listen("setup-log", (e) => {
        out += String(e.payload) + "\n";
      }),
      events.listen("setup-exit", classify),
    ]).then((u) => {
      unsubs.push(...u);
      invoke("run_command_streamed", { command: cmd, env: {} }).catch(() => finish("unknown"));
    });
    setTimeout(() => finish("unknown"), 8000);
  });
}

/**
 * Live worker health for the desktop "my worker" view: container uptime/CPU/mem,
 * the worker's local Prometheus metrics (active jobs, Ollama, heartbeat, releases)
 * read via `docker exec`, and recent log events. One combined read, serialized on
 * the shared channel (skips while a command/another read is in flight). Returns
 * null off-desktop or when Docker is unreachable.
 */
export async function fetchWorkerHealth(): Promise<WorkerHealth | null> {
  const invoke = getInvoke();
  const events = win()?.__TAURI__?.event;
  if (!invoke || !events || streamBusy) return null;
  streamBusy = true;
  return new Promise<WorkerHealth | null>((resolve) => {
    let out = "";
    let settled = false;
    const unsubs: Array<() => void> = [];
    const finish = (v: WorkerHealth | null) => {
      if (settled) return;
      settled = true;
      streamBusy = false;
      unsubs.forEach((u) => u());
      resolve(v);
    };
    Promise.all([
      events.listen("setup-log", (e) => {
        out += String(e.payload) + "\n";
      }),
      events.listen("setup-exit", () => finish(parseWorkerHealth(out))),
    ]).then((u) => {
      unsubs.push(...u);
      invoke("run_command_streamed", { command: WORKER_HEALTH_CMD, env: {} }).catch(() => finish(null));
    });
    setTimeout(() => finish(out ? parseWorkerHealth(out) : null), 12000);
  });
}

/** Run the generated setup command natively, streaming logs. Secrets go in
 *  `env` (process environment), never in the command string. Returns a stop fn.
 *  Requires the event API (the global wrapper); no-ops if unavailable. */
export async function runSetupStreamed(
  command: string,
  env: Record<string, string>,
  onLog: (line: string) => void,
  onExit: (code: number) => void,
  secretEnv?: string[],
): Promise<() => void> {
  const invoke = getInvoke();
  const events = win()?.__TAURI__?.event;
  if (!invoke || !events) {
    onExit(-1);
    return () => {};
  }
  // Detach the listeners the instant the command ends (fire-once). Otherwise they
  // linger on the shared global channel and pick up later commands - e.g. the
  // 15s container-status poll, which would spam "Up N minutes" / "done." forever.
  let done = false;
  const unsubs: Array<() => void> = [];
  const cleanup = () => {
    unsubs.forEach((u) => u());
    unsubs.length = 0;
    streamBusy = false;
  };
  const un1 = await events.listen("setup-log", (e) => {
    if (!done) onLog(String(e.payload));
  });
  const un2 = await events.listen("setup-exit", (e) => {
    if (done) return;
    done = true;
    onExit(Number(e.payload));
    cleanup();
  });
  unsubs.push(un1, un2);
  streamBusy = true;
  // `secretEnv` is a list of secret NAMES the native side pulls from the
  // keychain into the child env - so the worker key/password never have to be
  // passed through (or held by) the web layer.
  await invoke("run_command_streamed", { command, env, secretEnv: secretEnv ?? null });
  return () => {
    if (done) return;
    done = true;
    cleanup();
  };
}
