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

## Status
- ✅ Full icon set generated (`tauri icon` from `icons/logo-source.svg` → 1024px
  PNG → all platform sizes + `.icns`/`.ico`).
- ✅ One-click install **wired**: `components/onboard/one-click-install.tsx`
  (desktop-only) collects the password + funder key in-memory, passes them as
  process **env** to `run_command_streamed`, and streams a live install log.
- ✅ Real hardware detection feeds the web UI (`MachineCheck` uses true VRAM in
  the shell).
- ✅ `cargo check` passes.

## TODO before shipping a public binary
- **Code-sign + notarize** (macOS, needs an Apple Developer cert) / sign
  (Windows). Can't be done without your certificates.
- **Prod frontend decision**: currently loads the hosted URL (simplest). For an
  offline-capable app, bundle a Next static export + run the server as a Tauri
  sidecar (the API routes need a server).
- Run `npm run build` on each target OS to produce the installer.
