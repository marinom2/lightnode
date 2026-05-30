# lightnode-sdk

[![npm](https://img.shields.io/npm/v/lightnode-sdk?color=7064e9)](https://www.npmjs.com/package/lightnode-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-7064e9.svg)](LICENSE)

**The community SDK for LightChain AI.** Encrypted on-chain inference, network
analytics, multi-turn chat, an Ethereum bridge wrapper, an LCAI Governor
client, an on-chain model registry reader, worker preflight + watch, and a
bundled `lightnode` CLI. Non-custodial. Pure JS (works in Node 18+, browsers,
StackBlitz, Cloudflare Workers, Bun). Single peer dep: `viem`.

```bash
npm install lightnode-sdk viem
```

LightChain's own docs list official SDKs as "soon"; this fills the gap. Not
affiliated with LightChain.

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
PRIVATE_KEY=0x... npx lightnode wallet address
PRIVATE_KEY=0x... npx lightnode wallet balance --net testnet
                  npx lightnode wallet new           # generates a fresh key
PRIVATE_KEY=0x... npx lightnode worker preflight --net testnet
```

### Scaffolders (write files into your project)

```bash
npx lightnode add inference                    # encrypted inference route or script
npx lightnode add chat                         # chat UI with conversation history
npx lightnode add agent                        # scheduled inference (Vercel Cron / setInterval)
npx lightnode add analytics-dashboard          # read-only network + worker analytics page
npx lightnode add nft-mint-with-inference      # AI-generated NFT metadata with on-chain provenance
```

All `add` commands accept `--template auto|nextjs-api|hono|node`,
`--net testnet|mainnet`, and `--force`.

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
