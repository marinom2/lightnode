import { describe, it, expect } from "vitest";
import {
  generateSetup,
  desktopInstallCommand,
  dockerOpCommand,
  stopWorkerCommand,
  deregisterCommand,
  repairWorkerCommand,
  sweepCommand,
  toolkitOpCommand,
  settleJobsCommand,
  clearStuckJobsCommand,
  benchmarkCommand,
  freeMemoryCommand,
  addModelsCommand,
  uninstallCommand,
  preflightCommand,
} from "@/lib/scriptgen";

describe("Clear stuck jobs (claimTimeout)", () => {
  it("claimTimeouts each acked job on the right network's JobRegistry", () => {
    const cmd = clearStuckJobsCommand("macos", "testnet", [974, 976]);
    expect(cmd).toContain("claimTimeout(uint256)");
    expect(cmd.toLowerCase()).toContain("0x531b3a87c5d785441b9cf55b98169f20fd9056a7"); // testnet JobRegistry
    expect(cmd).toContain("for j in 974 976");
  });
  it("probes eligibility with eth_call before sending (no wasted tx on a not-yet-stuck job)", () => {
    const cmd = clearStuckJobsCommand("macos", "testnet", [1]);
    expect(cmd).toContain('cast call "$JOBREG" "claimTimeout(uint256)"'); // readiness probe
    expect(cmd).toContain('cast send "$JOBREG" "claimTimeout(uint256)"'); // real send
  });
  it("windows variant uses claimTimeout via PowerShell", () => {
    expect(clearStuckJobsCommand("windows", "mainnet", [5]).toLowerCase()).toContain("claimtimeout");
  });
  it("empty list is a no-op message, not a malformed loop", () => {
    expect(clearStuckJobsCommand("macos", "testnet", [])).toContain("no acknowledged jobs to clear");
  });
});

describe("Settle earnings + auto-settling deregister", () => {
  it("settle releases each completed job on the right network's JobRegistry", () => {
    const cmd = settleJobsCommand("macos", "testnet", [101, 202]);
    expect(cmd).toContain("releaseJob(uint256)");
    expect(cmd.toLowerCase()).toContain("0x531b3a87c5d785441b9cf55b98169f20fd9056a7"); // testnet JobRegistry
    expect(cmd).toContain("for j in 101 202");
  });
  it("uses the mainnet JobRegistry on mainnet", () => {
    expect(settleJobsCommand("macos", "mainnet", [1]).toLowerCase()).toContain("0xfb15f90298e4ccd7106e76ffb5e520315cc42b0b");
  });
  it("deregister auto-settles the completed jobs first", () => {
    const d = deregisterCommand("macos", "testnet", [55]);
    expect(d).toContain("settling completed jobs + claiming rewards before deregister");
    expect(d).toContain("releaseJob(uint256)");
    expect(d).toContain("deregister.sh");
  });
  it("deregister stops the container so another network can be installed directly", () => {
    expect(deregisterCommand("macos", "testnet")).toContain("docker stop lightchain-worker");
    expect(deregisterCommand("windows", "testnet")).toContain("docker stop lightchain-worker");
  });
  it("windows settle releases jobs via PowerShell", () => {
    expect(settleJobsCommand("windows", "testnet", [9]).toLowerCase()).toContain("releasejob");
  });
  it("settle also CLAIMS earnings (withdraw) - releasing only credits an internal balance", () => {
    const cmd = settleJobsCommand("macos", "testnet", [9]);
    expect(cmd).toContain("0x78904a35"); // getter for the claimable earnings balance
    expect(cmd).toContain('"withdraw()"'); // pulls that balance into the worker wallet
    expect(cmd).toContain("claimed");
    // even with no jobs to release, the claim still runs
    expect(settleJobsCommand("macos", "testnet", []).toLowerCase()).toContain("withdraw()");
  });
  it("deregister claims earnings before exiting so nothing is stranded", () => {
    expect(deregisterCommand("macos", "testnet", [5])).toContain('"withdraw()"');
  });
  it("probes readiness with an eth_call before sending, and reports a real send failure honestly", () => {
    const cmd = settleJobsCommand("macos", "testnet", [932]);
    // eth_call probe distinguishes a genuine release-window wait...
    expect(cmd).toContain('cast call "$JOBREG" "releaseJob(uint256)" "$j"');
    expect(cmd).toContain("still in its release window");
    // ...from a job that is ready but whose send fails (e.g. no gas / wrong key).
    expect(cmd).toContain("is ready but the release tx failed");
  });
});

