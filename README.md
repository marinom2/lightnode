<div align="center">

<img src="public/lightnode-mark.png" alt="LightNode" width="88" />

# LightNode

**Build with, and run for, LightChain AI.**

A community-built developer and operator suite for the LightChain AI network. It
has a published SDK for encrypted inference, scaffolders that drop the SDK into
any project with one command, a live in-browser playground, and a desktop app
for running a worker. One project, two tracks.

[![CI](https://github.com/marinom2/lightnode/actions/workflows/ci.yml/badge.svg)](https://github.com/marinom2/lightnode/actions/workflows/ci.yml)
[![lightnode-sdk on npm](https://img.shields.io/npm/v/lightnode-sdk?color=7064e9&label=lightnode-sdk)](https://www.npmjs.com/package/lightnode-sdk)
[![create-lightnode-app on npm](https://img.shields.io/npm/v/create-lightnode-app?color=7064e9&label=create-lightnode-app)](https://www.npmjs.com/package/create-lightnode-app)
[![License: MIT](https://img.shields.io/badge/license-MIT-7064e9.svg)](LICENSE)
[![LightChain AI](https://img.shields.io/badge/LightChain%20AI-ecosystem%20tool-dd00ac.svg)](https://lightchain.ai)

</div>

## What you can do with this

Two completely separate use cases live in this repo. Pick the one that matches
what you actually want.

1. **You are a developer.** You want to add AI to your own app, paying per call,
   on a decentralized network instead of a single hosted vendor. Install
   `lightnode-sdk`, paste five lines of code, and your app can run encrypted
   prompts on the LightChain AI network. The network is decentralized, so it is
   not one company running it. Your wallet pays for each call directly on chain.

2. **You have a decent computer.** You want to make a bit of LCAI by serving
   prompts to other people's apps. Install the LightNode desktop app, click
   through the install wizard, and your machine becomes a worker on the network.
   The app handles the keys, the staking, the Docker container, and watches the
   worker so it stays online.

The two halves share one codebase and one community, but most people only need
one of them.

## Recently shipped

- `lightnode-sdk@0.4.4`. Adds `runInferenceWithKey()`. This is the literal
  5-line API: pass a network name, a private key, a prompt, get an answer
  back. No viem clients to wire up, no SIWE handshake to write. Also fixes
  a bug where a successful run could lose its on-chain `jobCompleted` proof
  because the polling gave up too early.
- Standalone examples repo at
  [`marinom2/lightnode-examples`](https://github.com/marinom2/lightnode-examples).
  60 KB, 12 files. Opens in StackBlitz in about a second. Used to be inside
  this repo, so cloning the whole thing took 30+ seconds.
- `npx lightnode add agent`. New scaffolder template for scheduled prompts.
  Drops in a Vercel Cron route (Next.js) or a long-running `setInterval`
  script (Node). Useful for daily summaries, monitoring agents, anything
  that needs to run on a schedule.
- Playground tidy-up. Network is now controlled by the toggle in the top
  nav (one source of truth across the whole site). The on-chain proof
  column is reliable again.
- Live playground at <https://lightnode.app/playground>. Connect a wallet,
  type a prompt, run one real encrypted inference in your browser. Free on
  testnet.

---

## Pick your path

<table>
<tr>
<td width="50%" valign="top">

### Build with LightChain AI

You want **encrypted inference in your dApp**.

- One SDK call wraps the full protocol (SIWE auth, ECDH-P256 + AES-GCM
  crypto, on-chain `createSession` + `submitJob`, decrypted streaming
  response).
- Non-custodial. The SDK never holds a key. Your wallet signs.
- About 0.022 LCAI per call on mainnet, free on testnet.
- Live-tested on both networks before every release.

```bash
# Brand-new project:
npm create lightnode-app my-app

# Existing project (auto-detects Next.js, Hono, or Node):
npx lightnode add inference
```

Try it first: <https://lightnode.app/playground>

Builder hub: <https://lightnode.app/build>

</td>
<td width="50%" valign="top">

### Run a LightChain AI worker

You want to **earn LCAI** by serving inference jobs.

- One-click install on your machine. Wallet, keys, stake, register, live.
- No terminal, no Docker fight, no manual key handling.
- A watchdog keeps it online. Deregister and withdraw are one click each.
- Tested on macOS. Linux and Windows are wired up and welcome bug reports.

```bash
# Download the desktop app:
# https://github.com/marinom2/lightnode/releases

# Or use the web version (copy/paste commands):
# https://lightnode.app/onboard
```

Web app: <https://lightnode.app>

Operator manual: [docs/WORKER_LIFECYCLE.md](docs/WORKER_LIFECYCLE.md)

</td>
</tr>
</table>

---

## Build track in detail

### Three published packages

| Package | Version | What it does |
| --- | --- | --- |
| [`lightnode-sdk`](https://www.npmjs.com/package/lightnode-sdk) | `0.4.4` | Read-only chain client (workers, jobs, models, analytics, on-chain registration truth). Plus the encrypted inference submit flow (`runInferenceWithKey`, `runInference`, and the lower-level `prepareSession` + `submitPrompt` + `decryptResponse`). Plus the `lightnode` CLI with `add` subcommands. |
| [`create-lightnode-app`](https://www.npmjs.com/package/create-lightnode-app) | `0.1.0` | One-command scaffolder for a brand-new LightChain dApp. Three templates: Node CLI, Next.js, Hono. |
| `lightnode add` (inside `lightnode-sdk`) | n/a | Patch an existing project. Auto-detects the framework, writes the right files. Safe to re-run. |

### The `add` catalog

```bash
npx lightnode add inference                    # encrypted inference route or script
npx lightnode add chat                         # chat UI with conversation history
npx lightnode add agent                        # scheduled inference (Vercel Cron or setInterval)
npx lightnode add analytics-dashboard          # read-only network + worker analytics page
npx lightnode add nft-mint-with-inference      # AI-generated NFT metadata with on-chain provenance
```

All `add` commands accept `--template auto|nextjs-api|hono|node`,
`--net testnet|mainnet`, and `--force`.

### What can I actually do with the SDK?

The SDK exposes everything you need to talk to the LightChain AI network from
your own code. It splits into three groups, top to bottom:

**1. Encrypted inference (paid).** The thing most builders want. Run a prompt,
get an answer back, pay per call in LCAI.

| You want to... | Use |
| --- | --- |
| Run one prompt in five lines. No wallet wiring. | `runInferenceWithKey({ network, privateKey, prompt })` |
| Same flow, but you already have viem clients and a SIWE JWT in your app. | `runInference({ gateway, wallet, publicClient, network, prompt })` |
| Drive each step yourself (custom retry, custom streaming, multi-turn). | `prepareSession`, `submitPrompt`, `decryptResponse`, plus your own viem calls. |

**2. Read-only chain client (free).** All the data the network exposes, without
paying for anything. Use this for dashboards, leaderboards, gating logic, or
to check things before you spend.

```ts
import { LightNode } from "lightnode-sdk";
const ln = new LightNode("mainnet");

await ln.getWorker("0x...");          // one worker's full record
await ln.getWorkers();                // all registered workers
await ln.getWorkerJobs("0x...", 20);  // recent jobs for a worker
await ln.getModels();                 // network's registered models (fees, limits)
await ln.getNetworkStats();           // totals + active count + earnings
await ln.getModelStats(1000);         // per-model completion, p50/p95, disputes
await ln.getWorkerStats(1000, 25);    // per-worker reliability, busiest first
await ln.getNetworkAnalytics(1000);   // network-wide rollup
await ln.isRegistered("0x...");       // authoritative on-chain truth (no indexer lag)
await ln.estimateFee("llama3-8b");    // what `submitJob` will charge
```

**3. Helpers.** Things you sometimes need around inference: `consumerGatewayUrl`,
`estimateJobFee`, the typed errors (`StalledWorkerError`, `OnChainRevertError`,
`RelayTokenTimeoutError`, `GatewayAuthError`) with the `isStalledWorker` type
guard, CSV writers (`modelStatsCsv`, `workerStatsCsv`, `workerJobsCsv`), and
`fromWei` for formatting earnings.

### If you have project X, do Y

Concrete recipes per common starting point. The right side is what to install
and what file ends up where.

| Your starting point | What to run | What you get |
| --- | --- | --- |
| Nothing yet, just want to try | `npm create lightnode-app my-app` | A new project with Node, Next.js, or Hono. Pick one, fill in `.env`, `npm start`. |
| Empty terminal, one prompt | `git clone marinom2/lightnode-examples && cd quickstart-inference && npm start` | A 30-line script. First run prints address + faucet; second run fires the prompt. |
| An existing Next.js app | `cd your-app && npx lightnode add inference` | A new `app/api/inference/route.ts`. POST a JSON body, get the answer back. Wallet stays server-side. |
| An existing Next.js app + a chatbot UI | `cd your-app && npx lightnode add chat` | A streaming chat page with conversation history. Same protocol, plus session reuse. |
| A scheduled task (daily summary, monitoring agent) | `cd your-app && npx lightnode add agent` | A Vercel Cron route in Next.js, or a `setInterval` script in plain Node. Includes `CRON_SECRET` Bearer-auth in the Next.js variant. |
| A Discord bot, Cloudflare Worker, or CLI tool | `npm install lightnode-sdk viem ws` plus the `hono-server` snippet | A Hono `/inference` endpoint you can host anywhere with Node. |
| A user-facing leaderboard or worker dashboard | `cd your-app && npx lightnode add analytics-dashboard` | A read-only page that pulls live network + worker stats and renders them. No keys, no wallet. |
| An NFT mint where each mint generates unique metadata with AI | `cd your-app && npx lightnode add nft-mint-with-inference` | A mint flow that runs an inference, anchors the answer to a content hash, and returns metadata. |
| You want users to pay per call from their own wallet (no server custody) | Copy the [playground source](app/playground/page.tsx) | The wallet-connect path. User signs `createSession` + `submitJob` in their browser, pays the LCAI directly from their connected wallet. |

### Two patterns: server-pays vs user-pays

The biggest decision when wiring inference into your app: **whose wallet pays
for each call?**

- **Server-pays** (the API-route examples). You hold a hot wallet on the
  server, top it up, the user just hits your API. Familiar pattern: the user
  does not need a wallet at all. Cheaper UX for the user. You own the cost.
- **User-pays** (the playground). The user connects their own wallet and signs
  the two on-chain transactions per call. You hold no keys and bear no cost,
  but the user needs LCAI in their wallet. This is the closest to "AI as a
  primitive" the network offers.

Both use the same SDK. The split is just whether you build it on top of
`runInferenceWithKey` (server-pays) or wire viem's `useWalletClient` to a
React component (user-pays).

### Three ways to try

| Path | What | Time | Cost |
| --- | --- | --- | --- |
| **[Live playground](https://lightnode.app/playground)** | Browser, connect wallet, run one real inference. | About 30 sec | Free on testnet |
| **[Open in StackBlitz](https://stackblitz.com/github/marinom2/lightnode-examples/tree/main/quickstart-inference)** | Cloud IDE, starter pre-installed. | About 5 sec | Free testnet |
| **[Open in Codespaces](https://codespaces.new/marinom2/lightnode-examples)** | Full VS Code dev environment with the examples repo. | About 1 min | GitHub free tier covers it |

### Live-tested

The SDK is tested end-to-end with real LCAI on both networks before each release.

| Network | createSession tx | submitJob tx |
| --- | --- | --- |
| mainnet (9200) | [`0xf091957f...57d4a6ca`](https://mainnet.lightscan.app/tx/0xf091957f515eb472e71f6d442ee24c9c74e948412e2b7ad658dfbb4b57d4a6ca) | [`0x6ff44a4a...79846bb89`](https://mainnet.lightscan.app/tx/0x6ff44a4aa4b08cd38715369705a4338af3bb6ee456f2b8819d62fc779846bb89) |
| testnet (8200) | [`0x77686f3f...ef2bc587`](https://testnet.lightscan.app/tx/0x77686f3fc37573f0745f256a5c74f5944d3a2a7de745129bd918e8b0ef2bc587) | [`0xba9d48c4...293b2bd96`](https://testnet.lightscan.app/tx/0xba9d48c4f8eacf24d363ceb884f6c6c2fcca54a82fa0a341625944d293b2bd96) |

Decrypted output, full receipts, and the source that ran them all live on
[`lightnode.app/build`](https://lightnode.app/build).

### Example projects

Runnable examples live in their own small repo so cloud IDEs clone them in
seconds: [`marinom2/lightnode-examples`](https://github.com/marinom2/lightnode-examples).
The repo has quickstart-inference (about 30 lines, auto-bootstraps a testnet
key on first run), nextjs-api-route, and hono-server.

What is in this repo:

| Path | What |
| --- | --- |
| [`sdk/`](sdk) | The `lightnode-sdk` source. |
| [`create-lightnode-app/`](create-lightnode-app) | The scaffolder source. |
| [`app/playground/page.tsx`](app/playground/page.tsx) | The full in-browser playground. Same SDK, with Reown/wagmi wallet connect. |

---

## Worker track in detail

A consumer desktop and web app for **running** a LightChain AI worker. Same
project as the build track, completely separate user flow.

### What it does

- **Real machine readiness.** Native CPU, RAM, GPU, VRAM detection, a capacity
  score, and a Speed test that runs a real inference against the live on-chain
  deadline.
- **One-click, wallet-funded install.** Generates and secures the worker key.
  Funds and stakes from your connected wallet. Registers on chain. Brings the
  worker online. Shows live progress and plain-English error messages.
- **Stays online for you.** A watchdog auto-starts Docker and the worker, keeps
  the model warm, optional downtime alerts via Discord webhook.
- **Multi-model serving** with a memory-fit gate, and live add-a-model from
  the dashboard.
- **Full lifecycle, no terminal.** Live earnings (settled vs pending-release),
  settle/claim, deregister, gas-aware withdraw, free-up-memory, replaced-key
  recovery, removed-worker uninstall.
- **Honest dashboard.** On-chain registration reader (works even when the
  public indexer lags a deregister + re-register cycle), one honest status pill,
  per-job processing time vs deadline, CSV export of any worker's job history.
- **Network analytics** at `/network`. Honest completion (jobs the indexer
  leaves stuck count as failures), p50/p95 latency, per-worker reliability,
  CSV-exportable.

### Getting started

| Step | Where |
| --- | --- |
| 1. Download the desktop app | [Releases](https://github.com/marinom2/lightnode/releases/latest) |
| 2. Or use the web app and copy/run commands | <https://lightnode.app/onboard> |
| 3. Full operator manual | [docs/WORKER_LIFECYCLE.md](docs/WORKER_LIFECYCLE.md) |

### Platform support (honest status)

| OS | Status |
| --- | --- |
| macOS (Apple Silicon) | Tested end-to-end on testnet and mainnet. |
| Linux | Installers build in CI and commands are syntax-checked. Full flow not yet hardware-verified. Community testing welcome. |
| Windows | Installers build in CI and PowerShell is parse-checked. Full flow not yet hardware-verified. Community testing welcome. |

---

## Networks

LightChain AI runs two networks. Same protocol, different chain IDs and contract
addresses.

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | 8200 | 9200 |
| RPC | `https://rpc.testnet.lightchain.ai` | `https://rpc.mainnet.lightchain.ai` |
| Explorer | <https://testnet.lightscan.app> | <https://mainnet.lightscan.app> |
| Faucet | <https://lightfaucet.ai> | n/a, bridge or buy LCAI |
| Worker min stake | 5,000 LCAI | 50,000 LCAI |
| Inference cost | free (testnet LCAI) | about 0.022 LCAI per call |

---

## Architecture (one line per layer)

- **Frontend.** Next.js 15 (App Router), React 19, Tailwind v4. Wallet via Reown
  AppKit (wagmi + viem). Live network data through server-side `/api/*` proxy
  routes (no client CORS, same-origin from the browser's perspective).
- **Desktop.** Tauri v2 shell that loads the hosted web UI and exposes a few
  native commands over IPC. A `vercel --prod` deploy reaches the desktop app on
  its next page load. No new installer needed for most changes.
- **SDK.** Pure TypeScript, ESM, ships to npm. Single peer dep: `viem`. Works in
  both browser and Node (Web Crypto via `globalThis`). Source of truth for the
  SDK ABI, the gateway client, the relay frame format, and the analytics
  aggregators.
- **Worker integration.** The on-disk keystore and worker container are the
  source of truth for signing. Any on-chain worker action derives the signing
  key from the keystore the worker actually runs with and verifies the derived
  address against the target worker. Refuses to sign one network's action with
  another network's key.

Longer write-up in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security and key handling

LightNode is **non-custodial**, on both tracks.

- The **SDK** never holds your private key. Your wallet signs every on-chain
  call via viem. The SDK only prepares the data and talks to the consumer
  gateway.
- The **worker app** generates the worker key locally, stores it in the OS
  keychain (with a localStorage fallback on unsigned builds), and writes the
  toolkit's keystore on disk. All worker payout transactions are signed locally
  on your machine.
- The funding wallet only reads its address and sends LCAI. It never signs
  worker operations.

Reporting a vulnerability: [SECURITY.md](SECURITY.md).

---

## Repo layout (top-level)

```
.
├── app/                 # Next.js routes (lightnode.app)
│   ├── build/           # Builder hub
│   ├── playground/      # Live in-browser inference
│   ├── network/         # Public analytics
│   ├── onboard/         # Worker onboarding wizard
│   ├── dashboard/       # Worker dashboard
│   └── api/             # /api/* proxy + subgraph routes
├── components/          # React UI (worker view, operations, install progress, ...)
├── lib/                 # scriptgen, install-progress diagnoser, subgraph client, hardware scoring, ...
├── sdk/                 # lightnode-sdk source (published to npm)
├── create-lightnode-app/# create-lightnode-app source (published to npm)
├── desktop/             # Tauri v2 shell (src-tauri)
├── tests/unit + tests/e2e/  # Vitest + Playwright
└── docs/                # Worker lifecycle, architecture, UI/design, releasing
```

---

## Quality gate

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e
cd sdk && npm run typecheck && npm run build
```

State on `main`: lint clean, typecheck clean, 196 unit tests, 13 E2E,
production build clean, SDK build clean, both CLIs smoke-tested live against
real testnet and mainnet inferences.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TypeScript with no `any`. Pure logic in
`lib/` with a matching test. Design tokens over hardcoded colors. Conventional
commits.

---

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 **KykyRykyPaloma**.

*LightNode is an independent, community-built tool for the LightChain AI
ecosystem. Not affiliated with or endorsed by the LightChain AI team.
Review the official [`lightchain-worker-toolkit`](https://github.com/lightchain-protocol/lightchain-worker-toolkit)
for the worker runtime's own security and operational model.*
