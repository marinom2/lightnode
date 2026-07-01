import { describe, it, expect } from "vitest";
import {
  WorkerOperator,
  WorkerOpError,
  type MinimalPublicClient,
  type MinimalWalletClient,
} from "../../sdk/src/index";

const ADDR = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const TX = "0xdeadbeef" as `0x${string}`;
// JobState enum index: 0 Submitted, 1 Acknowledged, 2 Completed.
const STATE = { Submitted: 0, Acknowledged: 1, Completed: 2 } as const;

// A 0x98f5b6c5 revert (DisputeWindowNotElapsed) the operator decodes + skips.
const DISPUTE_WINDOW_REVERT = "0x98f5b6c5" + "0".repeat(192);

type JobFixture = { id: number; state: number; deadlineAt: number };

function makeClients(jobs: JobFixture[], opts: { revertOnRelease?: Set<number> } = {}): {
  pub: MinimalPublicClient;
  wallet: MinimalWalletClient;
} {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const pub: MinimalPublicClient = {
    async readContract({ functionName, args }) {
      if (functionName === "getJob") {
        const id = Number(args?.[0]);
        const j = byId.get(id);
        if (!j) throw new Error(`no fixture for job ${id}`);
        return {
          jobId: BigInt(id),
          worker: ADDR,
          state: j.state,
          escrowedFee: 0n,
          promptBlobHash: "0x",
          responseBlobHash: "0x",
          submittedAt: 0,
          ackAt: 1,
          completedAt: 0,
          deadlineAt: j.deadlineAt,
          submitBlockNumber: 0n,
          completionBlockNumber: 0n,
        };
      }
      // config() AIConfig getters + workerBalance: any bigint is fine here.
      if (functionName === "workerBalance") return 0n;
      return 600n;
    },
    async waitForTransactionReceipt() {
      return { status: "success" as const, blockNumber: 1n };
    },
  };
  const wallet: MinimalWalletClient = {
    account: ADDR,
    async writeContract({ functionName, args }) {
      if (functionName === "releaseJob" && opts.revertOnRelease?.has(Number(args?.[0]))) {
        // Mimic a viem provider error carrying the raw revert data.
        throw { data: DISPUTE_WINDOW_REVERT };
      }
      return TX;
    },
  };
  return { pub, wallet };
}

