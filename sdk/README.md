# lightnode-sdk

[![npm](https://img.shields.io/npm/v/lightnode-sdk?color=7064e9)](https://www.npmjs.com/package/lightnode-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-7064e9.svg)](LICENSE)

**The community SDK for LightChain AI.** Encrypted on-chain inference, network
analytics, multi-turn chat, an Ethereum bridge wrapper, an LCAI Governor
client, an on-chain model registry reader, worker preflight + watch, a full
worker-operator surface (register, stake, settle, stuck-job recovery, exit),
and a bundled `lightnode` CLI. Non-custodial. Pure JS (works in Node 18+,
browsers, StackBlitz, Cloudflare Workers, Bun). Single peer dep: `viem`.

```bash
npm install lightnode-sdk viem
```

LightChain's own docs list official SDKs as "soon"; this fills the gap. Not
affiliated with LightChain.

New to blockchain or Node.js? Read the
[Getting Started guide](../GETTING-STARTED.md) first. It covers wallets, testnet
vs mainnet, the `.env` file, and your first AI call in about 5 minutes. Then come
back here for the full reference. The rest of this README assumes you're
comfortable with TypeScript and a terminal.

## Five-line "hello world"

```ts
import { runInferenceWithKey } from "lightnode-sdk";

const { answer, txs } = await runInferenceWithKey({
  network: "testnet",                                  // or "mainnet"
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  prompt: "Reply with a one-sentence fun fact about the ocean.",
});

console.log(answer);              // the decrypted reply
console.log(txs.createSession);   // on-chain receipts
```

In the browser this works as-is. In Node, `ws` is auto-detected if installed,
so you don't need to pass a WebSocket explicitly.

## What's in the SDK

### Inference (paid)

| API | Use when |
|---|---|
| **`runInferenceWithKey({ network, privateKey, prompt, ... })`** | One call from a wallet. The SDK builds viem clients, runs SIWE, encrypts, signs, decrypts. ~5 lines total. |
| **`runInference({ gateway, wallet, publicClient, network, prompt, ... })`** | You already have viem clients + a SIWE JWT. Same internals, no setup duplication. The /playground uses this with a Reown wallet. |
| **`runInferenceStream({ network, privateKey, prompt, ... })`** | Modern `AsyncIterable<string>` of chunks plus a `done` promise for the final receipt. `for await (const chunk of stream) ...` |
| **`Conversation` / `chat({ network, privateKey })`** | Multi-turn chat helper. Keeps history client-side; one encrypted inference per `.send()`. Optional `system` prompt, `maxHistoryTurns` cap. |
| **`prepareSession`, `submitPrompt`, `decryptResponse`** | Lowest-level: drive the protocol step by step. Build custom retry, batching, multi-turn-with-session-reuse on top. |

All four high-level entry points share:
- Auto-retry on `StalledWorkerError` (default 2 retries, configurable).
- Auto-resolve `globalThis.WebSocket` in browsers, dynamic-import `ws` in Node.
- Streaming via `onChunk(piece, totalSoFar)` callback.
- Byte-perfect crypto vs LightChain's reference client (ECDH P-256 + raw
  32-byte shared secret + AES-256-GCM, `@noble/curves` and `@noble/ciphers`
  under the hood).

### Read-only `LightNode` client (free, no key)

```ts
import { LightNode } from "lightnode-sdk";
const ln = new LightNode("mainnet"); // or "testnet" or a custom NetworkConfig

await ln.getNetworkStats();              // totals + active count + earnings
await ln.getModels();                    // ModelInfo[] (name, fee, max tokens)
await ln.getWorkers(200);                // Worker[], busiest first
await ln.getWorker("0x...");             // one worker record (or null)
await ln.getWorkerJobs("0x...", 20);     // recent jobs for one worker
await ln.getModelStats(1000);            // per-model completion / p50 / p95
await ln.getWorkerStats(1000, 25);       // per-worker reliability
await ln.getNetworkAnalytics(1000);      // network-wide rollup
await ln.isRegistered("0x...");          // chain-truth registration (no indexer lag)
await ln.getEarningsLcai("0x...");       // settled earnings in LCAI
await ln.estimateFee("llama3-8b");       // live per-job fee from AIConfig
await ln.modelId("llama3-8b");           // keccak256 of the model tag
await ln.getJobStatus(1234n);            // category + refundable flag (new in 0.5.0)
ln.gateway({ bearer });                  // pre-configured GatewayClient
```

Plus the bare-metal aggregators (`aggregateModelStats`, `aggregateWorkerStats`,
`networkAnalytics`) and CSV exporters (`modelStatsCsv`, `workerStatsCsv`,
`workerJobsCsv`) for reporting / dashboards.

### Bridge SDK (new in 0.5.0)

Typed wrapper around the LightChain Hyperlane Warp Route bridge.

```ts
import { Bridge, BRIDGE_ROUTE } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY!);
const ethPub = createPublicClient({ transport: http(BRIDGE_ROUTE.ethereum.rpc) });
const ethWal = createWalletClient({ account, transport: http(BRIDGE_ROUTE.ethereum.rpc) });

const bridge = new Bridge(ethPub, ethWal);

// Quote the Hyperlane gas payment for one message
const fee = await bridge.quoteFee("ethereum", "lightchain-mainnet");

// One-time ERC-20 approval (MaxUint256 by default)
await bridge.approve();

// Send 100 LCAI to your own address on LightChain mainnet
await bridge.transfer({
  from: "ethereum",
  to: "lightchain-mainnet",
  amount: parseEther("100"),
  recipient: account.address,
  fee,
});
```

For the reverse direction, wire `BRIDGE_ROUTE["lightchain-mainnet"].rpc`
instead and `from: "lightchain-mainnet"`. The SDK attaches native LCAI as
value automatically.

Confirmed addresses (baked in):
| Side | Role | Address |
|------|------|---------|
| Ethereum | HypERC20Collateral | `0x01f80bb8e78e79881E8Ec7832fB6C2c59f64e353` |
| Ethereum | LCAI ERC-20 | `0x9cA8530CA349c966Fe9ef903Df17a75B8A778927` |
| LightChain | HypNative | `0xEc7096A3116EE769457C939617375Ec1785AA6f1` |

### DAO SDK (new in 0.5.0)

OpenZeppelin Governor v5 wrapper for the LCAIGovernor on Ethereum mainnet.

```ts
import { DAO, VoteSupport, PROPOSAL_STATE_LABEL } from "lightnode-sdk";

// Read
const dao = new DAO(publicClient, "ethereum");
const cfg = await dao.config();                   // delay / period / threshold
const p = await dao.proposal(12345n);             // state + votes + key blocks
console.log(p.stateLabel);                        // "active" | "queued" | ...

// Write (needs wallet)
const daoRW = new DAO(publicClient, "ethereum", walletClient);
await daoRW.castVote(12345n, VoteSupport.For, "I support this");
await daoRW.propose({ targets, values, calldatas, description });
await daoRW.queue({ targets, values, calldatas, descriptionHash });
await daoRW.execute({ targets, values, calldatas, descriptionHash });
```

Confirmed Ethereum addresses (baked in):
- LCAIGovernor `0x6dfa413B5900a1a7947BC75E68AbBA093cB2492d`
- LCAITimeLock `0xbE1c37F8C4DA77dD06F4A8AC5098Ec70273093d7`
- LCAIBallots (IVotes) `0x75F3D01c4D960FE986A598B7954A3b786B29cE49`
- LCAI ERC-20 `0x9cA8530CA349c966Fe9ef903Df17a75B8A778927`
- LCAITreasury `0x07A716a551E5f4CA7D6C71Da9dF1cb1429Dba826`

Voting params (live-read via `dao.config()`): ~1 day delay, ~14 day period,
140k LCAI threshold, 3% quorum.

### On-chain Model Registry reader (new in 0.5.0)

Typed reader for `AIVMModelRegistry` + `BenchmarkRegistry`. Since LightChain
has not published a public deployment address, you pass yours explicitly:

```ts
import { OnchainModelRegistry, MODEL_STATUS_LABEL } from "lightnode-sdk";

const reader = new OnchainModelRegistry({
  publicClient,
  registry: "0x...",       // AIVMModelRegistry deployment
  benchmarks: "0x...",     // optional, only for benchmark methods
});

const baseIds = await reader.getBaseModelIds();
const variantIds = await reader.getAllVariants();
const variant = await reader.getVariant("...");
const policy = await reader.getAccessPolicy("...");   // tier: "free" | "paywalled" | "ticket-gated"
const variants = await reader.getVariantsForBaseModel(baseId);
```

Surfaces the full ABI for both contracts plus a builder-friendly `tier`
heuristic derived from the raw `AccessPolicyConfig`.

### Worker preflight + watch (new in 0.5.0)

Remote operational SDK for the worker network. No SSH, no Docker. Works from
any machine with a funded wallet (preflight) or no key at all (watch).

```ts
import { workerPreflight, workerWatch, LightNode } from "lightnode-sdk";

// One real test inference. Returns verdict, elapsed time, on-chain receipts.
const r = await workerPreflight({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  model: "llama3-8b",
  deadlineMs: 60_000,
});
console.log(r.verdict);    // "ok" | "over-deadline" | "stalled" | "failed"
console.log(r.summary);    // human one-liner
console.log(r.txs);        // createSession + submitJob + jobCompleted

// Watch a worker's on-chain + indexer state. AsyncIterable of events.
const ln = new LightNode("mainnet");
const handle = workerWatch(ln, "0xWorker...", { intervalMs: 30_000 });
for await (const event of handle.events) {
  console.log(event.kind);   // "snapshot" | "registered" | "went-stale" | "back-online" | "jobs-completed" | "earnings-up"
  console.log(event.state);  // { registered, lastSeenSecsAgo, jobsCompleted, earningsLcai, ... }
}
```

### Worker operator (new in 0.7.0)

The **write/ops side** of running a worker - the on-chain actions that are
otherwise only reachable through the multi-GB worker Docker image, or by
reverse-engineering the unverified contracts. Pure RPC: run it from a laptop, a
server, or CI with no worker image at all. This complements (does not replace)
`workerPreflight`/`workerWatch` above.

Its flagship is **stuck-job recovery**. When a worker acknowledges a job but
never completes it (Ollama down, machine asleep), that job sits `Acknowledged`
forever and **blocks deregistration** - and no official tool clears it. The
JobRegistry's `claimTimeout` is permissionless, so the operator can self-clear
it. `unstickAndDeregister()` is the one-call rescue.

The second thing it gets right is **gas-correct writes**. The worker daemon
under-sets the gas limit on its WorkerRegistry writes, so `addSupportedModel` and
`deregisterWorker` run out of gas and revert on-chain - the daemon reports a
failure (or, for deregister, some indexers still flip the worker to
"deregistered" while the stake never moves). Every write here estimates the gas
first and sends with a margin, so the transaction lands. `addModel()` is the
gas-correct version of the model-add the daemon botches; `deregister()` is the
gas-correct exit.

```ts
import { WorkerOperator } from "lightnode-sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chain = { id: 8200, name: "LC Testnet",
  nativeCurrency: { name: "LCAI", symbol: "LCAI", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.lightchain.ai"] } } };
const publicClient = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]), chain });
const walletClient = createWalletClient({ account: privateKeyToAccount(process.env.WORKER_KEY!), transport: http(chain.rpcUrls.default.http[0]), chain });

const op = new WorkerOperator("testnet", { publicClient, walletClient });

// Reads (no wallet needed): status, live protocol config, typed jobs.
await op.status();              // { registered, stakeLcai, claimableLcai, belowFloor, ... }
await op.config();              // live AIConfig: minStake, timeouts, slashBps, fee split
await op.getJob(974);           // typed Job { state, worker, escrowedFeeWei, timestamps, ... }

// Pre-flight gating - know WHY before you spend gas. Pass the worker's job IDs
// (from LightNode.getWorkerJobs / the subgraph).
await op.canDeregister([974, 976, 978, 979]);   // { ok, blockedBy: [974, 976], reason }

// Settlement + exit, Docker-free:
await op.releaseAll([978, 979]); // settle completed jobs past their dispute window
await op.withdraw();             // pull earned balance into the worker wallet

// The rescue: clear stuck acked jobs, then deregister + withdraw, in one call.
await op.unstickAndDeregister([974, 976, 978, 979]);
```

Full method reference (`jobIds` are the worker's IDs from
`LightNode.getWorkerJobs` or the subgraph):

| Method | Wallet | What it does |
|---|---|---|
| `status()` | no | registration, stake, claimable balance, below-floor flag |
| `config()` | no | live AIConfig: minStake, timeouts, slash bps, fee split |
| `getJob(id)` | no | one job as a typed `OnchainJob` struct |
| `stuckJobs(jobIds)` | no | the acked, past-deadline jobs (with seconds past deadline) |
| `canDeregister(jobIds)` | no | `{ ok, blockedBy, reason }` without sending a tx |
| `earnings({ ... })` | no | claimable now vs lifetime vs pending-release |
| `profitability({ ... })` | no | per-job worker fee net of gas, from the live fee split |
| `claimTimeout(id)` | yes | time out one stuck job (mainnet: realizes a slash) |
| `clearStuck(jobIds)` | yes | claimTimeout every past-deadline acked job; returns cleared + skipped |
| `releaseJob(id)` | yes | settle one completed job past its window |
| `releaseAll(jobIds)` | yes | settle all releasable completed jobs; skips not-ready ones |
| `withdraw()` | yes | pull the earned balance into the worker wallet |
| `topUpStake(lcai)` | yes | add stake |
| `withdrawStake(lcai)` | yes | remove stake above the floor |
| `addModel(tagOrId)` | yes | add a supported model to a registered worker on-chain, gas-correct (no-op if already served) |
| `reinstate()` | yes | reactivate a suspended worker |
| `deregister()` | yes | exit and release stake, gas-correct (reverts if in-flight jobs remain) |
| `unstickAndDeregister(jobIds)` | yes | clear stuck + release + withdraw + deregister, in one call |

> **Mainnet slashing.** `claimTimeout` / `clearStuck` / `unstickAndDeregister`
> finalize a stuck job as `TimedOut`, which **realizes the completion-timeout
> slash** on mainnet (`config().slashBps.completionTimeout`, 5% of stake per job
> at writing). Testnet has slashing disabled. It is the deliberate price of
> unblocking an exit a stuck job would otherwise block forever - only clear jobs
> you accept are lost.

**Decoded reverts.** The WorkerRegistry/JobRegistry custom errors aren't in the
4byte directory; `decodeWorkerError(revertData)` turns them into a sentence + the
fix, and every write throws a `WorkerOpError` carrying the decoded cause:

| Error | Meaning |
|---|---|
| `ActiveJobsExist(worker, n)` | deregister blocked by `n` in-flight jobs - `clearStuck()` them first |
| `DisputeWindowNotElapsed(jobId, releaseAt, now)` | `releaseJob` too early - retry after the window |
| `InsufficientStake(requested, available)` | `withdrawStake` below the floor - `topUpStake()` + `reinstate()` |
| `WorkerNotRegistered(addr)` | not a registered worker |

Scope: this is the **operator** surface (register/stake/settle/recover/exit). It
does not serve jobs - that's the official Go worker daemon. Contracts are
unverified and may change; treat as 0.x and lean on `decodeWorkerError` to
surface drift.

### Batch runner (new in 0.6.0)

Fan out many prompts as parallel encrypted inferences. Capped concurrency, stable result order, per-slot errors so one stalled worker does not kill the batch.

```ts
import { runInferenceBatch } from "lightnode-sdk";

const results = await runInferenceBatch({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  model: "llama3-8b",
  system: "Reply in one short sentence.",
  concurrency: 4,
  prompts: [
    "one-line fact about the ocean",
    "one-line fact about the moon",
    "one-line fact about coffee",
  ],
  onSlotComplete: ({ index, result, error }) => {
    console.log(`#${index}`, error?.message ?? result?.answer);
  },
});

