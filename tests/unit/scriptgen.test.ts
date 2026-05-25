import { describe, it, expect } from "vitest";
import { generateSetup, desktopInstallCommand } from "@/lib/scriptgen";

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
    expect(unix).toContain("worker already running — nothing to reinstall");
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
