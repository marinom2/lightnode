# Worker binary: register and deregister gas issues

Analysis of two defects in the LightChain worker binary's on-chain transaction
handling, with the on-chain evidence and the workarounds I implemented in the
operator SDK I built. All observations are from testnet (chain 8200). Every
transaction referenced below is a real, mined transaction from actual worker
installs, not a staged or simulated reproduction. In particular, I registered
gemma4:e2b on-chain through the app (tx
`0x55a8e34518fae9852e4d3599b4f78ef2cfbaa044c252912d72f6d0dc5ff1142f`) and later
deregistered the worker (tx
`0xc3b1b217212b7a4836501860a08c1b3c43a7184446d19de65c97829094d81541`), both real and
both successful once the transactions were sent with estimated gas. That end-to-end
cycle is the proof that the contract and the model are fine, and that the binary's
fixed-gas path is the only thing that fails.

## Summary

1. **Register fails at AddSupportedModel for gemma4:e2b, succeeds for llama3-8b.**
   The contract treats the two models identically. The failure is in the binary's
   register sequence, not the contract or the model. The AddSupportedModel step
   fails before it broadcasts a transaction, consistent with the call being
   attempted before `registerWorker` is confirmed (the contract returns
   `WorkerNotRegistered` to a caller that is not yet a registered worker).

2. **The rollback `deregisterWorker` is under-gassed and reverts out of gas.**
   The binary sends it with a fixed gas limit of 87,534, but the call needs about
   129,000. It runs out of gas on every attempt, so a failed register cannot
   unwind. The worker is left registered but not serving, the binary retries, and
   that register then failed-rollback loop is the join/exit churn.

3. **No operator recovery for stuck acknowledged jobs (a tooling gap, not a contract
   bug).** A job a worker acknowledged but never completed stays `Acknowledged` and
   blocks deregister, locking the stake, and neither the daemon nor the toolkit
   expose any way to clear it. `claimTimeout` is permissionless, so an operator can
   self-recover, but nothing official surfaces it.

The first two defects do not reproduce from a direct contract call: a manual call
auto-estimates gas and runs against a settled state, so it succeeds. Both only
appear through the binary's register flow.

## Environment

| Item | Value |
|---|---|
| Network | LightChain testnet, chain 8200 |
| RPC | https://rpc.testnet.lightchain.ai |
| WorkerRegistry | `0x0000000000000000000000000000000000001002` |
| AIConfig | `0xeCF4Ca5Ba6D97ae586993e170764a1E92231b67e` |
| Worker under test | `0x6781821D4b4842f36a874428f533a3490C086e0f` |
| gemma4:e2b modelId | `0x264fdec586bc9c5f17becd6ead7e43cb69aa68a9dd6dea3dbbeca8c8717325d1` |
| llama3-8b modelId | `0xf4a414fa51803433e9197f32cda96d5cb2ac8269c481eb0262fe2dd11f428848` |

---

## Bug A: AddSupportedModel fails in the register sequence for gemma4:e2b

### Symptom

Installing a worker with `SUPPORTED_MODELS=gemma4:e2b` fails. The binary logs:

```
worker registered on-chain
AddSupportedModel failed, rolling back registration
rollback deregistration also failed
registration failed: add supported model at index 0: AddSupportedModel transaction: execution reverted
```

The identical flow with `SUPPORTED_MODELS=llama3-8b` succeeds.

### The contract treats both models identically

There is no gemma-specific contract condition. Both models carry the same fee and
enabled state, and addSupportedModel consumes the same gas for each in real mined
transactions:

| Property | gemma4:e2b | llama3-8b |
|---|---|---|
| `isModelEnabled` | true | true |
| `getModelFee` | 0.02 LCAI (2e16) | 0.02 LCAI (2e16) |
| addSupportedModel gas used (mined tx) | 171,903 | 171,903 |

The gemma figure is from my real successful add at nonce 73 (below); the llama
figure is from the binary's own successful add at nonce 69. Same operation, same
cost. addSupportedModel requires only that the caller is already a registered
worker (the contract returns `WorkerNotRegistered`, selector `0xcb9a70eb`, otherwise),
and that requirement is identical for both models.

### The failure happens before a transaction is broadcast

In the failing register flow the worker's on-chain nonces are contiguous:

