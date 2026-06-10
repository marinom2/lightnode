import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addBatch, addBridge } from "../../sdk/src/add";

describe("addBatch / addBridge scaffolders", () => {
  const dirs: string[] = [];
  const fresh = () => {
    const d = mkdtempSync(join(tmpdir(), "lnbb-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("add batch writes a runnable batch.ts using runInferenceBatch + the ws shim", () => {
    const cwd = fresh();
    const r = addBatch({ cwd, network: "testnet" });
    expect(r.template).toBe("node");
    expect(r.install).toContain("tsx");
    expect(r.written.map((w) => w.path).some((p) => p.endsWith("batch.ts"))).toBe(true);
    const script = readFileSync(join(cwd, "batch.ts"), "utf8");
    expect(script).toContain("runInferenceBatch(");
    expect(script).toContain("WebSocket: WS");
    expect(script).toContain("`0x${string}`"); // key type annotation survived escaping
    expect(readFileSync(join(cwd, ".env.example"), "utf8")).toContain("NETWORK=testnet");
  });

  it("add bridge writes a runnable bridge.ts driving the SDK bridge surface (mainnet)", () => {
    const cwd = fresh();
    const r = addBridge({ cwd });
    expect(r.network).toBe("mainnet"); // bridge route is mainnet-only
    const script = readFileSync(join(cwd, "bridge.ts"), "utf8");
    expect(script).toContain("quoteBridgeFee(");
    expect(script).toContain("approveBridge("); // the ERC-20 leg
    expect(script).toContain("bridgeTransfer(");
    expect(script).toContain("BRIDGE_DIRECTION");
    const env = readFileSync(join(cwd, ".env.example"), "utf8");
    expect(env).toContain("BRIDGE_DIRECTION=lc-to-eth");
  });

  it("does not overwrite without --force", () => {
    const cwd = fresh();
    addBatch({ cwd, network: "testnet" });
    expect(addBatch({ cwd, network: "testnet" }).written.every((w) => w.skipped)).toBe(true);
    expect(addBatch({ cwd, network: "testnet", force: true }).written.every((w) => !w.skipped)).toBe(true);
  });
});
