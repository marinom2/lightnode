import { describe, it, expect, vi, beforeEach } from "vitest";

// The Conversation helper's network seams are connectWithKey (SIWE + clients),
// openSession (createSession tx), and runJobOnSession (submitJob + relay).
// Stub the whole inference module so no handshake, WebSocket, or chain touch
// happens - each turn resolves with a canned RunInferenceResult so we can
// assert on serialization AND on session-reuse behavior.
const connectWithKey = vi.fn();
const openSession = vi.fn();
const runJobOnSession = vi.fn();
vi.mock("../../sdk/src/inference", () => ({
  connectWithKey: (...args: unknown[]) => connectWithKey(...args),
  openSession: (...args: unknown[]) => openSession(...args),
  runJobOnSession: (...args: unknown[]) => runJobOnSession(...args),
}));

import { Conversation, chat } from "../../sdk/src/chat";

const PRIVATE_KEY = "0x" + "1".repeat(64);
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 3600;

function fakeConnection(): Record<string, unknown> {
  return { network: { id: "testnet" }, networkId: "testnet", wallet: {}, publicClient: {}, gateway: {}, WebSocket: class {} };
}

function fakeSession(expirySec = FAR_FUTURE): Record<string, unknown> {
  return { sessionId: 1n, worker: "0x0000000000000000000000000000000000000000", expirySec, model: "llama3-8b" };
}

// A full RunInferenceResult-shaped canned reply. `answer` defaults to "ok" but
// each test can override it. Receipts are placeholders - we only care that they
// pass through send() unchanged.
function cannedResult(answer = "ok"): {
  answer: string;
  txs: { createSession: `0x${string}`; submitJob: `0x${string}`; jobCompleted: `0x${string}` | null };
  worker: `0x${string}`;
  sessionId: bigint;
  jobId: bigint;
  attempts: number;
  stalled: never[];
} {
  return {
    answer,
    txs: { createSession: "0xc", submitJob: "0xs", jobCompleted: "0xj" },
    worker: "0x0000000000000000000000000000000000000000",
    sessionId: 1n,
    jobId: 2n,
    attempts: 1,
    stalled: [],
  };
}

// Pull the serialized prompt out of the Nth runJobOnSession call (2nd arg).
function promptOfCall(n: number): string {
  return runJobOnSession.mock.calls[n][1] as string;
}

beforeEach(() => {
  connectWithKey.mockReset().mockResolvedValue(fakeConnection());
  openSession.mockReset().mockResolvedValue(fakeSession());
  runJobOnSession.mockReset();
});

describe("Conversation constructor validation", () => {
  it("requires a network", () => {
    expect(() => new Conversation({ privateKey: PRIVATE_KEY } as never)).toThrow(/network is required/);
  });

  it("requires a privateKey", () => {
    expect(() => new Conversation({ network: "testnet" } as never)).toThrow(/privateKey is required/);
  });
});

describe("Conversation.send", () => {
  it("returns the assistant answer and passes receipts through unchanged", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("Fitzgerald"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    const r = await convo.send("Who wrote 'The Great Gatsby'?");
    expect(r.answer).toBe("Fitzgerald");
    expect(r.txs.createSession).toBe("0xc");
    expect(r.jobId).toBe(2n);
    expect(runJobOnSession).toHaveBeenCalledTimes(1);
  });

  it("returns the running transcript in result.messages", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("Fitzgerald"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    const r = await convo.send("Who wrote it?");
    expect(r.messages).toEqual([
      { role: "user", content: "Who wrote it?" },
      { role: "assistant", content: "Fitzgerald" },
    ]);
  });

  it("rejects an empty / whitespace-only message before touching the network", async () => {
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await expect(convo.send("   ")).rejects.toThrow(/message is empty/);
    expect(connectWithKey).not.toHaveBeenCalled();
    expect(runJobOnSession).not.toHaveBeenCalled();
  });

  it("forwards credentials to connectWithKey and the model to openSession", async () => {
    runJobOnSession.mockResolvedValue(cannedResult());
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      model: "llama3-8b",
    });
    await convo.send("hi");
    const conn = connectWithKey.mock.calls[0][0] as Record<string, unknown>;
    expect(conn.network).toBe("testnet");
    expect(conn.privateKey).toBe(PRIVATE_KEY);
    const sess = openSession.mock.calls[0][0] as Record<string, unknown>;
    expect(sess.model).toBe("llama3-8b");
    expect(typeof promptOfCall(0)).toBe("string");
  });
});