| Nonce | Call | Gas limit | Gas used | Result | Tx |
|---|---|---|---|---|---|
| 71 | registerWorker | 222,407 | 216,632 | ok | `0x945ee3e72fdaf1792091d68346ae4027ed7528eb5989f4e7f0a73bcfa06d47a5` |
| 72 | deregisterWorker (rollback) | 87,534 | 86,608 | FAILED | `0x9f82e6b0ae5be6d3be8d8a2f947c3b842f69592ce8fa571cfec721d7b20a88fe` |
| 73 | addSupportedModel gemma4:e2b | 261,652 | 171,903 | ok | `0x55a8e34518fae9852e4d3599b4f78ef2cfbaa044c252912d72f6d0dc5ff1142f` |

There is no AddSupportedModel transaction between nonce 71 and 72. The binary's
gemma AddSupportedModel never produced a mined transaction, so its "execution
reverted, no reason string" is a gas-estimation or call-simulation revert, not a
mined out-of-gas. The transaction at nonce 73 is my own gas-correct add, after the
register flow had already failed (see workarounds). The binary's llama3-8b
AddSupportedModel, by contrast, mines normally, for example nonce 69:
`0x8eee1d15d918588fdd624818a092e94625bd92334741da44335364d6eca6eab5` (limit 174,435,
used 171,903).

### Root cause

Given the `WorkerNotRegistered` revert, the most likely cause is that the binary
attempts AddSupportedModel before `registerWorker` is confirmed on the node it
queries, so the call sees a not-yet-registered worker and reverts. The contract is
correct; the binary's sequencing is the problem. We cannot observe the binary's
internal timing from outside, but the contract-level facts above hold.

### Why a manual test does not reproduce it

A standalone `addSupportedModel(gemma4:e2b)` against an already-registered worker
succeeds, with the same gas as llama (171,903 used), for example the nonce 73 tx
above. So the call is fine in isolation; the failure only appears inside the binary's
register sequence. To reproduce, register a fresh worker through the binary with
`SUPPORTED_MODELS=gemma4:e2b` and watch AddSupportedModel fail at estimation, while
the identical flow with llama3-8b succeeds.

### Suggested fix

Add supported models as separate transactions after `registerWorker` is confirmed,
each with its own gas estimate, rather than inside the register flow. A standalone
addSupportedModel on a registered worker succeeds for gemma4:e2b with the same gas
as llama3-8b, so a confirmed, post-registration add removes the failure.

---

## Bug B: the rollback deregisterWorker is under-gassed

### Evidence

The binary sends its rollback `deregisterWorker` with a fixed gas limit of 87,534.
The call needs about 129,000, so it runs out of gas and reverts. This worker shows
nine identical failures, all limit 87,534, gasUsed 86,608, status 0:

| Tx | Limit | Used | Status |
|---|---|---|---|
| `0x9f82e6b0ae5be6d3be8d8a2f947c3b842f69592ce8fa571cfec721d7b20a88fe` | 87,534 | 86,608 | failed |
| `0x0b11c87382186e36b25fd8cd6c50a623e9ea5f7c976224591e296719b803c42e` | 87,534 | 86,608 | failed |
| `0x3f851af9a25db8c880f7e1426cfec9dc43b3e76852640cc28edd3169cb302d96` | 87,534 | 86,608 | failed |

(9 occurrences total on this worker.) The same call sent with an adequate limit
succeeds at about 129,000 gas. This is the real deregister I performed through the
app after the SDK fix, tx
`0xc3b1b217212b7a4836501860a08c1b3c43a7184446d19de65c97829094d81541`
(limit 249,583, used 129,192).

### Impact

When register decides to roll back, the rollback itself cannot complete. The worker
is left registered but not serving, the binary retries the whole flow, and that
register then failed-rollback loop is the join/exit churn.

### Suggested fix

Gas-estimate (or raise with margin) the rollback `deregisterWorker`. The same fix
applies to a normal operator deregister, which the binary also under-gasses.

---

## Issue 3: no operator recovery for stuck acknowledged jobs

This is a tooling gap, not a contract bug. The contract behaves correctly; the
problem is that the official daemon and toolkit give an operator no way out of a
common failure state.

### What happens

A worker acknowledges a job, then never completes it: the daemon crashes, the
machine sleeps, or the model misses the deadline. On-chain the job stays in
`Acknowledged` state. A job in that state counts as in-flight, and `deregisterWorker`
reverts with `ActiveJobsExist` while any in-flight job remains. So the worker cannot
exit, and its stake stays locked. Settling does not help (settle only releases
`Completed` jobs), and the daemon never revisits its own abandoned acknowledged jobs.

