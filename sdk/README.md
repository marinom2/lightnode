# lightnode-sdk

TypeScript client for **LightChain AI**: read workers, jobs, models, on-chain
registration and per-model analytics, **and run encrypted inference end to end**
(prepare session, submit prompt, decrypt the streamed response). The SDK is
non-custodial - it never holds your private key; on-chain calls are signed by
your wallet via viem. Single peer dep: `viem`.

> Independent, community-built. Not an official LightChain package.
> Live-verified end-to-end on both **mainnet** (chain 9200) and **testnet** (chain 8200)
> with real LCAI - example transactions in the "Submitting inference" section below.

## Install

```bash
npm install lightnode-sdk viem
```

## Usage

```ts
import { LightNode } from "lightnode-sdk";

const ln = new LightNode("mainnet"); // or "testnet"

// One worker
const worker = await ln.getWorker("0x6781...6e0f");
const jobs = await ln.getWorkerJobs("0x6781...6e0f", 20);
const earnings = await ln.getEarningsLcai("0x6781...6e0f"); // whole LCAI

// On-chain truth (independent of the indexer, which can lag a re-register)
const registered = await ln.isRegistered("0x6781...6e0f"); // true | false | null

// Network-wide
const stats = await ln.getNetworkStats();      // { total, active, jobsCompleted, totalEarnedLcai, models }
const models = await ln.getModels();           // [{ name, fee, max_output_tokens, ... }]
const perModel = await ln.getModelStats();     // completion rate, p50/p95 latency, incomplete, earnings
const perWorker = await ln.getWorkerStats();   // per-worker reliability, busiest first
const rollup = await ln.getNetworkAnalytics(); // overall completion / jobs / incomplete / earnings

// Inference cost
const fee = await ln.estimateFee("llama3-8b"); // whole LCAI per job (on-chain calculateJobFee)
const id = ln.modelId("llama3-8b");            // keccak256 model id

// CSV export (same exporters the LightNode dashboard uses)
import { workerJobsCsv, modelStatsCsv, workerStatsCsv } from "lightnode-sdk";
const csv = workerJobsCsv(await ln.getWorkerJobs("0x6781...6e0f", 100));
```

## API

| Method | Returns |
| --- | --- |
| `getWorker(address)` | `Worker \| null` |
| `getWorkerJobs(address, first?)` | `Job[]` |
| `getEarningsLcai(address)` | `number` |
| `isRegistered(address)` | `boolean \| null` (read from chain events) |
| `getModels()` | `ModelInfo[]` |
| `getWorkers(first?)` | `Worker[]` |
| `getNetworkStats()` | `NetworkStats` |
| `getModelStats(sample?)` | `ModelStat[]` |
| `getWorkerStats(sample?, limit?)` | `WorkerStat[]` (reliability) |
| `getNetworkAnalytics(sample?)` | `NetworkAnalytics` |
| `estimateFee(modelTag)` | `number` (LCAI per job) |
| `modelId(tag)` | `0x${string}` |

Also exported: `NETWORKS`, `WORKER_REGISTRY`, `REGISTRY_TOPICS`, `aggregateModelStats`,
`aggregateWorkerStats`, `networkAnalytics`, `modelStatsCsv`, `workerStatsCsv`,
`workerJobsCsv`, `JOB_REGISTRY_CONSUMER_ABI`, `consumerGatewayUrl`, `fromWei`, and all
the types.

## CLI

```bash
npx lightnode network --net testnet       # network summary
npx lightnode models                      # registered models + fees
npx lightnode worker 0x6781…6e0f          # one worker (on-chain + recent jobs)
npx lightnode jobs 0x6781…6e0f --csv      # one worker's job history (table or CSV)
npx lightnode registered 0x6781…6e0f      # true | false | null
npx lightnode fee llama3-8b               # on-chain job fee
npx lightnode analytics --csv             # per-model performance (CSV)
npx lightnode reliability --csv           # per-worker reliability (CSV)
```

## Submitting inference