describe("Sweep/Deregister source the key from the on-disk keystore", () => {
  it("unix ops decrypt the key from the keystore with the password", () => {
    const sweep = toolkitOpCommand("sweep-rewards.sh 0xabc", "sweep");
    expect(sweep).toContain("cast wallet decrypt-keystore");
    expect(sweep).toContain("WORKER_PASSWORD");
    expect(deregisterCommand("macos", "testnet")).toContain("cast wallet decrypt-keystore");
  });
  it("sweepCommand is OS-aware, sends to the destination, and leaves only a tiny gas buffer (not the toolkit's 1 LCAI default)", () => {
    expect(sweepCommand("macos", "0xDEST")).toContain("sweep-rewards.sh 0xDEST 0.001");
    const win = sweepCommand("windows", "0xDEST");
    expect(win).toContain("sweep-rewards.ps1");
    expect(win).toContain("-GasBuffer 0.001");
    expect(win).toContain("decrypt-keystore");
  });
  it("windows deregister derives the key and gates on success", () => {
    const win = deregisterCommand("windows", "testnet");
    expect(win).toContain("decrypt-keystore");
    expect(win).toContain("$LASTEXITCODE -eq 0");
  });
  it("deregister waits for the Docker engine first so it completes in one click", () => {
    // deregister.sh runs `invoke_worker deregister` as a docker container; without
    // an upfront engine-up wait, the first click would only start Docker.
    const unix = deregisterCommand("macos", "testnet");
    expect(unix).toContain("Docker is not running - starting Docker Desktop");
    expect(unix).toContain("Cannot reach Docker");
    const win = deregisterCommand("windows", "testnet");
    expect(win).toContain("starting Docker Desktop");
    expect(win).toContain("Cannot reach Docker");
  });
  it("prefers the container keystore password over any app-supplied one", () => {
    // The container's WORKER_KEYSTORE_PASSWORD always matches the on-disk
    // keystore; a drifted app password must not be able to break decryption.
    const cmd = deregisterCommand("macos", "testnet");
    expect(cmd).toContain("PW_CT=");
    expect(cmd).toContain('for PW in "$PW_CT" "${WORKER_PASSWORD:-}"');
  });
  it("refuses to sign when the on-disk worker is not the targeted worker", () => {
    // Never sign one network's op with a different worker's key.
    const cmd = settleJobsCommand("macos", "testnet", [1]);
    expect(cmd).toContain("this machine hosts worker $DISK_ADDR");
    expect(cmd).toContain("unset WORKER_PRIVKEY");
  });
});

describe("Min stake is derived LIVE from AIConfig, never hardcoded", () => {
  it("unix install reads getMinWorkerStake from chain and patches the toolkit guard from it", () => {
    const cmd = desktopInstallCommand("macos", "testnet");
    // Reads aiConfig() off the WorkerRegistry, then getMinWorkerStake() live.
    expect(cmd).toContain("'aiConfig()(address)'");
    expect(cmd).toContain("'getMinWorkerStake()(uint256)'");
    // The 07-register guard threshold is rewritten from the LIVE value ($GUARD_LCAI),
    // not a baked number. Patches both literal forms of the toolkit's 50001 guard.
    expect(cmd).toContain('s/50,001/$GUARD_LCAI/g; s/50001/$GUARD_LCAI/g');
    // The funding gate compares against the live-derived $THR_WEI, not a constant.
    expect(cmd).toContain('"$BAL_WEI" "$THR_WEI"');
  });
  it("windows install derives the min stake live and rewrites the guard from it", () => {
    const cmd = desktopInstallCommand("windows", "testnet");
    expect(cmd).toContain('"getMinWorkerStake()(uint256)"');
    expect(cmd).toContain("-replace '50,001', \"$GuardLcai\" -replace '50001', \"$GuardLcai\"");
    expect(cmd).toContain("$thr = $ThrWei");
  });
  it("falls back to the build-time NETWORKS value only if the live read fails", () => {
    // testnet build-time min is 5000; that appears ONLY in the fallback, not as the
    // operative threshold (which comes from chain).
    const cmd = desktopInstallCommand("macos", "testnet");
    expect(cmd).toContain("MIN_FALLBACK_WEI=");
    expect(cmd).toContain("could not read min stake from AIConfig; using fallback");
  });
  it("preflight derives the funding threshold live too (no build-time stake gate)", () => {
    // unix preflight uses cast; the informational funded/not-funded line compares
    // the balance against the live-derived $THR_WEI, not a constant.
    const unix = preflightCommand("macos", "testnet");
    expect(unix).toContain("'getMinWorkerStake()(uint256)'");
    expect(unix).toContain('"$THR_WEI"');
    // windows preflight uses eth_call selectors (aiConfig + getMinWorkerStake) and
    // compares against $ThrWei.
    const win = preflightCommand("windows", "testnet");
    expect(win).toContain("0x85ff4862"); // aiConfig() selector
    expect(win).toContain("0xca22dfd1"); // getMinWorkerStake() selector
    expect(win).toContain("$bal -ge $ThrWei");
  });
});