### Why there is no official way out

The worker daemon only completes jobs it is actively serving; it has no path to give
up and time out a job it already acknowledged. The toolkit has no command for it
either. So a worker with one stuck acknowledged job is stuck registered, with no
official recovery.

The contract does expose the escape: `claimTimeout(jobId)` is permissionless, so the
worker itself can time out its own past-deadline acknowledged job, which finalizes it
as `TimedOut` and unblocks deregister. Nothing in the daemon or toolkit surfaces this.

### Suggested fix

Either expose `claimTimeout` in the toolkit, or have the daemon time out its own
past-deadline acknowledged jobs automatically so a worker can always reach a clean
exit. (Note: finalizing a stuck job as `TimedOut` realizes the completion-timeout
slash on mainnet, so this should be an explicit, informed operator action or a
clearly documented daemon behavior.)

---

## Workarounds implemented in the operator SDK I built

These are the changes I made to operate workers reliably while the binary defects
stand. The SDK is pure RPC over viem, with no worker image dependency, and is
published as `lightnode-sdk`.

Package: https://www.npmjs.com/package/lightnode-sdk
Source: https://github.com/marinom2/lightnode/blob/main/sdk/src/worker-operator.ts

Direct links to the exact fixes (pinned):

- gas-correct write core (`send`, per-call estimation): https://github.com/marinom2/lightnode/blob/4e2aa08cf62f9a95e1fe60a020f0afae35456cf3/sdk/src/worker-operator.ts#L512
- Bug A workaround (`addModel`, model add as its own confirmed tx): https://github.com/marinom2/lightnode/blob/4e2aa08cf62f9a95e1fe60a020f0afae35456cf3/sdk/src/worker-operator.ts#L774
- Bug B workaround (`deregister`, gas-correct exit): https://github.com/marinom2/lightnode/blob/4e2aa08cf62f9a95e1fe60a020f0afae35456cf3/sdk/src/worker-operator.ts#L760
- stuck-job recovery (`stuckJobs` / `claimTimeout` / `clearStuck` / `unstickAndDeregister`): https://github.com/marinom2/lightnode/blob/4e2aa08cf62f9a95e1fe60a020f0afae35456cf3/sdk/src/worker-operator.ts#L636

### 1. Gas-correct writes

The single root fix is to estimate gas per call instead of sending with a fixed
limit. Every write goes through one method that lets viem run `eth_estimateGas` and
send with that value:

```ts
private async send(op, address, abi, functionName, args, value?) {
  const wallet = this.requireWallet(op);
  let tx;
  try {
    // No gas field: viem estimates per call via eth_estimateGas, so writes the
    // binary under-gasses (addSupportedModel, deregisterWorker) get the gas they need.
    tx = await wallet.writeContract({ address, abi, functionName, args, ...(value !== undefined ? { value } : {}) });
  } catch (err) {
    const decoded = decodeWorkerError(extractRevertData(err));
    throw new WorkerOpError(op, `${op} reverted before broadcast: ${decoded.message}`, { decoded });
  }
  const receipt = await this.pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") {
    throw new WorkerOpError(op, `${op} reverted on-chain (tx=${tx})`, { tx });
  }
  return tx;
}
```

`addModel` is the gas-correct equivalent of the AddSupportedModel step the binary
botches. It is a no-op if the model is already served, and otherwise does the add as
its own transaction against an already-registered worker (which is exactly the
sequencing that avoids Bug A):

```ts
async addModel(modelTagOrId: string): Promise<`0x${string}` | null> {
  const id = modelTagOrId.startsWith("0x") && modelTagOrId.length === 66
    ? (modelTagOrId.toLowerCase())
    : (await import("./inference.js")).modelId(modelTagOrId);
  const already = await this.read(this.workerReg, WORKER_REGISTRY_ABI_PARSED, "isEligible", [this.addr, id]);
  if (already) return null;
  return this.send("addModel", this.workerReg, WORKER_REGISTRY_ABI_PARSED, "addSupportedModel", [id]);
}
```

`deregister` is the gas-correct exit. With per-call estimation it lands at about
129,000 gas where the binary's fixed 87,534 reverts.

### 2. Stuck-job recovery