for (const r of results) {
  if (r.error) console.warn(`slot ${r.index} failed:`, r.error.message);
  else console.log(r.result.answer);
}
```

Fits: batch evals, content scoring, RAG re-ranking, parallel rewrites. Pass `{signal}` (`AbortSignal`) to cancel queued slots mid-run.

### Agent class (new in 0.6.0)

ReAct-style tool calling on top of `runInferenceWithKey`. The model emits `<tool>name {"k":"v"}</tool>` or `<answer>...</answer>`; the SDK parses, runs the handler, threads the observation back. Works on small open models (llama3-8b) without native function calling.

```ts
import { Agent } from "lightnode-sdk";

const agent = new Agent({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  model: "llama3-8b",
  system: "You are a careful research assistant.",
  tools: [
    {
      name: "add",
      description: "Add two integers and return the sum.",
      args: { a: "first integer", b: "second integer" },
      handler: ({ a, b }) => Number(a) + Number(b),
    },
  ],
  maxIterations: 3,
  onStep: (step) => console.log(step.kind, step),
});

const { answer, steps, hitLimit } = await agent.run("What is 17 + 25?");
console.log(answer);   // "42"
console.log(steps);    // [{ kind: "tool_call", ... }, { kind: "answer", text: "42" }]
```

Each iteration is one inference (one on-chain `submitJob`); cap `maxIterations` to keep wall-clock + cost bounded. Tool handlers are plain functions that may be async; return JSON-serializable data so the model can read the observation.

### Cancellation (new in 0.6.0)

`runInference` and `runInferenceWithKey` accept an `AbortSignal`. In-flight on-chain transactions still settle (the protocol is the source of truth); the SDK just stops awaiting and rejects with `Error("aborted")`.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 15_000);

await runInferenceWithKey({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY!,
  prompt: "short answer please",
  signal: controller.signal,
});
```