describe("Conversation session reuse", () => {
  it("opens ONE session across turns: follow-ups skip connect + createSession", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("a"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("one");
    await convo.send("two");
    await convo.send("three");
    expect(connectWithKey).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(runJobOnSession).toHaveBeenCalledTimes(3);
  });

  it("reopens when the session window is about to expire", async () => {
    openSession
      .mockResolvedValueOnce(fakeSession(Math.floor(Date.now() / 1000) + 5)) // inside the safety margin
      .mockResolvedValueOnce(fakeSession());
    runJobOnSession.mockResolvedValue(cannedResult("a"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("one");
    await convo.send("two"); // expiring session must not be reused
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(connectWithKey).toHaveBeenCalledTimes(1); // SIWE bundle is still reused
  });

  it("on a failed turn, reopens once and retries the SAME serialized prompt", async () => {
    runJobOnSession
      .mockRejectedValueOnce(new Error("worker stopped serving"))
      .mockResolvedValueOnce(cannedResult("recovered"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    const r = await convo.send("hello");
    expect(r.answer).toBe("recovered");
    expect(openSession).toHaveBeenCalledTimes(2); // initial + forced reopen
    expect(promptOfCall(1)).toBe(promptOfCall(0)); // identical turn retried
    expect(convo.messages()).toHaveLength(2); // no duplicate user entries
  });

  it("propagates the error when the retry fails too", async () => {
    runJobOnSession.mockRejectedValue(new Error("still down"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await expect(convo.send("hello")).rejects.toThrow(/still down/);
    expect(runJobOnSession).toHaveBeenCalledTimes(2);
  });

  it("currentSession() exposes the open session and reset() keeps it", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("a"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    expect(convo.currentSession()).toBeNull();
    await convo.send("one");
    expect(convo.currentSession()).not.toBeNull();
    convo.reset();
    expect(convo.currentSession()).not.toBeNull(); // session is prompt-agnostic
    await convo.send("two");
    expect(openSession).toHaveBeenCalledTimes(1);
  });
});

describe("Conversation history accumulation", () => {
  it("accumulates user + assistant turns across sends and feeds prior turns into the next prompt", async () => {
    runJobOnSession.mockResolvedValueOnce(cannedResult("1925")).mockResolvedValueOnce(cannedResult("F. Scott"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });

    await convo.send("In what year?");
    await convo.send("And the author?");

    expect(convo.messages()).toEqual([
      { role: "user", content: "In what year?" },
      { role: "assistant", content: "1925" },
      { role: "user", content: "And the author?" },
      { role: "assistant", content: "F. Scott" },
    ]);

    const secondPrompt = promptOfCall(1);
    expect(secondPrompt).toContain("User: In what year?");
    expect(secondPrompt).toContain("Assistant: 1925");
    expect(secondPrompt).toContain("User: And the author?");
    expect(secondPrompt.endsWith("Assistant:")).toBe(true);
  });

  it("messages() returns a defensive copy that does not mutate internal history", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("a"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("hi");
    const snapshot = convo.messages();
    snapshot.push({ role: "user", content: "injected" });
    expect(convo.messages()).toHaveLength(2);
  });

  it("reset() clears history so the next send is a fresh first turn", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("x"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("first");
    convo.reset();
    expect(convo.messages()).toEqual([]);

    await convo.send("second");
    const secondPrompt = promptOfCall(1);
    expect(secondPrompt).not.toContain("first");
    expect(secondPrompt).toContain("User: second");
  });
});

describe("Conversation system prompt", () => {
  it("prepends the system message to every serialized prompt", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      system: "  You are a terse assistant.  ",
    });
    await convo.send("hello");
    const prompt = promptOfCall(0);
    expect(prompt.startsWith("System: You are a terse assistant.")).toBe(true);
    expect(prompt).toContain("User: hello");
  });

  it("omits the System: line when no system prompt is configured", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("hello");
    expect(promptOfCall(0).startsWith("System:")).toBe(false);
  });

  it("treats a whitespace-only system prompt as absent", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY, system: "   " });
    await convo.send("hello");
    expect(promptOfCall(0).startsWith("System:")).toBe(false);
  });
});

describe("Conversation maxHistoryTurns trimming", () => {
  it("serializes only the last maxHistoryTurns*2 messages (older turns drop off FIFO)", async () => {
    runJobOnSession
      .mockResolvedValueOnce(cannedResult("A1"))
      .mockResolvedValueOnce(cannedResult("A2"))
      .mockResolvedValueOnce(cannedResult("A3"));
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      maxHistoryTurns: 1,
    });

    await convo.send("Q1");
    await convo.send("Q2");
    await convo.send("Q3");

    // On the third send, history is [u:Q1, a:A1, u:Q2, a:A2, u:Q3]; cap*2 = 2,
    // so the prompt keeps only the last 2 messages: a:A2 and u:Q3.
    const thirdPrompt = promptOfCall(2);
    expect(thirdPrompt).toContain("Assistant: A2");
    expect(thirdPrompt).toContain("User: Q3");
    expect(thirdPrompt).not.toContain("Q1");
    expect(thirdPrompt).not.toContain("A1");
    expect(thirdPrompt).not.toContain("Q2");

    expect(convo.messages()).toHaveLength(6);
  });

  it("keeps the system line even when history is trimmed by the cap", async () => {
    runJobOnSession.mockResolvedValueOnce(cannedResult("A1")).mockResolvedValueOnce(cannedResult("A2"));
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      system: "stay terse",
      maxHistoryTurns: 1,
    });
    await convo.send("Q1");
    await convo.send("Q2");
    const secondPrompt = promptOfCall(1);
    expect(secondPrompt.startsWith("System: stay terse")).toBe(true);
  });

  it("defaults to 20 turns when maxHistoryTurns is unset (no premature trimming)", async () => {
    runJobOnSession.mockResolvedValue(cannedResult("ok"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    for (let i = 0; i < 5; i++) await convo.send(`Q${i}`);
    expect(promptOfCall(4)).toContain("User: Q0");
  });
});

describe("chat() functional shortcut", () => {
  it("returns a Conversation instance", () => {
    const convo = chat({ network: "testnet", privateKey: PRIVATE_KEY });
    expect(convo).toBeInstanceOf(Conversation);
  });
});
