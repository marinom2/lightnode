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

/** Real CPU/RAM/GPU/VRAM from the OS - only available in the desktop shell. */
export async function detectNativeHardware(): Promise<NativeHardware | null> {
  const invoke = getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<NativeHardware>("detect_hardware");
  } catch (err) {
    console.error("[tauri] detect_hardware failed:", err);
    return null;
  }
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