describe("per-network keystore isolation (test one network without risking another's keys)", () => {
  it("unix install writes the keystore into a per-network dir (keys-<network>)", () => {
    expect(desktopInstallCommand("macos", "testnet")).toContain('export KEYS_DIR="$HOME/lightchain-worker/keys-testnet"');
    expect(desktopInstallCommand("macos", "mainnet")).toContain('export KEYS_DIR="$HOME/lightchain-worker/keys-mainnet"');
  });
  it("windows install sets a per-network KEYS_DIR and patches env.ps1 to keep it", () => {
    const win = desktopInstallCommand("windows", "testnet");
    expect(win).toContain('$env:KEYS_DIR = "$env:USERPROFILE\\lightchain-worker\\keys-testnet"');
    // env.ps1 hardcodes the dir + network; the install rewrites it to "keep if set".
    expect(win).toContain("if (-not $env:KEYS_DIR)");
    expect(win).toContain("if (-not $env:NETWORK)");
    // guarded so a re-run (already-patched env.ps1) doesn't double-wrap
    expect(win).toContain("-SimpleMatch 'if (-not $env:KEYS_DIR)' -Quiet");
  });
  it("windows install backs up/imports into the per-network keystore dir", () => {
    const win = desktopInstallCommand("windows", "mainnet");
    expect(win).toContain('"lightchain-worker\\keys-mainnet\\eth-keystore"');
    expect(win).toContain('"lightchain-worker\\keys-mainnet"');
  });
  it("ops scan per-network dirs AND the legacy shared dir (so a pre-isolation worker stays recoverable)", () => {
    const cmd = deregisterCommand("macos", "mainnet", [1]);
    expect(cmd).toContain("$HOME/lightchain-worker/keys-mainnet");
    // the legacy, non-suffixed dir must still be scanned (last in the list) for recovery
    expect(cmd).toContain('$HOME/lightchain-worker/keys-testnet $HOME/lightchain-worker/keys"');
  });
  it("ops pick the keystore matching the targeted WORKER_ADDR (never another worker's key)", () => {
    const cmd = settleJobsCommand("macos", "testnet", [1]);
    expect(cmd).toContain('WADDR_LC=');
    expect(cmd).toContain('grep -q "$WADDR_LC"');
  });
  it("windows ops scan the same candidate dirs by WORKER_ADDR", () => {
    const win = deregisterCommand("windows", "mainnet");
    expect(win).toContain('lightchain-worker\\keys-mainnet');
    expect(win).toContain('lightchain-worker\\keys-testnet');
    expect(win).toContain("$cand.Name.ToLower().Contains($waddrLc)");
  });
});

