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
const stats = await ln.getNetworkStats();   // { total, active, jobsCompleted, totalEarnedLcai, models }
const models = await ln.getModels();         // [{ name, fee, max_output_tokens, ... }]
const perModel = await ln.getModelStats();   // completion rate, p50/p95 latency, disputes, earnings
const workers = await ln.getWorkers(50);     // for a leaderboard
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

Also exported: `NETWORKS`, `WORKER_REGISTRY`, `REGISTRY_TOPICS`, `aggregateModelStats`,
`fromWei`, and all the types.

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
