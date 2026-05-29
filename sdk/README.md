# lightnode-sdk

Read-only TypeScript client for **LightChain AI**: workers, jobs, models, on-chain
registration, and per-model network analytics. Pure reads from the public indexer and
the chain. No keys, no writes, no native dependencies beyond `viem`.

> Independent, community-built. Not an official LightChain package.

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
`aggregateWorkerStats`, `networkAnalytics`, `JOB_REGISTRY_CONSUMER_ABI`,
`consumerGatewayUrl`, `fromWei`, and all the types.

## CLI

```bash
npx lightnode network --net testnet     # network summary
npx lightnode models                    # registered models + fees
npx lightnode worker 0x6781…6e0f        # one worker (on-chain + recent jobs)
npx lightnode registered 0x6781…6e0f    # true | false | null
npx lightnode fee llama3-8b             # on-chain job fee
npx lightnode analytics --csv           # per-model performance (CSV)
npx lightnode reliability               # per-worker reliability
```

## Submitting inference (advanced)

`estimateFee` + `modelId` + the exported `JOB_REGISTRY_CONSUMER_ABI` give you the
on-chain primitives. The full submit is a multi-step, encrypted flow and is **not
bundled** here (it's a large, currently-undocumented protocol surface — shipping it
half-tested would be worse than pointing you at the verified reference):

1. `createSession(modelId, worker, encWorkerKey, encDisputerKey, dispatcherSig, expiry)` on the JobRegistry.
2. ECDH-P256 + AES-256-GCM encrypt the prompt with a session key; upload it as a blob to the consumer gateway (`consumerGatewayUrl(net)`); get the EIP-4844 `blobHash`.
3. `submitJob(sessionId, blobHash)` paying `estimateFee(model)` as native value.
4. Read the result from the relay stream, or watch the `JobCompleted` event / the job's `responseBlobHash`.

Reference implementation: [lightchain-protocol/lcai-chat-v2](https://github.com/lightchain-protocol/lcai-chat-v2) (`lib/protocol/*`). A managed REST alternative (API-key) also exists at `https://chat2.lightchain.ai/api/v1`.

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