### Typed errors

```ts
import { isStalledWorker, StalledWorkerError, OnChainRevertError, RelayTokenTimeoutError, GatewayAuthError } from "lightnode-sdk";

try {
  await runInferenceWithKey({ ... });
} catch (e) {
  if (isStalledWorker(e)) { /* worker never produced an answer; protocol refunds */ }
  // ...
}
```

| Error | When |
|---|---|
| `StalledWorkerError` | Worker ack'd then went silent. After `maxRetries`, raised. Protocol refunds. |
| `OnChainRevertError` | `createSession` or `submitJob` reverted. Includes the tx hash. |
| `RelayTokenTimeoutError` | Gateway dispatcher never issued the relay JWT (transient). |
| `GatewayAuthError` | SIWE handshake or JWT issue. Re-auth and retry. |

## CLI

`lightnode` is bundled. Read-only commands work anywhere; chat / wallet / preflight need `PRIVATE_KEY`.

### Read-only (no key)

```bash
npx lightnode network                    # network summary JSON
npx lightnode models                     # registered models + fees
npx lightnode worker 0x...               # one worker + 5 recent jobs
npx lightnode jobs 0x... --csv           # job history
npx lightnode registered 0x...           # true | false | null (chain truth)
npx lightnode fee llama3-8b              # per-job LCAI fee
npx lightnode analytics --csv            # per-model performance
npx lightnode reliability --csv          # per-worker reliability
npx lightnode job 1234                   # job status + refundable flag
npx lightnode worker watch 0x... --interval 30   # JSON event per state change
npx lightnode bridge addresses           # bridge route
npx lightnode dao addresses              # LCAI Governor addresses
npx lightnode dao config                 # live voting delay / period / threshold
```