describe("registration-aware install (switch back to an already-registered worker without re-funding/re-staking)", () => {
  it("unix install skips 07-register only when registered AND serving the selected model on-chain", () => {
    const unix = desktopInstallCommand("macos", "mainnet");
    // Decision is on-chain isEligible, not the toolkit status string: a worker
    // can be registered but serving NO model (a prior add-model failed), in which
    // case we must NOT skip (and must NOT re-stake).
    expect(unix).toContain("isWorkerRegistered(address)(bool)");
    expect(unix).toContain("isEligible(address,bytes32)(bool)");
    expect(unix).toContain("07-register (skipped - already registered AND serving the selected model");
  });
  it("unix install refuses to re-stake a registered-but-not-serving worker (no second stake)", () => {
    const unix = desktopInstallCommand("macos", "mainnet");
    // registered + not eligible => stop with a clear message instead of staking again
    expect(unix).toContain("Re-running register would stake AGAIN");
    expect(unix).toContain('[ "$REG_OK" = "true" ] && [ "$ELIG_OK" != "true" ]');
  });
  it("unix still runs 07-register for a fresh (unregistered) worker - the guard only fires on a positive match", () => {
    const unix = desktopInstallCommand("macos", "testnet");
    // the phase is still in the list and run by default
    expect(unix).toContain("07-register");
    expect(unix).toContain('FORCE=1 "$RUNBASH" "$p.sh"');
  });
  it("windows install skips 07-register only when registered AND serving the selected model on-chain", () => {
    const win = desktopInstallCommand("windows", "mainnet");
    expect(win).toContain('isWorkerRegistered(address)(bool)');
    expect(win).toContain('isEligible(address,bytes32)(bool)');
    expect(win).toContain("07-register (skipped - already registered AND serving the selected model");
    // and refuses to re-stake a registered-but-not-serving worker
    expect(win).toContain("Re-running register would stake AGAIN");
  });

  it("strips AppImage bundle libs from the shell env so system curl/git don't crash", () => {
    // AppImage exports LD_LIBRARY_PATH at its bundled libs -> system curl loads the
    // bundle's libcurl vs the host libnghttp2 -> undefined-symbol crash -> every
    // RPC/gateway/indexer probe "fails". The unix install + preflight must repair
    // the env (gated on APPDIR so .deb/.dmg are untouched).
    for (const cmd of [desktopInstallCommand("linux", "mainnet"), preflightCommand("linux", "mainnet")]) {
      expect(cmd).toContain('if [ -n "${APPDIR:-}" ]; then');
      expect(cmd).toContain("LD_LIBRARY_PATH");
      expect(cmd).toContain('grep -vF "$APPDIR"');
    }
    // Preflight also names the cause + the .deb fix if curl is still broken.
    const pf = preflightCommand("macos", "mainnet"); // same unix branch
    expect(pf).toContain("! curl --version");
    expect(pf).toContain("sudo apt install ./LightNode_*.deb");
  });

  it("self-heals a keystore the saved passwords can't decrypt by re-importing when the app holds the key", () => {
    // Field case: a worker (unregistered, 55k still in wallet) had a keystore left
    // by an earlier attempt under a password the app no longer has. The app still
    // holds the raw key, so the install must back up the stale keystore + ECDH and
    // re-import under the current password instead of hard-blocking.
    const win = desktopInstallCommand("windows", "mainnet");
    expect(win).toContain("if ($env:WORKER_PRIVKEY)");
    expect(win).toContain("re-importing this worker's key under the current password");
    expect(win).toContain("$skipImport = $false");
    const unix = desktopInstallCommand("macos", "mainnet");
    expect(unix).toContain('if [ -n "${WORKER_PRIVKEY:-}" ]; then');
    expect(unix).toContain("SKIP_IMPORT=0");
    // Still blocks (no self-heal) when the raw key is NOT available.
    expect(win).toContain("keystore-password-mismatch");
    expect(unix).toContain("keystore-password-mismatch");
  });

  it("preflight does not BLOCK on a keystore-password mismatch when the app holds the key", () => {
    const win = preflightCommand("windows", "mainnet");
    expect(win).toContain("elseif ($env:WORKER_PRIVKEY)");
    expect(win).toContain("install will re-import it under the current password");
    const unix = preflightCommand("macos", "mainnet");
    expect(unix).toContain('elif [ -n "${WORKER_PRIVKEY:-}" ]; then');
    expect(unix).toContain("install will re-import it under the current password");
  });

  it("windows passes -Force to 07-register so it never blocks on the 'type register' prompt", () => {
    // 07-register.ps1 uses a -Force SWITCH to skip its Read-Host confirmation (the
    // bash side uses a FORCE env var). Without -Force the desktop install pops a
    // "Type 'register' to confirm" prompt it can't answer, and closing it aborts.
    const win = desktopInstallCommand("windows", "mainnet");
    expect(win).toContain("if ($p -like '*07-register*') { & $p -Force 2>&1");
    // The unix side keeps its FORCE=1 env convention.
    expect(desktopInstallCommand("macos", "mainnet")).toContain('FORCE=1 "$RUNBASH" "$p.sh"');
  });

  it("register skip-decision reads the chain, not the worker binary's status subcommand", () => {
    // The old skip used the worker binary's `status` (status.sh / status.ps1),
    // whose stderr could abort the install AND which only reported "registered"
    // (not whether it serves the selected model) - the false-online bug. The
    // decision is now pure on-chain reads (isWorkerRegistered + isEligible), so
    // neither path shells the binary's status for the skip anymore.
    const unix = desktopInstallCommand("macos", "mainnet");
    const win = desktopInstallCommand("windows", "mainnet");
    expect(unix).not.toContain("status.sh 2>&1 || true");
    expect(win).not.toContain("status.ps1 2>&1 | Out-String");
    expect(unix).toContain("isEligible(address,bytes32)(bool)");
    expect(win).toContain('isEligible(address,bytes32)(bool)');
  });
});

