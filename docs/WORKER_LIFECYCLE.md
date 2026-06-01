# Worker lifecycle

This is the operator's manual: what happens from the moment you install a worker
to the moment you withdraw your last LCAI, and the on-chain mechanics behind the
parts that are easy to get wrong (earnings, payouts, and switching networks or
models on one machine).

If you just want the short version, the [README](../README.md) covers the
essentials. This document is the full picture.

---

## The stages

```
install --> run (keep-online) --> settle earnings --> clear stuck jobs (if any) --> deregister --> withdraw --> free up memory
```

### 1. Install

The one-click install (desktop) or the copied commands (web) do the following, all
generated from [`lib/scriptgen.ts`](../lib/scriptgen.ts):

- ensure Docker and Ollama are installed and running,
- pull the worker image and the model you selected,
- generate a worker key in the browser, fund that address from your wallet, and
  import it into the toolkit keystore,
- register the worker on-chain with your stake,
- pin the model in memory (`OLLAMA_KEEP_ALIVE=-1`) and pre-warm it so the first
  real job does not pay a cold-load penalty,
- install a **keep-online watchdog** (launchd on macOS, cron on Linux, a scheduled
  task on Windows) that restarts Docker and the container if they stop.

The install is **network-aware**: it refuses to start if a worker for a different
network is already running, because a machine runs one worker at a time.

### 2. Run

The worker polls for jobs, runs inference locally, and submits results. Two things
keep it earning rather than getting slashed:

- **Keep-online watchdog.** A worker only earns while its container runs, and the
  container only runs while Docker is up. Since Docker Desktop is an app that stops
  on reboot/logout/sleep, the watchdog brings it back. A **pause marker** is written
  by Stop and Deregister so an intentional stop is not fought.
- **Model kept warm.** A cold model load can exceed the job's inference deadline and
  cause a timeout (the slashable case). The model is pinned resident and re-warmed
  by the watchdog. Use the **Speed test** to confirm your machine comfortably beats
  the deadline.

### 3. Settle earnings

This is the step people misunderstand, so here is exactly what happens on-chain.

A completed job's reward is not paid straight to your wallet. It moves in two hops:

1. **`releaseJob(jobId)`** - after a completed job's release/dispute window passes
   (roughly 16-17 hours), this settles the job and credits your share into an
   **internal balance inside the JobRegistry contract**. It is permissionless after
   the window. This is the number the subgraph reports as your earnings.
2. **`withdraw()`** - moves that internal balance out of the JobRegistry and into
   your **worker wallet** as spendable LCAI.

**Settle earnings** does both: it releases every job that is past its window, then
calls `withdraw()` to claim the accumulated balance into the worker wallet. Settle
runs even when there are no jobs left to release, so a balance that was released
earlier but never claimed still gets pulled in.

On-chain reference (LightChain JobRegistry, reverse-engineered from bytecode; the
implementation is a proxy and not verified on the explorer):

| Purpose | Selector | Notes |
|---|---|---|
| Settle a completed job | `releaseJob(uint256)` | Reverts until the release window passes. |
| Read claimable earnings | `0x78904a35(address)` | Returns the worker's unclaimed in-contract balance. |
| Claim earnings to the wallet | `withdraw()` (`0x3ccfd60b`) | Transfers the balance and emits `WorkerWithdrawal`. |

If a job is still inside its window, Settle reports it as "still in its release
window" and you simply run it again later. The dashboard shows the claimable ETA.

### 4. Clear stuck jobs (only if you have any)

A job your worker **acknowledged but never completed** (Ollama was down, the
machine slept, the deadline passed) stays in the `Acknowledged` state on-chain
forever. Settling does not touch it (settle only releases *completed* jobs), and
it **blocks deregistration**: the protocol refuses to deregister while any job is
still in-flight.

The fix is `claimTimeout`, which the JobRegistry exposes permissionlessly, so the
worker can clear its own stuck jobs. In the desktop app this is the **Clear stuck
jobs** operation; from the SDK it is `clearStuck()` / `unstickAndDeregister()`;
from the CLI it is `lightnode worker clearstuck`.

Important: clearing a stuck job finalizes it as `TimedOut`, which on **mainnet**
realizes the completion-timeout slash (a percentage of stake per job; testnet has
slashing disabled). It is the deliberate price of unblocking an exit that a stuck
job would otherwise block forever, so clear only jobs you accept are lost. Jobs
not yet past their deadline are skipped automatically.

### 5. Deregister

Deregister exits the network and returns your **stake** to the worker wallet. It
is a single on-chain call, `deregisterWorker()`, signed by your worker key. The app
sends it directly: no toolkit clone, no Docker, and no running container required.
You can deregister and recover your stake even if the install never finished or the
machine has no worker container left.

The sequence:

- settle and claim any outstanding earnings first, so nothing is stranded in the
  JobRegistry,
- read-only preflight: simulate `deregisterWorker()` to confirm it would succeed
  before spending any gas,
- send `deregisterWorker()` with a gas limit derived from `cast estimate` times
  1.5,
- re-read `isWorkerRegistered` afterwards and report success only when the chain
  confirms the worker is gone,
- on success, the stake is back in the worker wallet; the app stops any container
  and removes the keep-online watchdog.

The explicit gas limit is the important part. The worker daemon's own deregister
under-sets the gas on this write, so its transaction runs out of gas and reverts
on-chain while some indexers still flip the worker to "deregistered". That is the
"it said deregistered but my stake never came back" case: the stake was never at
risk, the transaction simply never landed. Estimating the gas and adding a margin
makes it land, and the post-send `isWorkerRegistered` check means the app never
reports success on a transaction that actually reverted.