### Need PRIVATE_KEY

```bash
PRIVATE_KEY=0x... npx lightnode chat "Write me a haiku about LightChain"
PRIVATE_KEY=0x... npx lightnode batch prompts.json --concurrency 4   # N prompts in parallel
PRIVATE_KEY=0x... npx lightnode agent "research X and summarize"     # ReAct agent, built-in tools
PRIVATE_KEY=0x... npx lightnode wallet address
PRIVATE_KEY=0x... npx lightnode wallet balance --net testnet
                  npx lightnode wallet new           # generates a fresh key
PRIVATE_KEY=0x... npx lightnode worker preflight --net testnet
```

### Worker operator (signs as the worker key)

Run a worker's on-chain lifecycle from the terminal. `status` and `can-deregister`
are read-only; the rest sign with `PRIVATE_KEY` and act on the worker that key
controls. Mainnet `clearstuck` and `deregister` realize a slash, so they require
`--yes`.

```bash
                  npx lightnode worker status 0x...        # registration, stake, claimable, live config
                  npx lightnode worker models 0x...        # models served, reconciled vs chain (servingNow truth)
PRIVATE_KEY=0x... npx lightnode worker preflight           # one real test inference, print verdict + timings
PRIVATE_KEY=0x... npx lightnode worker can-deregister      # what blocks the exit, before spending gas
PRIVATE_KEY=0x... npx lightnode worker settle              # release completed jobs past their window + withdraw
PRIVATE_KEY=0x... npx lightnode worker withdraw            # pull the earned balance into the worker wallet
PRIVATE_KEY=0x... npx lightnode worker clearstuck --yes    # claimTimeout acked, past-deadline jobs that block exit
PRIVATE_KEY=0x... npx lightnode worker deregister --yes    # clear stuck + settle + withdraw + deregister
```