describe("benchmark (capacity/power test vs the job deadline)", () => {
  it("unix runs a real inference and compares worst-case to the deadline", () => {
    const cmd = benchmarkCommand("macos", 120);
    expect(cmd).toContain("/api/generate");
    expect(cmd).toContain("eval_count");
    expect(cmd).toContain("eval_duration");
    expect(cmd).toContain("prompt_eval_duration"); // measures prefill, not just decode
    expect(cmd).toContain("tok/s");
    expect(cmd).toContain("$HOME/.lightnode/model"); // benchmarks the model the worker actually serves
    expect(cmd).toContain('"keep_alive\\":0'); // forces a cold start for an honest worst case
  });
  it("uses the real on-chain deadline budget passed in", () => {
    expect(benchmarkCommand("macos", 90)).toContain("BUDGET=90");
    expect(benchmarkCommand("windows", 90)).toContain("$budget = 90");
  });
  it("defaults to the 120s budget when none is supplied", () => {
    expect(benchmarkCommand("macos")).toContain("BUDGET=120");
  });
  it("windows benchmark uses Invoke-RestMethod and the same verdict logic", () => {
    const win = benchmarkCommand("windows", 120);
    expect(win).toContain("Invoke-RestMethod");
    expect(win).toContain("eval_count");
    expect(win).toContain("tok/s");
  });
});

describe("free up memory (stop worker + unload model + quit Docker)", () => {
  it("unix unloads the model, stops the container and quits Docker on mac", () => {
    const cmd = freeMemoryCommand("macos");
    expect(cmd).toContain("keep_alive"); // unloads the model from Ollama
    expect(cmd).toContain("docker stop lightchain-worker");
    expect(cmd).toContain('quit app "Docker"');
    expect(cmd).toContain("keep-online.paused"); // pause marker so the watchdog won't restart it
  });
  it("linux skips the Docker Desktop quit (no VM to release)", () => {
    const lin = freeMemoryCommand("linux");
    expect(lin).toContain("docker stop lightchain-worker");
    expect(lin).not.toContain('quit app "Docker"');
  });
  it("windows stops the container and kills the Docker Desktop process", () => {
    const win = freeMemoryCommand("windows");
    expect(win).toContain("docker stop lightchain-worker");
    expect(win).toContain("Docker Desktop");
    expect(win).toContain("keep_alive");
    expect(win).toContain("keep-online.paused");
  });
});

describe("pause marker (intentional stop must not be auto-restarted)", () => {
  it("the watchdog skips work while the pause marker exists", () => {
    expect(desktopInstallCommand("macos", "testnet")).toContain("keep-online.paused");
  });
  it("Stop writes the pause marker before stopping (works even if Docker is down)", () => {
    const stop = stopWorkerCommand("macos");
    expect(stop).toContain('touch "$HOME/.lightnode/keep-online.paused"');
    expect(stop.indexOf("keep-online.paused")).toBeLessThan(stop.indexOf("docker stop"));
  });
  it("Restart and Install clear the pause marker (re-arm)", () => {
    expect(repairWorkerCommand("macos")).toContain('rm -f "$HOME/.lightnode/keep-online.paused"');
    expect(desktopInstallCommand("macos", "testnet")).toContain('rm -f "$HOME/.lightnode/keep-online.paused"');
  });
  it("Restart pre-warms the model so the first job doesn't cold-load (slash risk)", () => {
    expect(repairWorkerCommand("macos")).toContain('"keep_alive\\":-1');
    expect(repairWorkerCommand("macos")).toContain("pre-warming");
    expect(repairWorkerCommand("windows")).toContain("keep_alive");
  });
  it("prevents the machine from sleeping while the worker runs (caffeinate), and frees it on stop", () => {
    const install = desktopInstallCommand("macos", "mainnet");
    expect(install).toContain("caffeinate");
    expect(install).toContain("ai.lightchain.worker-awake");
    // Restart re-arms it; Stop releases it so the machine can sleep again.
    expect(repairWorkerCommand("macos")).toContain("worker-awake.plist");
    expect(stopWorkerCommand("macos")).toContain("worker-awake.plist");
  });
  it("Deregister pauses and removes the watchdog schedule", () => {
    const d = deregisterCommand("macos", "testnet");
    expect(d).toContain("deregister.sh");
    expect(d).toContain("keep-online.paused");
    expect(d).toContain("launchctl unload");
    expect(d).toContain("crontab -");
  });
  it("Stop/Deregister on windows use USERPROFILE marker + schtasks delete", () => {
    expect(stopWorkerCommand("windows")).toContain("keep-online.paused");
    expect(deregisterCommand("windows", "testnet")).toContain("schtasks /Delete");
  });
});

