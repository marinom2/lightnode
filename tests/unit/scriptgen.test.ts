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
  benchmarkCommand,
  freeMemoryCommand,
} from "@/lib/scriptgen";

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
  it("sweepCommand is OS-aware and sends to the destination", () => {
    expect(sweepCommand("macos", "0xDEST")).toContain("sweep-rewards.sh 0xDEST");
    const win = sweepCommand("windows", "0xDEST");
    expect(win).toContain("sweep-rewards.ps1");
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
  it("unix install probes on-chain status and skips 07-register when already registered", () => {
    const unix = desktopInstallCommand("macos", "mainnet");
    expect(unix).toContain("status.sh");
    // skip only on a positive REGISTERED, never on NOT REGISTERED
    expect(unix).toContain('grep -qi "registered"');
    expect(unix).toContain('grep -qiE "not[ _-]*registered"');
    expect(unix).toContain("07-register (skipped - already registered");
  });
  it("unix still runs 07-register for a fresh (unregistered) worker - the guard only fires on a positive match", () => {
    const unix = desktopInstallCommand("macos", "testnet");
    // the phase is still in the list and run by default
    expect(unix).toContain("07-register");
    expect(unix).toContain('FORCE=1 "$RUNBASH" "$p.sh"');
  });
  it("windows install probes status.ps1 and skips 07-register when already registered", () => {
    const win = desktopInstallCommand("windows", "mainnet");
    expect(win).toContain("status.ps1");
    expect(win).toContain("$st -match 'REGISTERED'");
    expect(win).toContain("$st -notmatch 'NOT[ _-]*REGISTERED'");
    expect(win).toContain("07-register (skipped - already registered");
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
  it("the watchdog re-warms the model it reads from the model file", () => {
    expect(unix).toContain('cat "$HOME/.lightnode/model"');
  });
  it("unloads the previous model when switching to a new one (frees its memory)", () => {
    expect(unix).toContain('OLD_MODEL=');
    expect(unix).toContain('"keep_alive\\":0'); // keep_alive:0 unloads the old model
    expect(unix).toContain("unloaded the previous model");
    const win = desktopInstallCommand("windows", "mainnet", "llama3-70b");
    expect(win).toContain("$oldModel");
    expect(win).toContain("unloaded previous model");
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
  it("short-circuits when the worker is already running", () => {
    expect(unix).toContain("worker already running on testnet - nothing to reinstall");
    // and it must NOT falsely short-circuit a different-network container
    expect(unix).toContain("DIFFERENT network");
  });
  it("funds the worker directly: no funder key, no generate/fund phases", () => {
    expect(unix).not.toContain("$FUNDER_PRIVKEY"); // never reads a funder key
    expect(unix).toContain('cast wallet address --private-key "$WORKER_PRIVKEY"');
    expect(unix).not.toContain("00-generate-key");
    expect(unix).not.toContain("06-fund-worker");
    expect(unix).toContain("07-register");
  });
  it("patches the stale stake guard to the network minimum (testnet 5001, mainnet 50001)", () => {
    expect(desktopInstallCommand("macos", "testnet")).toContain("s/50001/5001/g");
    expect(desktopInstallCommand("macos", "mainnet")).toContain("s/50001/50001/g");
  });
  it("emits PowerShell (not bash) for Windows, auto-starting Docker Desktop", () => {
    expect(win).toContain("$ErrorActionPreference");
    expect(win).toContain("Docker Desktop.exe");
    expect(win).toContain("winget install --id Docker.DockerDesktop");
    expect(win).not.toContain("set -e");
  });
});