### Scaffolders (write files into your project)

Server-paid (you host a backend; your funded wallet pays per call):

```bash
npx lightnode add inference                    # encrypted inference route or script
npx lightnode add chat                         # chat UI with conversation history
npx lightnode add judge                        # pass/fail evaluator route (criteria + evidence)
npx lightnode add agent                        # scheduled inference (Vercel Cron / setInterval)
npx lightnode add analytics-dashboard          # read-only network + worker analytics page
npx lightnode add nft-mint-with-inference      # AI-generated NFT metadata with on-chain provenance
```

User-paid (no backend; each visitor signs + pays from their own wallet):

```bash
npx lightnode add inference-web3               # one-shot inference UI, wallet-signed
npx lightnode add chat-web3                     # chat UI, wallet-signed (mainnet + testnet aware)
npx lightnode add judge-web3                    # evaluator UI, wallet-signed
npx lightnode add wagmi-setup                   # wallet wiring: lib/wagmi + providers + connect button
```

The `*-web3` scaffolders are one command end to end: run in an empty folder and
they scaffold a Next.js app, write the page with a wired Connect button, bundle
the wagmi config + providers + connect button, wrap your layout with
`<Providers>`, and `npm install` the deps. Run inside an existing Next.js app
and they skip the scaffold and just add what's missing. Opt out of the
automation with `--no-scaffold` and `--no-install`.