describe("dockerOpCommand", () => {
  const wrapped = dockerOpCommand("docker ps -a --filter name=lightchain-worker", "macos");
  it("keeps the original command", () => {
    expect(wrapped).toContain("docker ps -a --filter name=lightchain-worker");
  });
  it("hardens PATH and probes a reachable docker socket before running", () => {
    expect(wrapped).toContain("/usr/local/bin");
    expect(wrapped).toContain(".docker/run/docker.sock");
    expect(wrapped).toContain("DOCKER_HOST=");
  });
  it("auto-starts Docker Desktop when it is not running", () => {
    expect(wrapped).toContain("open -a Docker");
    expect(wrapped).toContain("Cannot reach Docker");
  });
  it("uses PowerShell start on windows", () => {
    const win = dockerOpCommand("docker stop lightchain-worker", "windows");
    expect(win).toContain("Start-Process");
    expect(win).toContain("docker stop lightchain-worker");
  });
});

describe("keep model warm (avoid cold-load inference timeouts)", () => {
  const unix = desktopInstallCommand("macos", "testnet");
  it("sets the Ollama keep-alive default to never evict", () => {
    expect(unix).toContain("OLLAMA_KEEP_ALIVE");
  });
  it("records the served model and pre-warms it pinned", () => {
    expect(unix).toContain('.lightnode/model');
    expect(unix).toContain("keep_alive");
    expect(unix).toContain("pre-warming");
  });
  it("the watchdog re-warms every served model it reads from the model file", () => {
    expect(unix).toContain('done < "$HOME/.lightnode/model"');
  });
  it("unloads any previously-served model that is no longer in the new set", () => {
    expect(unix).toContain('for OM in $(cat "$HOME/.lightnode/model"');
    expect(unix).toContain('"keep_alive\\":0'); // keep_alive:0 unloads it
    expect(unix).toContain("no longer served");
    const win = desktopInstallCommand("windows", "mainnet", ["llama3-70b"]);
    expect(win).toContain("$newSet");
    expect(win).toContain("no longer served");
  });
});

