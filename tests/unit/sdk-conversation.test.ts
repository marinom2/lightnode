import { describe, it, expect, vi, beforeEach } from "vitest";

// The Conversation helper's only network seam is runInferenceWithKey, imported
// from ./inference.js. Stub the whole module so no SIWE handshake, WebSocket,
// or chain touch happens - each send() resolves with a canned RunInferenceResult
// whose `answer` echoes the prompt it was handed, so we can assert on serialization.
const runInferenceWithKey = vi.fn();
vi.mock("../../sdk/src/inference", () => ({
  runInferenceWithKey: (...args: unknown[]) => runInferenceWithKey(...args),
}));

import { Conversation, chat } from "../../sdk/src/chat";

const PRIVATE_KEY = "0x" + "1".repeat(64);

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

// Pull the prompt out of the Nth runInferenceWithKey call.
function promptOfCall(n: number): string {
  return (runInferenceWithKey.mock.calls[n][0] as { prompt: string }).prompt;
}

beforeEach(() => {
  runInferenceWithKey.mockReset();
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
  it("returns the assistant answer from runInferenceWithKey", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("Fitzgerald"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    const r = await convo.send("Who wrote 'The Great Gatsby'?");
    expect(r.answer).toBe("Fitzgerald");
    // The receipt chain passes through unchanged.
    expect(r.txs.createSession).toBe("0xc");
    expect(r.jobId).toBe(2n);
    expect(runInferenceWithKey).toHaveBeenCalledTimes(1);
  });

  it("returns the running transcript in result.messages", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("Fitzgerald"));
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
    expect(runInferenceWithKey).not.toHaveBeenCalled();
  });

  it("forwards the constructor opts (minus prompt) into runInferenceWithKey", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult());
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      model: "llama3-8b",
      maxRetries: 5,
    });
    await convo.send("hi");
    const callArgs = runInferenceWithKey.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.network).toBe("testnet");
    expect(callArgs.privateKey).toBe(PRIVATE_KEY);
    expect(callArgs.model).toBe("llama3-8b");
    expect(callArgs.maxRetries).toBe(5);
    // The serialized prompt is supplied by send(), overriding any prompt key.
    expect(typeof callArgs.prompt).toBe("string");
  });
});

describe("Conversation history accumulation", () => {
  it("accumulates user + assistant turns across sends and feeds prior turns into the next prompt", async () => {
    runInferenceWithKey.mockResolvedValueOnce(cannedResult("1925")).mockResolvedValueOnce(cannedResult("F. Scott"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });

    await convo.send("In what year?");
    await convo.send("And the author?");

    // messages() reflects both full turns in order.
    expect(convo.messages()).toEqual([
      { role: "user", content: "In what year?" },
      { role: "assistant", content: "1925" },
      { role: "user", content: "And the author?" },
      { role: "assistant", content: "F. Scott" },
    ]);

    // The second prompt must carry the first turn (user + assistant) plus the
    // new user message, with chat turn markers and a trailing "Assistant:".
    const secondPrompt = promptOfCall(1);
    expect(secondPrompt).toContain("User: In what year?");
    expect(secondPrompt).toContain("Assistant: 1925");
    expect(secondPrompt).toContain("User: And the author?");
    expect(secondPrompt.endsWith("Assistant:")).toBe(true);
  });

  it("messages() returns a defensive copy that does not mutate internal history", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("a"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("hi");
    const snapshot = convo.messages();
    snapshot.push({ role: "user", content: "injected" });
    expect(convo.messages()).toHaveLength(2);
  });

  it("reset() clears history so the next send is a fresh first turn", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("x"));
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
    runInferenceWithKey.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({
      network: "testnet",
      privateKey: PRIVATE_KEY,
      system: "  You are a terse assistant.  ",
    });
    await convo.send("hello");
    const prompt = promptOfCall(0);
    // Leading System: line, trimmed.
    expect(prompt.startsWith("System: You are a terse assistant.")).toBe(true);
    expect(prompt).toContain("User: hello");
  });

  it("omits the System: line when no system prompt is configured", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    await convo.send("hello");
    expect(promptOfCall(0).startsWith("System:")).toBe(false);
  });

  it("treats a whitespace-only system prompt as absent", async () => {
    runInferenceWithKey.mockResolvedValue(cannedResult("hi"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY, system: "   " });
    await convo.send("hello");
    expect(promptOfCall(0).startsWith("System:")).toBe(false);
  });
});

describe("Conversation maxHistoryTurns trimming", () => {
  it("serializes only the last maxHistoryTurns*2 messages (older turns drop off FIFO)", async () => {
    // cap = 1 -> only the most recent 2 messages (one prior pair) feed the prompt.
    runInferenceWithKey
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
    // Older turns are trimmed out.
    expect(thirdPrompt).not.toContain("Q1");
    expect(thirdPrompt).not.toContain("A1");
    expect(thirdPrompt).not.toContain("Q2");

    // But full history is still retained internally / returned by messages().
    expect(convo.messages()).toHaveLength(6);
  });

  it("keeps the system line even when history is trimmed by the cap", async () => {
    runInferenceWithKey.mockResolvedValueOnce(cannedResult("A1")).mockResolvedValueOnce(cannedResult("A2"));
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
    runInferenceWithKey.mockResolvedValue(cannedResult("ok"));
    const convo = new Conversation({ network: "testnet", privateKey: PRIVATE_KEY });
    // 5 sends = 10 messages, well under the 40-message (20-turn) cap, so the
    // earliest user message must survive into the latest prompt.
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
