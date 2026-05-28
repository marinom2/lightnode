# Worker lifecycle

This is the operator's manual: what happens from the moment you install a worker
to the moment you withdraw your last LCAI, and the on-chain mechanics behind the
parts that are easy to get wrong (earnings, payouts, and switching networks or
models on one machine).

If you just want the short version, the README's
[How earnings and withdrawals work](../README.md#how-earnings-and-withdrawals-work)
covers the essentials. This document is the full picture.

---

## The stages

```
install --> run (keep-online) --> settle earnings --> deregister --> withdraw --> free up memory
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

### 4. Deregister

Deregister exits the network and returns your **stake** to the worker wallet. The
app does this safely:

- it settles and claims any outstanding earnings first (so nothing is stranded in
  the JobRegistry),
- it runs the toolkit deregister, which the protocol allows only when there are no
  active jobs and all completed jobs have been released,
- on success it stops the container and removes the keep-online watchdog.

If deregister is blocked, it is almost always because completed jobs are still in
their release window. Your stake is safe; settle again once the windows pass.

### 5. Withdraw

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

### 6. Free up memory

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
3. When done, toggle back to **mainnet** and **Restart** (or Install). The saved
   mainnet key is reused, so the same worker comes back online.

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

## Switching the served model

Pick a different model and re-install. The install unloads the previously pinned
model from Ollama before warming the new one, so you do not end up with two models
resident at once. No Free up memory step is needed.

---

## Slashing, in one paragraph

You get slashed for going silent on a job you accepted (acknowledged then failed to
complete in time), not for explicit, reported failures. The defenses are the
keep-online watchdog (do not strand jobs by going offline) and a warm model (do not
time out on a cold load). The Speed test exists so you can see, before it matters,
whether your machine's worst-case job time fits inside the deadline.