`v0.3+` ships the encrypted inference-submit flow end to end. Wire-compatible with
the reference client [`lcai-chat-v2`](https://github.com/lightchain-protocol/lcai-chat-v2)
(same ECDH-P256 + AES-256-GCM, same gateway endpoints, same `JobRegistry` calls).
**Live-verified** with real LCAI on both networks before this release:

| Network | Tx | Decrypted model output (excerpt) |
| --- | --- | --- |
| testnet (8200) | createSession `0x77686f3f…ef2bc587` · submitJob `0xba9d48c4…293b2bd96` | "Did you know that the deepest part of the ocean, the Mariana Trench, is so deep that if you were to drop Mount Everest into it, its peak would still be more than 1 mile underwater?!" |
| mainnet (9200) | createSession `0xf091957f…57d4a6ca` · submitJob `0x6ff44a4a…79846bb89` | "Did you know there is a type of jellyfish called the 'Upside-Down Jellyfish' that actually swims on its back, using its tentacles to catch prey and defend itself from predators?" |

The pieces that talk to the chain (`createSession` / `submitJob`) are signed by
**your** wallet via viem; the SDK only prepares the data, does the crypto, and
talks to the consumer gateway.

### Auth (your responsibility)

The gateway requires a bearer JWT obtained via the consumer-api's SIWE sign-in.
The SDK does **not** bundle SIWE - hand the SDK either a fixed token or a
`() => Promise<string>` thunk that refreshes it on demand.

### End-to-end (sketch)

```ts
import {
  LightNode,
  prepareSession,
  submitPrompt,
  decryptResponse,
  JOB_REGISTRY_CONSUMER_ABI,
} from "lightnode-sdk";
import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ln = new LightNode("testnet");
const gateway = ln.gateway({ bearer: () => mySiweJwt() });

// 1) Prepare the session: the gateway picks a worker, we wrap a fresh session
//    key for the worker (and the disputer, if returned) and get the dispatcher
//    signature authorising createSession.
const { sessionKey, createSessionArgs } = await prepareSession(gateway, "llama3-8b");

// 2) Call createSession ON-CHAIN with the prepared args. You sign with your
//    wallet; the SDK ships the ABI but never custodies the key.
const wallet = createWalletClient({ account: privateKeyToAccount("0x..."), transport: http(ln.network.rpc) });
const abi = parseAbi(JOB_REGISTRY_CONSUMER_ABI);
const sessionTx = await wallet.writeContract({
  address: ln.network.jobRegistry as `0x${string}`,
  abi,
  functionName: "createSession",
  args: [
    createSessionArgs.modelId,
    createSessionArgs.worker,
    createSessionArgs.encWorkerKey,
    createSessionArgs.encDisputerKey,
    createSessionArgs.dispatcherSignature,
    createSessionArgs.expiry,
  ],
});
// Wait for the receipt and pull the sessionId out of the SessionCreated event.

// 3) Encrypt + upload your prompt. Returns the EIP-4844 blob hash.
const blobHash = await submitPrompt(gateway, sessionKey, "write a haiku about LCAI");

// 4) Submit the job on-chain, paying the fee:
const feeLcai = await ln.estimateFee("llama3-8b");
await wallet.writeContract({
  address: ln.network.jobRegistry as `0x${string}`,
  abi,
  functionName: "submitJob",
  args: [sessionId, blobHash],
  value: BigInt(Math.round(feeLcai * 1e18)),
});

// 5) Watch JobCompleted (or read the response blob via the relay), then decrypt:
const answer = await decryptResponse(sessionKey, responseCiphertextFromRelay);
```

### What's exported (v0.3)

- `prepareSession(gateway, modelTag)` - select + wrap + prepare (steps 1+2).
- `submitPrompt(gateway, sessionKey, prompt)` - encrypt + upload (step 3).
- `decryptResponse(sessionKey, ciphertext)` - decrypt the worker's reply (step 5).
- `GatewayClient` + `consumerGatewayUrl(net)` - typed HTTP client.
- `crypto.*` - the wire-compatible primitives (`encrypt`, `decrypt`,
  `encryptSessionKey`, `decryptSessionKey`, `generateEcdhKeyPair`,
  `generateSessionKey`, hex/base64/utf8 helpers).
- `JOB_REGISTRY_CONSUMER_ABI` + `estimateJobFee` + `modelId` - on-chain primitives.

A managed REST alternative (API-key) also exists at `https://chat2.lightchain.ai/api/v1` for builders who'd rather skip running their own gateway/SIWE auth.

## Why `isRegistered` reads the chain

The public indexer can report a registered worker as `deregistered` after a
deregister -> re-register cycle. `isRegistered` instead reads the WorkerRegistry's
join/exit events directly and returns the latest, so it is correct for any worker.

## Networks

| | mainnet | testnet |
| --- | --- | --- |
| chainId | 9200 | 8200 |
| min stake | 50,000 LCAI | 5,000 LCAI |
| WorkerRegistry | `0x…1002` (genesis predeploy) | same |

## License

MIT