describe("multi-model worker (serve more than one model on one machine)", () => {
  it("joins the picked models into SUPPORTED_MODELS and stores them one per line", () => {
    const unix = desktopInstallCommand("macos", "mainnet", ["llama3-8b", "llama3-70b"]);
    expect(unix).toContain("SUPPORTED_MODELS=llama3-8b,llama3-70b");
    expect(unix).toContain(`printf '%s\\n' "llama3-8b" "llama3-70b" > "$HOME/.lightnode/model"`);
  });
  it("ensures each model is pulled + aliased to its exact on-chain name", () => {
    const unix = desktopInstallCommand("macos", "mainnet", ["llama3-8b", "llama3-70b"]);
    expect(unix).toContain('for M in "llama3-8b" "llama3-70b"');
    expect(unix).toContain("ollama pull");
    expect(unix).toContain("ollama cp"); // alias the pulled tag to the on-chain name
  });
  it("pre-warms each served model (not just one)", () => {
    const unix = desktopInstallCommand("macos", "mainnet", ["llama3-8b", "llama3-70b"]);
    expect(unix).toContain("pre-warming llama3-8b, llama3-70b");
  });
  it("windows joins SUPPORTED_MODELS and uses a PS array for the set", () => {
    const win = desktopInstallCommand("windows", "mainnet", ["llama3-8b", "llama3-70b"]);
    expect(win).toContain(`$env:SUPPORTED_MODELS = "llama3-8b,llama3-70b"`);
    expect(win).toContain(`$newSet = @('llama3-8b','llama3-70b')`);
  });
  it("addModelsCommand calls addSupportedModel directly with gas=estimate x1.5, NOT the daemon's add-models (which OutOfGas-reverts)", () => {
    const unix = addModelsCommand("macos", "mainnet", ["llama3-70b"]);
    // direct contract call, not the buggy daemon subcommand
    expect(unix).toContain('"addSupportedModel(bytes32)"');
    expect(unix).not.toContain("invoke_worker add-models");
    // gas derived from estimate (the daemon under-set it -> OutOfGas)
    expect(unix).toContain("cast estimate");
    expect(unix).toContain("--gas-limit");
    // modelId is keccak of the tag; skips a model already eligible on-chain
    expect(unix).toContain('cast keccak "$M"');
    expect(unix).toContain('"isEligible(address,bytes32)(bool)"');
    expect(unix).toContain("cast wallet decrypt-keystore"); // still unlocks the keystore
    const win = addModelsCommand("windows", "testnet", ["gemma4:e2b"]);
    expect(win).toContain('"addSupportedModel(bytes32)"');
    expect(win).not.toContain('Invoke-Worker -Subcommand "add-models"');
    expect(win).toContain("--gas-limit");
  });
});

describe("keep-online watchdog (auto-installed by the desktop setup)", () => {
  const unix = desktopInstallCommand("macos", "testnet");
  const win = desktopInstallCommand("windows", "testnet");
  it("unix install writes the watchdog and schedules it (launchd + cron)", () => {
    expect(unix).toContain("keep-online.sh");
    expect(unix).toContain("LaunchAgents");
    expect(unix).toContain("StartInterval");
    expect(unix).toContain("crontab -");
  });
  it("the watchdog starts Docker and the worker", () => {
    expect(unix).toContain("open -a Docker");
    expect(unix).toContain("docker start lightchain-worker");
  });
  it("watchdog setup is best-effort (never aborts the install)", () => {
    // wrapped in set +e / set -e around the workdir
    expect(unix).toContain("set +e");
    expect(unix).toContain("set -e");
  });
  it("windows install registers a Scheduled Task running every 10 min", () => {
    expect(win).toContain("schtasks /Create");
    expect(win).toContain("/SC MINUTE /MO 10");
    expect(win).toContain("docker start lightchain-worker");
  });
});

describe("generateSetup (default model)", () => {
  const b = generateSetup("linux", "mainnet");
  it("targets llama3-8b by default", () => {
    expect(b.model).toBe("llama3-8b");
    expect(b.setup).toContain("export SUPPORTED_MODELS=llama3-8b");
  });
  it("one-liner runs all 9 phases and prompts for the password", () => {
    expect(b.oneLiner).toContain("00-generate-key");
    expect(b.oneLiner).toContain("08-run-worker");
    expect(b.oneLiner).toContain("worker keystore password");
  });
  it("verify checks the model name", () => {
    expect(b.verify).toContain("llama3-8b");
  });
  it("ships day-2 ops", () => {
    expect(b.ops.length).toBeGreaterThan(0);
  });
});

describe("generateSetup (model-aware)", () => {
  it("threads a non-default model into SUPPORTED_MODELS and the pull step", () => {
    const b = generateSetup("linux", "mainnet", "qwen3-coder:30b");
    expect(b.setup).toContain("export SUPPORTED_MODELS=qwen3-coder:30b");
    expect(b.setup).toContain("ollama pull qwen3-coder:30b");
    expect(b.verify).toContain("qwen3-coder:30b");
  });
});

describe("generateSetup (windows)", () => {
  const b = generateSetup("windows", "testnet");
  it("uses PowerShell + testnet", () => {
    expect(b.network).toBe("testnet");
    expect(b.setup).toContain('$env:SUPPORTED_MODELS = "llama3-8b"');
    expect(b.oneLiner).toContain("Read-Host");
  });
});

