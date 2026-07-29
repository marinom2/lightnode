import { describe, it, expect } from "vitest";
import { deriveInstallView, latestDownloadPercent, diagnoseFailure, extractWorkerAddress, extractNetwork } from "@/lib/install-progress";

const PREP = [
  "▶ LightNode installer rev x (testnet)",
  "✓ Docker engine ready",
  "✓ Ollama server running",
  "✓ Foundry (cast) ready",
  "✓ workdir: /Users/me/.lightnode",
];

describe("latestDownloadPercent", () => {
  it("reads the most recent pull percentage", () => {
    expect(latestDownloadPercent(["pulling 4e30: 4% ▕▏ 284 MB/7.2 GB", "pulling 4e30: 7% ▕▏ 510 MB/7.2 GB"])).toBe(7);
  });
  it("ignores percentages outside a pull/download context", () => {
    expect(latestDownloadPercent(["staked 100% of the minimum"])).toBeNull();
  });
  it("returns null when nothing is downloading", () => {
    expect(latestDownloadPercent(["✓ Docker engine ready"])).toBeNull();
  });
});

describe("deriveInstallView", () => {
  it("marks the model step active with a download percent mid-pull", () => {
    const v = deriveInstallView([...PREP, "▶ downloading gemma4-e2b", "pulling 4e30: 4% ▕▏ 284 MB/7.2 GB"], "running");
    const prepare = v.milestones.find((m) => m.id === "prepare")!;
    const model = v.milestones.find((m) => m.id === "model")!;
    expect(prepare.status).toBe("done");
    expect(model.status).toBe("active");
    expect(model.detail).toBe("4%");
    expect(v.download).toBe(4);
    expect(v.headline).toContain("4%");
  });

  it("treats every milestone as done when the run finishes", () => {
    const v = deriveInstallView([...PREP, "✅ worker online"], "done");
    expect(v.milestones.every((m) => m.status === "done")).toBe(true);
    expect(v.headline).toMatch(/online/i);
  });

  it("flags the first incomplete step as the error on failure", () => {
    const v = deriveInstallView([...PREP, "▶ downloading gemma4-e2b", "⛔ pull failed"], "failed");
    const model = v.milestones.find((m) => m.id === "model")!;
    expect(model.status).toBe("error");
    // earlier steps stay done, later steps stay pending
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("pending");
  });

  it("lands a phase-01 failure on 'Connecting to the network', not on 'Staking'", () => {
    // The reported shape: funding line printed, then the first phase died. The X
    // must NOT sit on the staking row (no stake was touched) - it belongs to the
    // address-resolution step that runs before registration.
    const v = deriveInstallView(
      [
        "▶ LightNode installer rev 2026-05-30.03 (mainnet)",
        "✓ model llama3-8b present",
        "▶ funding worker: send to 0xdf589ff8897C351d4E09E688b333C67fcB027802",
        "▶ phase .\\01-resolve-addresses.ps1",
        "⛔ stopped at .\\01-resolve-addresses.ps1 - exit code 1",
      ],
      "failed",
    );
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "model")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "resolve")!.status).toBe("error");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("pending");
  });

  it("diagnoses an address-resolution / RPC failure as a connection issue (no stake touched)", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-05-30.03 (mainnet)",
      "▶ phase .\\01-resolve-addresses.ps1",
      "Failed to read aiConfig() from WorkerRegistry. Got:",
      "⛔ stopped at .\\01-resolve-addresses.ps1 - exit code 1",
    ])!;
    expect(hint).toMatch(/connection issue|contract addresses/i);
    expect(hint).toMatch(/no stake was touched|not a problem with your worker/i);
    expect(hint).toContain("mainnet.lightscan.app");
  });

  it("does NOT blame funding when the funding gate already confirmed the wallet is funded", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-05-30.04 (mainnet)",
      "▶ funding worker: send to 0xdf589ff8897C351d4E09E688b333C67fcB027802",
      "✓ worker wallet funded (55000 LCAI)",
      "▶ phase .\\07-register.ps1",
      "register failed",
    ])!;
    expect(hint).toMatch(/not a funding problem/i);
    expect(hint).toMatch(/do NOT send more/i);
    expect(hint).not.toMatch(/top up/i);
    expect(hint).toContain("0xdf589ff8897C351d4E09E688b333C67fcB027802");
  });

  it("diagnoses a model-add revert (the gemma-on-testnet failure) with actionable guidance", () => {
    const log = [
      "▶ phase 07-register",
      "worker registered on-chain",
      "AddSupportedModel failed, rolling back registration",
      "registration: add supported model at index 0: AddSupportedModel transaction: execution reverted",
      "⛔ stopped at 07-register",
    ];
    const hint = diagnoseFailure(log)!;
    expect(hint).toMatch(/Models this worker serves/i);
    expect(hint).toMatch(/llama3-8b/);
    expect(hint).toMatch(/not lost/i);
  });

  it("diagnoses an insufficient-balance register failure", () => {
    const hint = diagnoseFailure(["⛔ stopped at 07-register", "Worker has less than 5001 LCAI"])!;
    expect(hint).toMatch(/more LCAI/i);
  });

  it("returns null for an unrecognized failure that never reached register", () => {
    expect(diagnoseFailure(["some unrelated error"])).toBeNull();
  });

  it("extracts the funded worker address from the installer log", () => {
    expect(
      extractWorkerAddress([
        "▶ LightNode installer rev x (mainnet)",
        "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
        "AI_CONFIG_ADDRESS=0x24D11533C354092ed6E18b964257819cE78Ce77D",
      ]),
    ).toBe("0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec");
    // No worker line -> null (so we never surface an unrelated contract address as "the wallet").
    expect(extractWorkerAddress(["AI_CONFIG_ADDRESS=0x24D11533C354092ed6E18b964257819cE78Ce77D"])).toBeNull();
  });

  it("extracts the install's network from the banner", () => {
    expect(extractNetwork(["▶ LightNode installer rev 2026-05-28 (mainnet)"])).toBe("mainnet");
    expect(extractNetwork(["▶ LightNode installer rev 2026-05-28 (testnet)"])).toBe("testnet");
    expect(extractNetwork(["something unrelated"])).toBeNull();
  });

  it("generic register-failure fallback fires with the worker's mainnet explorer link when no specific revert matched", () => {
    // This is the Runar shape: the Windows runner reached the register wrapper
    // (status check ran), the worker never came online, and no specific cause
    // text (insufficient/balance/AddSupportedModel) reached the cleaned log.
    const log = [
      "▶ LightNode installer rev 2026-05-28 (mainnet)",
      "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
      "phase .\\05-generate-ecdh.ps1",
      "+ docker run --rm worker:latest status",
    ];
    const hint = diagnoseFailure(log)!;
    expect(hint).toMatch(/stake plus gas|stake \+ gas/i);
    expect(hint).toContain("mainnet.lightscan.app");
    expect(hint).toContain("0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec");
    expect(hint).toMatch(/run install again|retry install|existing worker key/i);
  });

  it("generic register fallback uses the testnet explorer when installing testnet", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-05-28 (testnet)",
      "▶ funding worker: send to 0x6781234567890123456789012345678901236e0f",
      "▶ phase 07-register",
      "(docker exited 1)",
    ])!;
    expect(hint).toContain("testnet.lightscan.app");
    expect(hint).toContain("0x6781234567890123456789012345678901236e0f");
  });

  it("generic register fallback does NOT fire when the worker actually came online", () => {
    expect(
      diagnoseFailure([
        "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
        "▶ phase 07-register",
        "✅ worker online",
      ]),
    ).toBeNull();
  });

  it("generic register fallback does NOT fire when register was never reached (failed earlier)", () => {
    expect(
      diagnoseFailure([
        "▶ LightNode installer rev x (mainnet)",
        "⛔ Docker engine didn't come up automatically",
      ]),
    ).toMatch(/Docker did not start/);
  });

  it("diagnoses the keystore-password-mismatch sentinel with a Recover hint", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev x (mainnet)",
      "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
      "⛔ keystore-password-mismatch: an existing worker key for 0xEFd1bAE7… is on this device, but the password set this session does not decrypt it.",
    ])!;
    expect(hint).toMatch(/password.*does(n't| not) match|password set this session/i);
    expect(hint).toMatch(/Recover a replaced key/);
  });

  it("diagnoses the funding-gate timeout with the worker's explorer link", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev x (mainnet)",
      "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
      "⛔ funding-gate timeout: worker wallet at 0xEFd1bAE7… still has only 0.0 LCAI.",
    ])!;
    expect(hint).toMatch(/wallet was still empty/);
    expect(hint).toContain("mainnet.lightscan.app");
    expect(hint).toContain("0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec");
    expect(hint).toMatch(/existing setup is reused/);
  });

  it("specific insufficient-balance message still wins over the generic fallback", () => {
    const hint = diagnoseFailure([
      "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
      "▶ phase 07-register",
      "Worker has less than 50001 LCAI",
      "⛔ stopped at 07-register",
    ])!;
    // The specific (terser) message is preferred when its keywords are present.
    expect(hint).toBe("Registration needs a little more LCAI for the stake plus gas. Top up the worker address shown above, then run install again.");
  });

  // ── Recognisers for the terminal failures the bash installer actually prints ──
  // Every log line below is the literal text lib/scriptgen.ts emits (add_selected_
  // model_onchain, the SMART_PREREQS escalation ladder, the 0.0.0.0 bind gate and the
  // MISSING_MODELS gate). Paraphrasing here would let the recognisers rot silently the
  // next time the script changes, which is exactly how the "model add failed" matcher
  // went stale and started telling staked operators to send more money.

  it("tells an ALREADY-STAKED operator the stake is safe when the on-chain model add would revert", () => {
    // The reviewer's repro: the re-run branch skips gate_funding, so `fundingConfirmed`
    // is false and the generic register fallback used to fire with "Top up …".
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-07-20 (mainnet)",
      "✓ model gemma4:e2b present",
      "▶ funding worker: send to 0xEFd1bAE7ed03dcf6b8b79ef601cdda19f1e15cec",
      "▶ phase 07-register (already staked from a prior attempt; finishing the model-add the daemon failed - no re-stake)",
      "⛔ the on-chain model add would revert, so it was NOT sent: Error: server returned an error response: error code 3: execution reverted",
      "   The worker is staked but is NOT serving the selected model, so it would earn nothing. Check the model is whitelisted on this network, then run install again.",
    ])!;
    expect(hint).toMatch(/already staked and registered/i);
    expect(hint).toMatch(/stake is locked, not lost/i);
    expect(hint).toMatch(/never sent/i);
    expect(hint).toMatch(/Models this worker serves/);
    // The whole point of the fix: never send a fully-staked worker back to the faucet.
    expect(hint).not.toMatch(/top up/i);
    expect(hint).not.toMatch(/send more|add funds|minimum stake/i);
  });

  it("recognises the model-add send failure without blaming funding", () => {
    const hint = diagnoseFailure([
      "▶ phase 07-register",
      "▶ adding the selected model on-chain with proper gas (gas-limit 138402) - the daemon under-gasses this step",
      "⛔ the model-add tx failed to send: Error: (code: -32000, message: intrinsic gas too low)",
    ])!;
    expect(hint).toMatch(/already staked and registered/i);
    expect(hint).toMatch(/never made it onto the network/i);
    expect(hint).not.toMatch(/top up/i);
  });

  it("recognises a model-add that mined but reverted on-chain", () => {
    const hint = diagnoseFailure([
      "▶ phase 07-register",
      "⛔ the model-add tx landed but the registry still does not list this worker as serving the model - it reverted on-chain (receipt status 0).",
      "   Your stake is untouched, and the worker is NOT online until this succeeds. Run install again in a minute; if it keeps failing, the model may not be whitelisted on this network.",
    ])!;
    expect(hint).toMatch(/mined but reverted/i);
    expect(hint).toMatch(/stake is locked, not lost/i);
    expect(hint).not.toMatch(/top up/i);
  });

  it("still recognises the PowerShell runner's 'model add failed' throw", () => {
    const hint = diagnoseFailure([
      "▶ phase .\\07-register.ps1",
      "⛔ stopped at .\\07-register.ps1 - model add failed",
    ])!;
    expect(hint).toMatch(/already staked and registered/i);
    expect(hint).not.toMatch(/top up/i);
  });

  it("diagnoses a declined polkit prompt during the Ollama install", () => {
    const hint = diagnoseFailure([
      "▶ installing Ollama",
      "… approve the administrator prompt to install Ollama (the same prompt also binds it to 0.0.0.0, which the worker container needs)",
      "⛔ the Ollama install (or the 0.0.0.0 bind that follows it) did not complete - the administrator prompt was declined, or no polkit agent is running in this session.",
      "   Run this ONCE in a terminal, then click Install again:",
      "     curl -fsSL https://ollama.com/install.sh | sh",
    ])!;
    expect(hint).toMatch(/Ollama/);
    expect(hint).toContain("https://ollama.com/install.sh | sh");
    expect(hint).toMatch(/Nothing was staked/);
  });

  it("diagnoses the can_root pre-check refusing the Docker install", () => {
    // `as_root` can only offer sudo -n (silent) or pkexec, so on a box where sudo
    // wants a password and no polkit agent is running this is the ONLY line printed.
    const hint = diagnoseFailure([
      "▶ installing Docker",
      "⛔ Docker is not installed, and installing it needs administrator rights this app cannot obtain here (you are not root, passwordless sudo is not configured, and pkexec - the graphical admin prompt - is unavailable).",
      "   Run this ONCE in a terminal, then click Install again:",
      "     curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker marinom && newgrp docker",
    ])!;
    expect(hint).toMatch(/Docker/);
    expect(hint).toContain("https://get.docker.com | sudo sh");
    expect(hint).toMatch(/Nothing was staked/);
  });

  it("recognises a bare pkexec refusal it cannot attribute to Docker or Ollama", () => {
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-07-20 (mainnet)",
      "Error executing command as another user: Not authorized",
    ])!;
    expect(hint).toMatch(/administrator rights/i);
    expect(hint).toMatch(/nothing was staked/i);
  });

  it("a stray rebind-declined warning never outranks the real failure", () => {
    // The bind retry warns and CARRIES ON, so its privilege wording can sit in the log
    // of a run that died of something else. The specific recogniser must still win.
    const hint = diagnoseFailure([
      "▶ LightNode installer rev 2026-05-30.03 (mainnet)",
      "⚠ could not rebind Ollama automatically (the admin prompt was declined or unavailable)",
      "▶ phase 01-resolve-addresses",
      "Failed to read aiConfig() from WorkerRegistry. Got:",
      "⛔ stopped at 01-resolve-addresses",
    ])!;
    expect(hint).toMatch(/connection issue/i);
  });

  it("diagnoses the loopback-only Ollama abort with the exact drop-in fix", () => {
    const hint = diagnoseFailure([
      "▶ allowing the worker container to reach Ollama (binding it to 0.0.0.0)",
      "… approve the administrator prompt so the worker container can reach Ollama",
      "⚠ could not rebind Ollama automatically (the admin prompt was declined or unavailable)",
      "⛔ Ollama still only listens on 127.0.0.1, so the Dockerized worker cannot reach it and EVERY job would fail at inference - a staked worker that earns nothing and can be slashed. Install stops here; nothing has been staked.",
      "   Fix it once in a terminal, then click Install again:",
      "     sudo mkdir -p /etc/systemd/system/ollama.service.d",
    ])!;
    expect(hint).toMatch(/only listening on 127\.0\.0\.1/i);
    expect(hint).toContain("OLLAMA_HOST=0.0.0.0:11434");
    expect(hint).toContain("systemctl restart ollama");
    // The rebind prompt was refused - say so instead of leaving them to guess.
    expect(hint).toMatch(/administrator prompt was declined/i);
    expect(hint).toMatch(/Nothing was staked/);
  });

  it("diagnoses the preflight's loopback-only block too", () => {
    const hint = diagnoseFailure([
      "⛔ Ollama only listens on 127.0.0.1, so the Dockerized worker cannot reach it and every job would fail at inference - and this app has no way to obtain the admin rights to rebind it. Run once in a terminal, then re-run install:",
    ])!;
    expect(hint).toContain("OLLAMA_HOST=0.0.0.0:11434");
    // Nothing tried to rebind, so don't invent a declined prompt.
    expect(hint).not.toMatch(/administrator prompt was declined/i);
  });

  it("does NOT treat the preflight's 'install will rebind it' notice as a failure", () => {
    expect(
      diagnoseFailure([
        "⚠ Ollama only listens on 127.0.0.1 - install will rebind it to 0.0.0.0 (admin prompt) so the worker container can reach it",
      ]),
    ).toBeNull();
  });

  it("diagnoses the MISSING_MODELS abort, naming the model and its size", () => {
    const hint = diagnoseFailure([
      "▶ downloading gemma4:e2b - a multi-GB model can take several minutes",
      "⚠ gemma4:e2b download exited 1: Error: max retries exceeded",
      "⛔ these selected model(s) are NOT on this machine after the download: gemma4:e2b",
      "   A worker advertises what it serves, so registering now would stake your LCAI on a model that fails every job it wins (slashable on mainnet). Install stops here.",
      "   Nothing was staked or registered - your funds are untouched.",
      "   Check by hand with:  ollama pull <tag>   then   ollama list",
    ])!;
    expect(hint).toContain("gemma4:e2b");
    expect(hint).toContain("7.2 GB download");
    expect(hint).toMatch(/ollama pull/);
    expect(hint).toMatch(/funds are\s+untouched|untouched/i);
    // It must beat the "download exited" recogniser, which only guesses at disk.
    expect(hint).not.toMatch(/Ollama resumes from/);
  });

  it("diagnoses the docker-group relog abort", () => {
    const hint = diagnoseFailure([
      "▶ installing Docker",
      "⛔ Docker is installed and running, but your user was only just added to the 'docker' group and Linux applies group changes at LOGIN. Log out and back in (or reboot), then click Install again. Nothing has been staked.",
    ])!;
    expect(hint).toMatch(/Log out and back in/i);
    expect(hint).toMatch(/Nothing was staked/);
  });

  it("advances later milestones when their markers appear even if an earlier marker was skipped", () => {
    // A model that's already present prints no pull markers; register starting
    // still implies prepare + model are done.
    const v = deriveInstallView(["▶ phase 07-register", "registering worker"], "running");
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "model")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("active");
  });
});
