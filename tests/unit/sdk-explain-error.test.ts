import { describe, it, expect } from "vitest";
import {
  explainInferenceError,
  StalledWorkerError,
  OnChainRevertError,
  GatewayAuthError,
  InferenceAbortedError,
  RelayTokenTimeoutError,
} from "../../sdk/src/index";

const ADDR = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const TX = "0xabc0000000000000000000000000000000000000000000000000000000000001" as `0x${string}`;

describe("explainInferenceError", () => {
  it("explains a stalled worker as auto-refunding + retryable, with live refund timing", () => {
    const e = new StalledWorkerError({ jobId: 42n, worker: ADDR, submitTx: TX, feeLcai: 0.02 });
    const x = explainInferenceError(e, { refundWindowSec: 24 * 3600 });
    expect(x.kind).toBe("stalled");
    expect(x.fundsSafe).toBe(true);
    expect(x.retryable).toBe(true);
    expect(x.jobId).toBe("42");
    expect(x.tx).toBe(TX);
    expect(x.detail).toMatch(/~24h dispute window/);
    expect(x.detail).not.toMatch(/timeoutJob.{0,3}call/i); // tells them they do NOT need to
  });

  it("falls back to a generic dispute-window phrase when no window is given", () => {
    const e = new StalledWorkerError({ jobId: 1n, worker: ADDR, submitTx: TX, feeLcai: 0.02 });
    expect(explainInferenceError(e).detail).toMatch(/a few hours on testnet/);
  });

  it("distinguishes a createSession revert (no fee escrowed) from submitJob", () => {
    const cs = explainInferenceError(new OnChainRevertError("createSession", TX));
    expect(cs.kind).toBe("revert");
    expect(cs.detail).toMatch(/no fee was escrowed/i);
    const sj = explainInferenceError(new OnChainRevertError("submitJob", TX));
    expect(sj.nextStep).toMatch(/stake|balance|enabled/i);
    expect(sj.tx).toBe(TX);
  });

  it("maps gateway 401 to a re-auth step", () => {
    const x = explainInferenceError(new GatewayAuthError(401, "expired"));
    expect(x.kind).toBe("auth");
    expect(x.nextStep).toMatch(/sign-in|bearer/i);
  });

  it("maps abort + relay timeout to retryable, funds-safe", () => {
    expect(explainInferenceError(new InferenceAbortedError("relay-token")).kind).toBe("aborted");
    expect(explainInferenceError(new RelayTokenTimeoutError()).kind).toBe("relay-timeout");
  });

  it("recognises wallet rejection and insufficient funds from a raw viem message", () => {
    expect(explainInferenceError(new Error("User rejected the request.")).kind).toBe("rejected");
    expect(explainInferenceError(new Error("insufficient funds for gas * price + value")).kind).toBe("insufficient-funds");
  });

  it("never leaks a multi-line raw error in the unknown fallback", () => {
    const x = explainInferenceError(new Error("boom\nstack line\nstack line 2"));
    expect(x.kind).toBe("unknown");
    expect(x.detail).toBe("boom");
  });
});