describe("desktopInstallCommand (smart install)", () => {
  const unix = desktopInstallCommand("macos", "testnet");
  const win = desktopInstallCommand("windows", "testnet");

  it("is idempotent: never uses `cp -n` (exits 1 on macOS re-runs), guards instead", () => {
    expect(unix).not.toContain("cp -n");
    expect(unix).toContain("[ -f secrets.env ] || cp secrets.example.sh secrets.env");
  });
  it("only installs missing tools + auto-starts Docker (no manual 're-run')", () => {
    expect(unix).toContain("✓ Docker already installed");
    expect(unix).toContain("starting the Docker engine");
    expect(unix).toContain("open -a Docker"); // macOS
    expect(unix).toContain("systemctl"); // linux
  });
  it("short-circuits only when the running container is ALSO live on-chain; stops the other network's worker to switch", () => {
    // "running container" alone is not enough - it must be registered + serving on
    // chain, else a prior failed setup would be reported as a false "online".
    expect(unix).toContain("running on testnet and live on-chain - nothing to reinstall");
    expect(unix).toContain("it is not live on-chain");
    // a different-network container is stopped (not an error), so the user isn't stuck
    expect(unix).toContain("a worker for the other network");
    expect(unix).toContain("docker stop lightchain-worker");
  });
  it("funds the worker directly: no funder key, no generate/fund phases", () => {
    expect(unix).not.toContain("$FUNDER_PRIVKEY"); // never reads a funder key
    expect(unix).toContain('cast wallet address --private-key "$WORKER_PRIVKEY"');
    expect(unix).not.toContain("00-generate-key");
    expect(unix).not.toContain("06-fund-worker");
    expect(unix).toContain("07-register");
  });
  it("replaces the toolkit's hardcoded stake amount with 'the network minimum' (no baked-in number; the real stake is read from AIConfig) on every OS", () => {
    for (const os of ["macos", "linux"] as const) {
      expect(desktopInstallCommand(os, "testnet")).toContain("STAKE the network minimum");
      expect(desktopInstallCommand(os, "mainnet")).toContain("STAKE the network minimum");
    }
    expect(desktopInstallCommand("windows", "testnet")).toContain("STAKE the network minimum");
    // and we no longer bake a per-network amount into the replacement
    expect(desktopInstallCommand("macos", "testnet")).not.toContain("STAKE 5,000 LCAI");
  });
  it("emits PowerShell (not bash) for Windows, auto-starting Docker Desktop", () => {
    expect(win).toContain("$ErrorActionPreference");
    expect(win).toContain("Docker Desktop.exe");
    expect(win).toContain("winget install --id Docker.DockerDesktop");
    expect(win).not.toContain("set -e");
  });
});

describe("uninstall (remove the worker, free the disk/RAM, keep the keystore)", () => {
  for (const os of ["macos", "linux"] as const) {
    const out = uninstallCommand(os, "testnet");
    it(`${os}: removes the big disk/RAM users (container, image, models)`, () => {
      expect(out).toContain("docker rm -f lightchain-worker");
      expect(out).toContain("docker rmi");
      expect(out).toContain("ollama rm");
      expect(out).toContain("rm -rf \"$HOME/.lightnode\"");
    });
    it(`${os}: aborts if a different-network worker container is running (never nuke the wrong one)`, () => {
      expect(out).toContain("8200"); // testnet chain id is the only one allowed to proceed
      expect(out).toMatch(/Nothing was removed|nothing was removed/i);
    });
    it(`${os}: NEVER deletes the worker keystore (it controls returned stake/funds)`, () => {
      expect(out).not.toMatch(/rm -rf[^\n]*lightchain-worker\/keys/);
      expect(out).toContain("kept your worker keys");
    });
  }
  it("scopes the image removal to the target network", () => {
    expect(uninstallCommand("macos", "mainnet")).toContain("lightchain-mainnet-public-docker");
    expect(uninstallCommand("macos", "testnet")).toContain("lightchain-testnet-public-docker");
  });
});

describe("preflight (check before staking)", () => {
  for (const os of ["macos", "linux"] as const) {
    const out = preflightCommand(os, "testnet");
    it(`${os}: checks Docker, Ollama, disk, RPC, gateway, and the indexer`, () => {
      expect(out).toContain("docker info");
      expect(out).toContain("11434"); // ollama
      expect(out).toMatch(/df -k/); // disk
      expect(out).toContain("eth_chainId"); // RPC probe
      expect(out).toContain("rpc.testnet.lightchain.ai");
      expect(out).toContain("worker-gateway.testnet.lightchain.ai");
      expect(out).toContain("workers-api.testnet.lightchain.ai");
    });
  }
});