If deregister is blocked, the preflight catches it before any gas is spent. Two
causes: most commonly an acknowledged-but-unfinished (stuck) job is still in-flight,
which you clear first with **Clear stuck jobs** (see stage 4); less commonly a
completed job is still inside its release window, which settles once the window
passes. Your stake stays safe in both cases. The SDK's `unstickAndDeregister` flow
does the clear-then-exit in one call.

On-chain reference (LightChain WorkerRegistry genesis predeploy
`0x0000000000000000000000000000000000001002`):

| Purpose | Selector | Notes |
|---|---|---|
| Exit and return stake | `deregisterWorker()` (`0x200cd650`) | Reverts (`ActiveJobsExist`) while any job is in-flight. Returns the stake to the worker wallet on success. |
| Check registration | `isWorkerRegistered(address)` (`0xe798a7da`) | Read before and after to confirm the exit landed. |

### 6. Withdraw

**Withdraw Funds** sends the worker wallet's spendable LCAI to any address you
choose (it defaults to your connected wallet, but you can enter another). After
deregister, the worker wallet holds `stake + leftover gas + claimed earnings`, and
this moves it out.

Signing happens locally, two ways depending on what the app holds:

- if the app's stored key controls the worker, it signs in the browser with viem
  (precise gas, near-full sweep);
- otherwise it derives the worker key from the on-disk keystore and runs the
  toolkit sweep (which leaves a ~1 LCAI gas buffer).

Either way the raw key never leaves your machine.

### 7. Free up memory

A finished or stopped worker still holds RAM: the model is pinned in Ollama
(several GB) and Docker keeps its VM. **Free up memory** unloads the model, stops
the container, and quits Docker to give the machine its RAM back. It is purely a
cleanup convenience - never required to switch networks or models.

---

## Worked example

A testnet worker completed 12 jobs at 0.016 LCAI each and was funded with a small
gas headroom:

```
Earnings (subgraph total_earned)   0.192 LCAI   (12 x 0.016)
Worker wallet before settle        ~1 LCAI      (gas headroom)
After Settle (release + withdraw)  ~1.192 LCAI  (earnings claimed into the wallet)
After Deregister                   ~5,001.192   (+ 5,000 stake returned)
After Withdraw Funds               ~0           (sent to your wallet, minus buffer)
```

The lifetime earnings figure (0.192) and the spendable wallet balance are different
numbers measuring different things; after settling they reconcile, because settling
is what moves earnings into the wallet.

---

## Switching networks on one machine (testnet to mainnet)

A machine runs one worker at a time (a single container), so the two networks run
sequentially. But each network's keys are isolated on disk - the keystore lives in
its own directory, `~/lightchain-worker/keys-<network>` - so switching networks never
touches or risks the other network's key.

That means a mainnet operator can test on testnet without deregistering or losing
their mainnet worker:

1. **Stop** the mainnet worker (Operations -> Stop). The stake and key stay put.
2. Toggle to **testnet** and **Install**. The install writes the testnet key into
   `keys-testnet` and starts a testnet container; the mainnet keystore in
   `keys-mainnet` is left untouched.
3. When done, toggle back to **mainnet** and **Install** again. The install detects
   the worker is already registered on-chain (its stake is still locked), so it skips
   funding and re-registration and just recreates the container with the saved mainnet
   key. No second stake, no re-funding.

Use **Install** (not Restart) to come back. There is a single worker container, and
installing testnet replaced it, so the mainnet container no longer exists - Restart
only resumes a container that already exists for the network you last installed.
Because the worker is already registered, the one-click install shows an "Already
registered" note instead of the funding step, and the Install button is enabled with
no LCAI required.

The only trade-off in this mode is that the two workers cannot be *online at the same
time* on one box (one container) - while you test testnet, the mainnet worker is
stopped. Running both simultaneously needs separate machines.

If you instead want to permanently move a box from one network to the other:
**Settle earnings**, **Deregister** (returns the stake), **Withdraw Funds**, then
**Install** the other network.

You do not need Free up memory for any of this. If both networks serve the same model
(the default `llama3-8b` does), the model already in memory is reused.

Worker identities are independent per network: your testnet and mainnet workers are
different addresses, keys, stakes, and earnings. The app tracks them per-network and
will refuse to sign one network's action with the other's key. Recovery is preserved
for workers created before per-network isolation: ops also scan the legacy shared
`~/lightchain-worker/keys` directory, so an older worker can still be settled,
withdrawn, and deregistered.

## Serving one or more models

A worker can serve a single model or several at once. The model picker is
multi-select; it sums each model's rough resident footprint and warns when the set
won't fit your machine's memory (every served model has to stay loaded at the same
time, and a cold-load between jobs is what gets a worker slashed). Each model has
its own fee, so a multi-model worker earns from more job types, but it only makes
sense on a machine with enough VRAM (or unified memory) to keep them all warm.

The install advertises the whole set on-chain, pulls each model under its exact
registered name, and pre-warms and pins all of them. The keep-online watchdog warms
every model in the set; a model that is no longer in the set is unloaded to free its
memory.

**Changing the set on a running worker:** use **Models this worker serves** on the
dashboard. It is **add-only**: you can add a model live (it updates the on-chain set
with no re-stake, then restarts the worker with the new set so it re-attests), but
you cannot drop a model while registered - the gateway could still route that model's
jobs to you. To remove a model, **deregister** and reinstall with the smaller set;
that install unloads any model no longer in the set, so you never end up with two
resident by accident.

---

## Slashing, in one paragraph

You get slashed for going silent on a job you accepted (acknowledged then failed to
complete in time), not for explicit, reported failures. The defenses are the
keep-online watchdog (do not strand jobs by going offline) and a warm model (do not
time out on a cold load). The Speed test exists so you can see, before it matters,
whether your machine's worst-case job time fits inside the deadline.