describe("WorkerOperator unified batch-op result shape", () => {
  const now = Math.floor(Date.now() / 1000);
  const PAST = now - 1000; // past the completion deadline -> eligible
  const FUTURE = now + 100_000; // still inside the window -> not eligible

  it("clearStuck returns { done, skipped } - clears past-deadline acked jobs, skips the rest", async () => {
    const { pub, wallet } = makeClients([
      { id: 10, state: STATE.Acknowledged, deadlineAt: PAST },
      { id: 11, state: STATE.Acknowledged, deadlineAt: FUTURE },
    ]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.clearStuck([10, 11]);
    expect(r.done).toEqual([{ jobId: 10n, tx: TX }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].jobId).toBe(11n);
    expect(r.skipped[0].reason).toMatch(/not yet past/i);
    // No legacy keys leak through.
    expect((r as unknown as Record<string, unknown>).cleared).toBeUndefined();
  });

  it("releaseAll returns { done, skipped } - settles completed jobs, skips in-window ones", async () => {
    const { pub, wallet } = makeClients(
      [
        { id: 1, state: STATE.Completed, deadlineAt: PAST },
        { id: 2, state: STATE.Completed, deadlineAt: PAST },
        { id: 3, state: STATE.Submitted, deadlineAt: PAST }, // not settleable; in neither list
      ],
      { revertOnRelease: new Set([2]) },
    );
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.releaseAll([1, 2, 3]);
    expect(r.done).toEqual([{ jobId: 1n, tx: TX }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].jobId).toBe(2n);
    expect(r.skipped[0].reason).toMatch(/dispute window/i);
    expect((r as unknown as Record<string, unknown>).released).toBeUndefined();
    expect((r as unknown as Record<string, unknown>).notReady).toBeUndefined();
  });

  it("releaseAll rethrows a non-dispute-window revert (does not swallow it)", async () => {
    const pub: MinimalPublicClient = {
      async readContract({ functionName, args }) {
        if (functionName === "getJob") {
          return { jobId: BigInt(Number(args?.[0])), worker: ADDR, state: STATE.Completed, escrowedFee: 0n, promptBlobHash: "0x", responseBlobHash: "0x", submittedAt: 0, ackAt: 1, completedAt: 0, deadlineAt: 0, submitBlockNumber: 0n, completionBlockNumber: 0n };
        }
        return 0n;
      },
      async waitForTransactionReceipt() {
        return { status: "success" as const, blockNumber: 1n };
      },
    };
    const wallet: MinimalWalletClient = {
      account: ADDR,
      async writeContract() {
        throw { data: "0xcb9a70eb" + "0".repeat(64) }; // WorkerNotRegistered, not dispute-window
      },
    };
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    await expect(op.releaseAll([7])).rejects.toBeInstanceOf(WorkerOpError);
  });
});

describe("WorkerOperator stuck-job coverage (the never-acked Submitted gap)", () => {
  const now = Math.floor(Date.now() / 1000);
  const PAST = now - 1000;
  const FUTURE = now + 100_000;
  const RELEASED = 6; // JobState index 6

  it("clearStuck also clears past-deadline Submitted (never-acked) jobs, not just Acknowledged", async () => {
    const { pub, wallet } = makeClients([
      { id: 20, state: STATE.Submitted, deadlineAt: PAST },
      { id: 21, state: STATE.Acknowledged, deadlineAt: PAST },
    ]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.clearStuck([20, 21]);
    expect(r.done.map((d) => d.jobId)).toEqual([20n, 21n]);
  });

  it("canDeregister splits blockers: releasable-now vs release-pending vs slashable", async () => {
    const { pub, wallet } = makeClients([
      { id: 1, state: STATE.Completed, deadlineAt: PAST }, // window elapsed -> releasable now
      { id: 2, state: STATE.Completed, deadlineAt: FUTURE }, // still in window -> pending
      { id: 3, state: STATE.Acknowledged, deadlineAt: PAST }, // slashable (completion-timeout)
      { id: 4, state: STATE.Submitted, deadlineAt: PAST }, // slashable (ack-timeout)
      { id: 5, state: RELEASED, deadlineAt: PAST }, // terminal -> never a blocker
    ]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.canDeregister([1, 2, 3, 4, 5]);
    expect(r.ok).toBe(false);
    expect(r.releasableNow).toEqual([1n]);
    expect(r.releasePending).toEqual([2n]);
    expect(r.slashableToClear.map((j) => j.jobId)).toEqual([3n, 4n]);
    expect(r.slashableToClear.find((j) => j.jobId === 4n)?.state).toBe("Submitted");
    expect(r.blockedBy).not.toContain(5n);
  });

  it("unstickAndDeregister releases free jobs but REFUSES to slash without acceptSlash", async () => {
    const { pub, wallet } = makeClients([
      { id: 1, state: STATE.Completed, deadlineAt: PAST }, // released for free
      { id: 3, state: STATE.Acknowledged, deadlineAt: PAST }, // slashable -> must block
    ]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.unstickAndDeregister([1, 3]);
    expect(r.released.map((x) => x.jobId)).toEqual([1n]);
    expect(r.cleared).toEqual([]);
    expect(r.deregisterTx).toBeUndefined();
    expect(r.blocked?.slashableToClear.map((j) => j.jobId)).toEqual([3n]);
  });

  it("unstickAndDeregister with acceptSlash clears the stuck jobs (opt-in slash)", async () => {
    const { pub, wallet } = makeClients([{ id: 3, state: STATE.Acknowledged, deadlineAt: PAST }]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.unstickAndDeregister([3], { acceptSlash: true });
    expect(r.cleared.map((x) => x.jobId)).toEqual([3n]);
    // The static fixture still reports #3 as stuck post-clear, so deregister stays
    // gated off (no doomed ActiveJobsExist revert) and returns the blocked readiness.
    expect(r.deregisterTx).toBeUndefined();
    expect(r.blocked).toBeDefined();
  });

  it("unstickAndDeregister deregisters cleanly when nothing blocks", async () => {
    const { pub, wallet } = makeClients([{ id: 5, state: RELEASED, deadlineAt: PAST }]);
    const op = new WorkerOperator("mainnet", { publicClient: pub, walletClient: wallet, workerAddress: ADDR });
    const r = await op.unstickAndDeregister([5], { acceptSlash: true });
    expect(r.blocked).toBeUndefined();
    expect(r.deregisterTx).toBe(TX);
  });
});
