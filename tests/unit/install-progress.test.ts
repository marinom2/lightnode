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

  it("advances later milestones when their markers appear even if an earlier marker was skipped", () => {
    // A model that's already present prints no pull markers; register starting
    // still implies prepare + model are done.
    const v = deriveInstallView(["▶ phase 07-register", "registering worker"], "running");
    expect(v.milestones.find((m) => m.id === "prepare")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "model")!.status).toBe("done");
    expect(v.milestones.find((m) => m.id === "register")!.status).toBe("active");
  });
});