All `add` commands accept `--template auto|nextjs-api|hono|node`,
`--net testnet|mainnet`, `--force`, `--no-install`, and `--no-scaffold`.

> If `add <name>` reports an unknown target, your `npx` cache is serving an
> older CLI. Force the current release: `npx lightnode-sdk@latest add <name>`.

## Networks

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 8200 | 9200 |
| RPC | `https://rpc.testnet.lightchain.ai` | `https://rpc.mainnet.lightchain.ai` |
| Explorer | <https://testnet.lightscan.app> | <https://mainnet.lightscan.app> |
| Faucet | <https://lightfaucet.ai> (~2 LCAI / IP / day) | n/a (bridge from Ethereum) |
| Inference cost | free | ~0.022 LCAI per call |
| Worker stake | 5,000 LCAI | 50,000 LCAI |

## Examples

Tiny standalone repo: <https://github.com/marinom2/lightnode-examples>.
Eight runnable examples covering every SDK module:

- `quickstart-inference/` (30-line one-shot)
- `multi-turn-chat/` (interactive REPL)
- `nextjs-api-route/` (drop-in App Router route)
- `hono-server/` (any-Node microservice)
- `bridge-transfer/` (LCAI bridge in both directions)
- `dao-vote/` (read + vote LCAI Governor)
- `worker-preflight/` (one real test inference + watch)
- `model-registry-read/` (AIVMModelRegistry reader)

Open any of them in StackBlitz in about 5 seconds:

```
https://stackblitz.com/github/marinom2/lightnode-examples/tree/main/quickstart-inference
```

## Non-custodial

- The SDK never holds your key. Every on-chain call is signed via viem in
  your process.
- End-to-end encryption: your prompt is encrypted to the worker's ECDH pubkey
  before it leaves your machine. The gateway, the relay, and any third party
  in the path see only ciphertext.
- The session key is ephemeral (32 random bytes per session). Never persisted.
- Browser bundles work too: noble-backed crypto, no Web Crypto algorithm
  dependency, no Node-only imports.

## Compatibility

| Runtime | Status |
|---|---|
| Node 18+ | Tested; `ws` auto-detected. |
| Modern browsers | Works via `globalThis.WebSocket`. The /playground uses it. |
| StackBlitz / Bolt WebContainer | Works since 0.4.8 (noble crypto, lightnode.app CORS proxy). |
| Cloudflare Workers / Bun | Works. Pass a `WebSocket` ctor if the runtime lacks one. |

## Provenance

The protocol surface (consumer gateway, relay, JobRegistry ABI, crypto
layout) is built against
[LightChain's reference client](https://github.com/lightchain-protocol/lcai-chat-v2)
and cert-transparency host enumeration. Crypto is byte-perfect vs the
reference (`@noble/curves` for P-256, `@noble/ciphers` for AES-256-GCM).

If LightChain ships official SDKs that supersede this one, we'll archive the
inference path and keep the analytics + bridge + DAO + preflight modules.

## License

MIT. Independent, community-built. Not affiliated with or endorsed by the
LightChain team.
