# Architecture

LightNode is one codebase that ships as two things: a web app and a desktop app.
This document explains how they fit together, why the desktop app loads the hosted
UI, how worker actions are signed safely, and where the moving parts live.

---

## One UI, two shells

```
                  Next.js UI (lightnode.vercel.app)
              landing  .  onboard wizard  .  dashboard
                       /                      \
                      /                        \
            browser tab                      Tauri desktop window
            (copy commands)                  (loads the SAME hosted UI,
                  |                            adds a native command bridge)
                  v                                    |
        server-side /api/* routes                      v
        (proxy the workers subgraph)         native commands over IPC
                                             (Docker, keystore, signing,
                                              hardware detection)
```

The web app and the desktop app render the exact same Next.js UI. The difference is
only what each can do locally:

- **Web** can browse the network and generate commands, but it cannot reach your
  machine, so worker operations are presented as copy-paste commands.
- **Desktop** is a Tauri v2 shell that loads the hosted UI and exposes a few native
  commands, so the same buttons actually run on your machine.

### Why the desktop app loads the hosted UI

The Tauri window points at `https://lightnode.vercel.app` rather than bundling a
build. The practical consequence: **web-side changes reach the desktop app on its
next launch via a normal `vercel --prod` deploy** - no new installer needed. Only
changes to the compiled layer (Rust commands, `tauri.conf.json`, or the capability
ACL) require a new tagged release.

A small in-app poller checks the deployed build id and reloads when it changes, so
the desktop UI does not get stuck on a stale page cached by the webview.

---

## The native bridge

The desktop shell (`desktop/src-tauri`) exposes a deliberately small set of
commands over IPC, declared in `build.rs` and granted to the hosted origin in
`capabilities/default.json`:

| Command | Purpose |
|---|---|
| `run_command_streamed` | Run a shell command and stream stdout back to the UI line by line. This is how install / status / settle / deregister / withdraw execute. |
| `detect_hardware` | Read CPU / memory / GPU for the machine-check and reward estimate. |
| `secret_set` / `secret_get` / `secret_delete` | Store worker secrets in the OS keychain. |
| `generate_worker_key` | Generate a worker key natively and return only its address. |
| `local_container_status` | Report the real local container state (running / stopped / missing). |

Every shell command these run is produced by [`lib/scriptgen.ts`](../lib/scriptgen.ts),
so the exact same logic backs the desktop's one-click buttons and the web app's
copy-to-clipboard commands. That single source is what the unit tests exercise.

---

## The source of truth for worker actions

The subtle, important design decision: **the on-disk keystore plus the worker
container - not the app's cached key - is authoritative for signing.**

For any on-chain worker action (settle, deregister, withdraw), the command:

1. finds the keystore the worker actually runs with
   (`~/lightchain-worker/keys/eth-keystore`),
2. recovers that keystore's password from the running container's environment
   (`docker inspect`), falling back to any app-supplied password, and uses whichever
   actually decrypts the keystore,
3. derives the signing key, then **verifies the derived address matches the worker
   being targeted** and refuses to sign otherwise.

Why this matters:

- **Payouts work even if the app's cached key drifts.** The app keeps a convenience
  copy of the worker key (for the in-browser withdraw path), but if that copy ever
  diverges from the installed worker, the keystore is still correct.
- **One network can never sign for another.** If you are toggled to mainnet while a
  testnet worker is installed, the address check fails fast with a clear message
  instead of signing with the wrong key.

The app's per-network secret storage is strict: a key or password stored for one
network is never returned for another, so a freshly funded mainnet worker cannot
contaminate a testnet action.

---

## Staying online

A worker only earns while its container runs, and the container only runs while
Docker is up. Docker Desktop is an app, so reboot, logout, or sleep stops it. The
install lays down a **keep-online watchdog** per OS:

- macOS: a launchd agent
- Linux: a cron entry (plus `systemctl enable docker`)
- Windows: a scheduled task

The watchdog starts Docker if it is down, starts the container if it is stopped, and
re-warms the model. A **pause marker** file makes intentional stops (Stop,
Deregister) stick, so the watchdog does not undo a deliberate shutdown. Note that
Docker's `--restart always` does not recover a graceful `docker stop`, which is
exactly why the watchdog exists.

---

## Data flow

All network and worker data is public and read live from the LightChain workers
subgraph. The browser never calls the subgraph directly; instead it goes through
server-side `/api/*` routes, which avoids client CORS issues and lets responses be
cached briefly at the CDN. Subgraph calls have a timeout and degrade gracefully so a
slow upstream does not hang the UI.

---

## Where things live

```
app/
  (routes)          landing, /onboard wizard, /dashboard
  api/              subgraph proxy + version/settlement/worker endpoints
components/
  onboard/          wizard steps (machine check, model picker, one-click install, verify)
  operations-panel  the worker control surface (status, settle, deregister, ...)
  withdraw-worker   move funds out, in-browser or keystore-signed
lib/
  network.ts        chain constants (ids, RPCs, registries, stakes)
  subgraph.ts       typed subgraph client
  hardware.ts       machine scoring + model fit
  secrets.ts        per-network worker secret storage (keychain / localStorage)
  scriptgen.ts      every generated shell command (install, ops, settle, withdraw)
  budget.ts         reads the real on-chain inference deadline
desktop/src-tauri/  Rust commands, build.rs, capabilities, tauri.conf.json
tests/unit/         Vitest (scriptgen, hardware, subgraph, utils)
tests/e2e/          Playwright smoke tests
```

The center of gravity is `lib/scriptgen.ts`. If you want to understand or change
what the app actually does to a machine, read that file - it is pure functions that
return shell strings, covered by unit tests, with no side effects of their own.
