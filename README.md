<div align="center">

<img src="public/lightnode-mark.png" alt="LightNode" width="88" />

# LightNode

**Build with — and run for — LightChain AI.**

A community-built developer + operator suite for the LightChain AI network:
a published SDK for encrypted inference, scaffolders that drop the SDK into any
project in one command, a live in-browser playground, and the friction-free
desktop app to run a worker. One project, two coherent tracks.

[![CI](https://github.com/marinom2/lightnode/actions/workflows/ci.yml/badge.svg)](https://github.com/marinom2/lightnode/actions/workflows/ci.yml)
[![lightnode-sdk on npm](https://img.shields.io/npm/v/lightnode-sdk?color=7064e9&label=lightnode-sdk)](https://www.npmjs.com/package/lightnode-sdk)
[![create-lightnode-app on npm](https://img.shields.io/npm/v/create-lightnode-app?color=7064e9&label=create-lightnode-app)](https://www.npmjs.com/package/create-lightnode-app)
[![License: MIT](https://img.shields.io/badge/license-MIT-7064e9.svg)](LICENSE)
[![LightChain AI](https://img.shields.io/badge/LightChain%20AI-ecosystem%20tool-dd00ac.svg)](https://lightchain.ai)

</div>

> 🆕 **Recently shipped**
> - `lightnode-sdk@0.3.3` — encrypted inference end-to-end on mainnet + testnet, with new `lightnode add analytics-dashboard` and `lightnode add nft-mint-with-inference` subcommands.
> - `create-lightnode-app@0.1.0` — scaffold a new LightChain AI dApp in one command, with templates for Node, Next.js, and Hono.
> - **Live playground** at <https://lightnode.app/playground> — connect a wallet, run one real encrypted inference in the browser in 30 seconds.

---

## Pick your path

LightNode is **two tracks** that share one codebase and one community.
Most people only need one of them — but they're built so each makes the other better.

<table>
<tr>
<td width="50%" valign="top">

### 🛠 Build with LightChain AI

You want **encrypted inference in your dApp**.

- One SDK call wraps the full protocol (SIWE auth, ECDH-P256 + AES-GCM crypto, on-chain `createSession` + `submitJob`, decrypted streaming response).
- Non-custodial — the SDK never holds a key; your wallet signs.
- ~0.022 LCAI per call on mainnet, free on testnet.
- Live-verified on both networks before every release.

```bash
# Brand-new project:
npm create lightnode-app my-app

# Existing project (auto-detects Next.js / Hono / Node):
npx lightnode add inference
```

🎮 **Try it first**: <https://lightnode.app/playground>
📚 **Builder hub**: <https://lightnode.app/build>

</td>
<td width="50%" valign="top">

### ⚙️ Run a LightChain AI worker

You want to **earn LCAI** serving inference jobs.

- One-click install on your machine: wallet → keys → stake → register → live.
- No terminal, no Docker fight, no manual key handling.
- Watchdog keeps it online, deregister and withdraw are one click each.
- macOS battle-tested; Linux + Windows are wired up and welcome bug reports.

```bash
# Download the desktop app:
# https://github.com/marinom2/lightnode/releases

# Or just the web version (copy-paste commands):
# https://lightnode.app/onboard
```

🌐 **Web app**: <https://lightnode.app>
📖 **Operator manual**: [docs/WORKER_LIFECYCLE.md](docs/WORKER_LIFECYCLE.md)

</td>
</tr>
</table>

---

## 🛠 Build track in detail

### Three published packages

| Package | Version | What it does |
| --- | --- | --- |
| [`lightnode-sdk`](https://www.npmjs.com/package/lightnode-sdk) | `0.3.3` | Read-only chain client (workers, jobs, models, analytics, on-chain registration truth) **plus** the encrypted inference-submit flow (prepareSession, submitPrompt, decryptResponse) **plus** the `lightnode` CLI with `add` subcommands. |
| [`create-lightnode-app`](https://www.npmjs.com/package/create-lightnode-app) | `0.1.0` | One-command scaffolder for a brand-new LightChain dApp. Three templates: Node CLI, Next.js, Hono. |
| `lightnode add` (in `lightnode-sdk`) | — | Patch an existing project. Auto-detects framework, writes the right files. Idempotent. |

### The `add` catalog

```bash
npx lightnode add inference                    # encrypted inference route/script
npx lightnode add analytics-dashboard          # read-only network + worker analytics page
npx lightnode add nft-mint-with-inference      # AI-generated NFT metadata with on-chain provenance
```

All `add` commands accept `--template auto|nextjs-api|hono|node`, `--net testnet|mainnet`, and `--force`.

### Three ways to try

| Path | What | Time | Cost |
| --- | --- | --- | --- |
| **[Live playground](https://lightnode.app/playground)** | Browser, connect wallet, run one real inference. | ~30 sec | Free on testnet |
| **[Open in StackBlitz](https://stackblitz.com/github/marinom2/lightnode/tree/main/examples/quickstart-inference)** | Cloud IDE with the starter pre-installed. | ~30 sec | Free testnet |
| **[Open in Codespaces](https://codespaces.new/marinom2/lightnode)** | Full VS Code dev environment with this repo. | ~1 min | GitHub free tier covers it |

### Live-verified

The SDK is tested end-to-end with real LCAI on both networks before each release.

| Network | createSession tx | submitJob tx |
| --- | --- | --- |
| mainnet (9200) | [`0xf091957f…57d4a6ca`](https://mainnet.lightscan.app/tx/0xf091957f515eb472e71f6d442ee24c9c74e948412e2b7ad658dfbb4b57d4a6ca) | [`0x6ff44a4a…79846bb89`](https://mainnet.lightscan.app/tx/0x6ff44a4aa4b08cd38715369705a4338af3bb6ee456f2b8819d62fc779846bb89) |
| testnet (8200) | [`0x77686f3f…ef2bc587`](https://testnet.lightscan.app/tx/0x77686f3fc37573f0745f256a5c74f5944d3a2a7de745129bd918e8b0ef2bc587) | [`0xba9d48c4…293b2bd96`](https://testnet.lightscan.app/tx/0xba9d48c4f8eacf24d363ceb884f6c6c2fcca54a82fa0a341625944d293b2bd96) |

Decrypted output, full receipts, and the source they ran from all live on
[`lightnode.app/build`](https://lightnode.app/build).

### Example projects in this repo

| Path | What |
| --- | --- |
| [`examples/quickstart-inference/`](examples/quickstart-inference) | 120-line Node CLI starter — the simplest end-to-end inference. |
| [`examples/nextjs-api-route/`](examples/nextjs-api-route) | Drop-in `app/api/inference/route.ts` for any Next.js dApp. |
| [`examples/hono-server/`](examples/hono-server) | Standalone Hono microservice. |
| [`sdk/`](sdk) | The `lightnode-sdk` source. |
| [`create-lightnode-app/`](create-lightnode-app) | The scaffolder source. |
| [`app/playground/page.tsx`](app/playground/page.tsx) | The full in-browser playground — same SDK, with Reown/wagmi wallet connect. |

---

## ⚙️ Worker track in detail

A consumer-grade desktop + web app for **running** a LightChain AI worker.
Same project as the build track; entirely separate user flow.

### What it does

- **Real machine readiness** — native CPU/RAM/GPU/VRAM detection, a capacity
  score, a **Speed test** that runs an actual inference against the live on-chain
  deadline.
- **One-click, wallet-funded install** — generates and secures the worker key,
  funds + stakes from your connected wallet, registers on-chain, brings the
  worker online, with a live progress view and plain-English failure diagnosis.
- **Stays online for you** — keep-online watchdog auto-starts Docker + the
  worker, keeps the model warm, opt-in downtime alerts (Discord webhook).
- **Multi-model serving** with a memory-fit gate and live add-a-model.
- **Full lifecycle, no terminal** — live earnings (settled vs pending-release),
  settle/claim, deregister, gas-aware withdraw, free-up-memory, replaced-key
  recovery, removed-worker uninstall.
- **Truthful dashboard** — on-chain registration reader (works even when the
  public indexer lags a deregister → re-register cycle), single honest status pill,
  per-job processing time vs deadline, **CSV export** of any worker's job history.
- **Network analytics** (`/network`) — honest completion (jobs the indexer
  leaves stuck count as failures), p50/p95 latency, per-worker reliability,
  CSV-exportable.

### Getting started

| Step | Where |
| --- | --- |
| 1. Download the desktop app | [Releases](https://github.com/marinom2/lightnode/releases/latest) |
| 2. Or use the web app and copy-run commands | <https://lightnode.app/onboard> |
| 3. Full operator manual | [docs/WORKER_LIFECYCLE.md](docs/WORKER_LIFECYCLE.md) |

### Platform support (honest status)

| OS | Status |
| --- | --- |
| **macOS** (Apple Silicon) | Tested end-to-end on testnet + mainnet. |
| **Linux** | Installers build in CI and commands are syntax-validated. Full flow not yet hardware-verified — community testing welcome. |
| **Windows** | Installers build in CI and PowerShell is parse-checked. Full flow not yet hardware-verified — community testing welcome. |

---

## Networks

LightChain AI runs two networks; same protocol, different chain IDs and contract addresses.

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | 8200 | 9200 |
| RPC | `https://rpc.testnet.lightchain.ai` | `https://rpc.mainnet.lightchain.ai` |
| Explorer | <https://testnet.lightscan.app> | <https://mainnet.lightscan.app> |
| Faucet | <https://lightfaucet.ai> | none — bridge / buy LCAI |
| Worker min stake | 5,000 LCAI | 50,000 LCAI |
| Inference cost | free (testnet LCAI) | ~0.022 LCAI per call |

---

## Architecture (one-liner per layer)

- **Frontend**: Next.js 15 (App Router), React 19, Tailwind v4. Wallet via Reown
  AppKit (wagmi + viem). Live network data through server-side `/api/*` proxy
  routes (no client CORS, same-origin from the browser's perspective).
- **Desktop**: Tauri v2 shell that loads the hosted web UI and exposes a few
  native commands over IPC. A `vercel --prod` deploy reaches the desktop app on
  its next page load — no new installer required for most changes.
- **SDK**: pure TypeScript, ESM, ships to npm. Single peer dep: `viem`. Browser
  + Node compatible (Web Crypto via `globalThis`). Source of truth for the SDK
  ABI, the gateway client, the relay frame format, and the analytics aggregators.
- **Worker integration**: the on-disk keystore + worker container are
  source-of-truth for signing. Any on-chain worker action derives the signing
  key from the keystore the worker actually runs with and verifies the derived
  address against the target worker. Refuses to sign one network's action with
  another network's key.

Deeper write-up in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Security and key handling

LightNode is **non-custodial**, both tracks:

- The **SDK** never holds your private key. Your wallet signs every on-chain call via viem; the SDK only prepares the data and talks to the consumer gateway.
- The **worker app** generates the worker key locally, stores it in the OS keychain (with a localStorage fallback on unsigned builds), and writes the toolkit's keystore on disk. All worker payout transactions are signed locally on your machine.
- The funding wallet only ever reads its address and sends LCAI; it never signs worker operations.

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
├── examples/            # Per-framework SDK examples (quickstart, Next.js, Hono)
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

Current state on `main`: lint clean, typecheck clean, 191 unit tests, 13 E2E,
production build clean, SDK build clean, both CLIs smoke-tested live against
real testnet + mainnet inferences.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TypeScript with no `any`, pure logic
in `lib/` with a matching test, design tokens over hardcoded colors,
conventional commits.

---

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 **KykyRykyPaloma**.

*LightNode is an independent, community-built tool for the LightChain AI
ecosystem. Not affiliated with or endorsed by the LightChain AI team.
Review the official [`lightchain-worker-toolkit`](https://github.com/lightchain-protocol/lightchain-worker-toolkit)
for the worker runtime's own security and operational model.*