A separate problem the binary and toolkit do not address: a job a worker
acknowledged but never completed sits in `Acknowledged` state forever and blocks
deregister (`ActiveJobsExist`). JobRegistry exposes `claimTimeout` permissionlessly,
so the worker can time out its own past-deadline jobs and unblock the exit. We gate
this so it never times out a job that is still inside its deadline:

```ts
async stuckJobs(candidateJobIds) {
  const cfg = await this.config();
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (const id of candidateJobIds) {
    const j = await this.getJob(id);
    if (j.worker.toLowerCase() !== this.addr) continue;
    if (j.state !== "Acknowledged") continue;
    const deadline = j.deadlineAt || (j.ackAt ? j.ackAt + cfg.completionTimeoutSec : 0);
    out.push({ lookupId: BigInt(id), jobId: j.jobId, state: j.state, ackAt: j.ackAt,
               pastDeadlineSec: deadline ? now - deadline : 0, escrowedFeeWei: j.escrowedFeeWei });
  }
  return out;
}

async clearStuck(candidateJobIds) {
  const stuck = await this.stuckJobs(candidateJobIds);
  const cleared = [], skipped = [];
  for (const s of stuck) {
    if (s.pastDeadlineSec <= 0) { skipped.push(s.lookupId); continue; }   // not eligible yet
    cleared.push({ jobId: s.lookupId, tx: await this.claimTimeout(s.lookupId) });
  }
  return { cleared, skipped };
}

// One-call rescue: clear stuck acked jobs, settle completed ones, withdraw, then exit.
async unstickAndDeregister(candidateJobIds) {
  const cleared = (await this.clearStuck(candidateJobIds)).cleared;
  const released = (await this.releaseAll(candidateJobIds)).released;
  let withdrawTx;
  if ((await this.status()).claimableWei > 0n) withdrawTx = await this.withdraw();
  const deregisterTx = await this.deregister();
  return { cleared, released, withdrawTx, deregisterTx };
}
```

Clearing a stuck job finalizes it as `TimedOut`, which realizes the
completion-timeout slash on mainnet (testnet has slashing disabled), so the SDK
reads the live slash bps from AIConfig and only clears jobs that are past deadline.

### 3. Pre-flight and decoded reverts

`canDeregister(jobIds)` returns `{ ok, blockedBy, reason }` from a read, so a caller
knows whether an exit will revert before spending gas. The WorkerRegistry and
JobRegistry custom errors are not in the 4byte directory, so `decodeWorkerError`
maps the raw revert data to a name and an explanation. The table includes the two
errors central to this analysis:

| Selector | Name | Meaning |
|---|---|---|
| `0xcb9a70eb` | WorkerNotRegistered | caller is not a registered worker (the Bug A register-sequence revert) |
| `0x592f994b` | ActiveJobsExist | deregister blocked by in-flight jobs (clear stuck jobs first) |

---

## Appendix: gas by operation

| Operation | Binary gas limit | Gas used | Result | Example tx |
|---|---|---|---|---|
| registerWorker | 222,407 to 239,778 | 216,632 to 233,732 | ok | `0x945ee3e72fdaf1792091d68346ae4027ed7528eb5989f4e7f0a73bcfa06d47a5` |
| addSupportedModel, llama3-8b | 174,435 | 171,903 | ok | `0x8eee1d15d918588fdd624818a092e94625bd92334741da44335364d6eca6eab5` |
| addSupportedModel, gemma4:e2b (in binary register) | n/a | n/a | fails pre-broadcast | no tx mined |
| addSupportedModel, gemma4:e2b (standalone, correct gas) | 261,652 | 171,903 | ok | `0x55a8e34518fae9852e4d3599b4f78ef2cfbaa044c252912d72f6d0dc5ff1142f` |
| deregisterWorker (binary rollback) | 87,534 | 86,608 | failed, out of gas | `0x9f82e6b0ae5be6d3be8d8a2f947c3b842f69592ce8fa571cfec721d7b20a88fe` |
| deregisterWorker (correct gas, my app after SDK fix) | 249,583 | 129,192 | ok | `0xc3b1b217212b7a4836501860a08c1b3c43a7184446d19de65c97829094d81541` |

addSupportedModel uses the same 171,903 gas for both models, which is why the binary's
limit of 174,435 is enough for llama3-8b. deregisterWorker needs about 129,000, which
is why the binary's fixed 87,534 always reverts.
