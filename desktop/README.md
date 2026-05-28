# LightNode Desktop (Tauri v2)

The desktop shell that makes worker onboarding **truly one-click** - the two
things a browser sandbox can't do:

1. **Real hardware detection** - actual CPU/RAM/GPU/**VRAM** via OS tools
   (`nvidia-smi`, `system_profiler`, `wmic`) instead of browser guesses.
2. **Native install** - runs the setup pipeline locally and streams progress to
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
│   • secret_set/get/delete  → OS keychain        │
│   • generate_worker_key()  → key, returns addr  │
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
The full bridge is six commands (declared in `build.rs`, granted to the hosted
origin in `capabilities/default.json`):

| Command | Purpose |
|---|---|
| `detect_hardware` | `{ os, cores, ram_gb, gpu, vram_gb, unified }` from the OS |
| `run_command_streamed(command, env)` | runs the generated setup, emits `setup-log` / `setup-exit` events |
| `secret_set` / `secret_get` / `secret_delete` | store/read worker secrets in the OS keychain |
| `generate_worker_key(name)` | generate a worker key natively, return only its address |

The local container's state and live worker health have no dedicated command -
they're read by running short `docker` commands through `run_command_streamed`.

## Security model
- **Non-custodial.** No key ever leaves the device or reaches a LightNode server.
  The worker key is generated natively (`generate_worker_key`) and the worker
  key/password live in the **OS keychain** (`secret_*`); all signing happens
  locally. Nothing sensitive is sent over the network.
- `run_command_streamed` executes shell commands the UI generates. The webview
  only loads the first-party LightNode UI, so this is first-party code - if you
  point the shell at any other origin, lock it down with an allowlist.

## Releasing

Tagged `v*` builds produce macOS / Linux / Windows installers via GitHub Actions
(see [../docs/RELEASING.md](../docs/RELEASING.md)). For a published binary you also
need to **code-sign + notarize** (macOS Apple Developer cert) / sign (Windows) with
your own certificates. The prod webview loads the hosted URL; an offline build would
need a bundled Next export with the API routes served by a Tauri sidecar.
