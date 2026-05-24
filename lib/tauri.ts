/**
 * Bridge to the LightNode desktop shell (Tauri). When the web UI runs inside the
 * desktop app, `window.__TAURI__` is injected (withGlobalTauri), so we can call
 * the native commands for real hardware detection and a streamed install — the
 * two things a browser can't do. On the web these are no-ops/null.
 */

export interface NativeHardware {
  os: "macos" | "linux" | "windows";
  cores: number;
  ram_gb: number;
  gpu: string;
  vram_gb: number | null;
  unified: boolean;
}

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function tauri(): TauriGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

export function isDesktop(): boolean {
  return tauri() !== null;
}

/** Real CPU/RAM/GPU/VRAM from the OS — only available in the desktop shell. */
export async function detectNativeHardware(): Promise<NativeHardware | null> {
  const t = tauri();
  if (!t) return null;
  try {
    return await t.core.invoke<NativeHardware>("detect_hardware");
  } catch {
    return null;
  }
}

/** Run the generated setup command natively, streaming logs. Returns a stop fn. */
export async function runSetupStreamed(
  command: string,
  onLog: (line: string) => void,
  onExit: (code: number) => void,
): Promise<() => void> {
  const t = tauri();
  if (!t) {
    onExit(-1);
    return () => {};
  }
  const un1 = await t.event.listen("setup-log", (e) => onLog(String(e.payload)));
  const un2 = await t.event.listen("setup-exit", (e) => onExit(Number(e.payload)));
  await t.core.invoke("run_command_streamed", { command });
  return () => {
    un1();
    un2();
  };
}
