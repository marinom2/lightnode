# LightNode Desktop (Tauri v2)

The desktop shell that makes worker onboarding **truly one-click** — the two
things a browser sandbox can't do:

1. **Real hardware detection** — actual CPU/RAM/GPU/**VRAM** via OS tools
   (`nvidia-smi`, `system_profiler`, `wmic`) instead of browser guesses.
2. **Native install** — runs the setup pipeline locally and streams progress to
   the UI (no copy-paste, no terminal).

It reuses the exact same LightNode web UI (loaded in the webview), so there's one
codebase. The web UI detects the desktop shell via `window.__TAURI__` (see
[`lib/tauri.ts`](../lib/tauri.ts)) and calls the native commands when present.

## Architecture
```
┌──────────────── Tauri window ────────────────┐
│  LightNode web UI (Next.js, loaded in webview) │
│        │  window.__TAURI__.core.invoke         │
│        ▼                                        │
│  Rust commands (src-tauri/src/main.rs):         │
│   • detect_hardware()      → real specs         │
│   • run_command_streamed() → install + logs     │
└─────────────────────────────────────────────────┘
```
- **dev**: the webview loads `http://localhost:3000` (run the web app: `cd .. && npm run dev`).
- **prod**: `frontend/index.html` points the webview at the deployed web UI.

## Build & run
Requires the Rust toolchain (`rustc`/`cargo`) and Node.

```bash
cd desktop
npm install
npm run dev      # launches the desktop app against the local web UI (port 3000)
npm run build    # produces a signed-ready installer for the current OS
```

`cargo check` (Rust only, no bundle):
```bash
cd desktop/src-tauri && cargo check
```

## Native commands
| Command | Purpose |
|---|---|
| `detect_hardware` | `{ os, cores, ram_gb, gpu, vram_gb, unified }` from the OS |
| `run_command_streamed(command)` | runs the generated setup, emits `setup-log` / `setup-exit` events |

## Security model
- **Non-custodial.** The app never stores keys. The web UI prompts for the
  worker password / funder key in-memory and passes them to the local process;
  nothing is written by this shell.
- `run_command_streamed` executes shell commands the UI generates. Because the
  webview only loads the first-party LightNode UI, this is first-party code — but
  if you point the shell at any other origin, lock this down with an allowlist.

## TODO before shipping a public binary
- Replace `icons/icon.png` with a full icon set (`tauri icon path/to/logo.png`).
- Code-sign + notarize (macOS) / sign (Windows) for distribution.
- Decide prod frontend: load the hosted URL (current) or bundle a Next static
  export + run the server as a sidecar (needed offline / for the API routes).
- Wire `run_command_streamed` into the onboarding "one-click" button behind a
  secure secret prompt.
