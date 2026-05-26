/**
 * Bridge to the LightNode desktop shell (Tauri). The web UI runs inside the
 * desktop app loaded from a remote URL. Tauri v2 always injects
 * `window.__TAURI_INTERNALS__` (the IPC bridge) into the page, and with
 * `withGlobalTauri` also wraps it as `window.__TAURI__`. The global wrapper can
 * be missing/flaky on remote pages, so we detect and invoke through whichever is
 * present, preferring internals. On the web both are absent → no-ops/null.
 */

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

export type LocalContainerStatus = "running" | "stopped" | "missing" | "unknown";

/**
 * Real local state of the worker container on this machine - the one thing the
 * on-chain subgraph can't see. Runs `docker ps` natively and parses the result.
 * "unknown" when not in the desktop shell or Docker is unreachable (we do NOT
 * auto-start Docker here - this is a read-only check).
 */
export async function localContainerStatus(): Promise<LocalContainerStatus> {
  const invoke = getInvoke();
  const events = win()?.__TAURI__?.event;
  if (!invoke || !events) return "unknown";
  const cmd =
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"; ' +
    'docker info >/dev/null 2>&1 || { echo "__NODOCKER__"; exit 0; }; ' +
    "docker ps -a --filter name=lightchain-worker --format '{{.Status}}' 2>/dev/null";
  return new Promise<LocalContainerStatus>((resolve) => {
    let out = "";
    let settled = false;
    const unsubs: Array<() => void> = [];
    const finish = (v: LocalContainerStatus) => {
      if (settled) return;
      settled = true;
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

/** Run the generated setup command natively, streaming logs. Secrets go in
 *  `env` (process environment), never in the command string. Returns a stop fn.
 *  Requires the event API (the global wrapper); no-ops if unavailable. */
export async function runSetupStreamed(
  command: string,
  env: Record<string, string>,
  onLog: (line: string) => void,
  onExit: (code: number) => void,
): Promise<() => void> {
  const invoke = getInvoke();
  const events = win()?.__TAURI__?.event;
  if (!invoke || !events) {
    onExit(-1);
    return () => {};
  }
  const un1 = await events.listen("setup-log", (e) => onLog(String(e.payload)));
  const un2 = await events.listen("setup-exit", (e) => onExit(Number(e.payload)));
  await invoke("run_command_streamed", { command, env });
  return () => {
    un1();
    un2();
  };
}
