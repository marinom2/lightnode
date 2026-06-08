import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorkerOperator } from "../../sdk/src/add";

describe("addWorkerOperator scaffolder", () => {
  const dirs: string[] = [];
  const fresh = () => {
    const d = mkdtempSync(join(tmpdir(), "lnwo-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes worker-ops.ts, .env.example, and a README; install uses the node toolchain", () => {
    const cwd = fresh();
    const r = addWorkerOperator({ cwd, network: "mainnet" });
    expect(r.template).toBe("node");
    expect(r.network).toBe("mainnet");
    expect(r.install).toContain("tsx");
    const paths = r.written.map((w) => w.path);
    expect(paths.some((p) => p.endsWith("worker-ops.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".env.example"))).toBe(true);
    expect(paths.some((p) => p.endsWith("WORKER-OPS-README.md"))).toBe(true);
    expect(r.written.every((w) => !w.skipped)).toBe(true);
  });

  it("generated script drives the unified WorkerOperator surface and gates mainnet slashing", () => {
    const cwd = fresh();
    addWorkerOperator({ cwd, network: "testnet" });
    const script = readFileSync(join(cwd, "worker-ops.ts"), "utf8");
    // Uses the operator + read client and the unified batch-op fields.
    expect(script).toContain("new WorkerOperator(");
    expect(script).toContain("op.releaseAll(");
    expect(script).toContain("op.clearStuck(");
    expect(script).toContain("op.unstickAndDeregister(");
    expect(script).toContain("r.done.map");
    expect(script).toContain("r.skipped.map");
    // The mainnet-slashing commands must be guarded.
    expect(script).toContain("requireYesOnMainnet");
    // The env example calls out the WORKER's own key, not a consumer key.
    const env = readFileSync(join(cwd, ".env.example"), "utf8");
    expect(env).toMatch(/worker's own/i);
    expect(env).toContain("NETWORK=testnet");
  });

  it("does not overwrite an existing file without --force", () => {
    const cwd = fresh();
    addWorkerOperator({ cwd, network: "testnet" });
    const second = addWorkerOperator({ cwd, network: "testnet" });
    expect(second.written.every((w) => w.skipped)).toBe(true);
    const forced = addWorkerOperator({ cwd, network: "testnet", force: true });
    expect(forced.written.every((w) => !w.skipped)).toBe(true);
  });
});
