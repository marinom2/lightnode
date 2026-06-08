import { describe, it, expect, vi, beforeEach } from "vitest";

// The Agent's run loop calls runInferenceWithKey once per iteration. There is no
// constructor/option seam for the inference function, so we replace the module
// import. The factory returns a vi.fn() we re-program per test. Both the test's
// "../../sdk/src/inference.js" specifier and agent.ts's "./inference.js" resolve
// to the same module id, so this single mock intercepts the loop's calls.
const inferenceMock = vi.hoisted(() => ({ runInferenceWithKey: vi.fn() }));
vi.mock("../../sdk/src/inference.js", () => inferenceMock);

import { Agent, type AgentTool } from "../../sdk/src/agent";

const runInference = inferenceMock.runInferenceWithKey;

// Queue raw model outputs; each call shifts the next one and the agent parses it.
function queueModelOutputs(outputs: string[]): void {
  let i = 0;
  runInference.mockImplementation(async () => {
    const raw = outputs[Math.min(i++, outputs.length - 1)];
    return { answer: raw };
  });
}

// A constant key the Agent constructor is happy with; never used because the
// inference call is mocked away.
const baseOpts = {
  network: "testnet" as const,
  privateKey: "0x" + "1".repeat(64),
  model: "llama3-8b",
};

beforeEach(() => {
  runInference.mockReset();
});

describe("Agent.run tool execution", () => {
  it("runs the selected tool and threads its result into the next inference prompt", async () => {
    const handler = vi.fn(({ a, b }: Record<string, unknown>) => Number(a) + Number(b));
    const add: AgentTool = {
      name: "add",
      description: "Add two integers.",
      args: { a: "first", b: "second" },
      handler,
    };
    // Turn 1: call the tool. Turn 2: emit the final answer.
    queueModelOutputs(['<tool>add {"a":17,"b":25}</tool>', "<answer>42</answer>"]);

    const agent = new Agent({ ...baseOpts, tools: [add] });
    const result = await agent.run("What is 17 + 25?");

    // The handler ran with the parsed args.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ a: 17, b: 25 });

    // The tool_call step records the handler's return value.
    const toolStep = result.steps.find((s) => s.kind === "tool_call");
    expect(toolStep).toMatchObject({ kind: "tool_call", name: "add", args: { a: 17, b: 25 }, result: 42 });

    // The result was fed back into the SECOND inference prompt as an Observation.
    expect(runInference).toHaveBeenCalledTimes(2);
    const secondPrompt = (runInference.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain("Observation: 42");
    expect(secondPrompt).toContain('<tool>add {"a":17,"b":25}</tool>');

    expect(result.answer).toBe("42");
    expect(result.hitLimit).toBe(false);
    expect(result.iterations).toBe(2);
  });

  it("strips Agent-only fields (tools/maxIterations/onStep/system) before delegating to runInferenceWithKey", async () => {
    queueModelOutputs(["<answer>done</answer>"]);
    const noop: AgentTool = { name: "noop", description: "no-op", args: {}, handler: () => "ok" };
    const agent = new Agent({ ...baseOpts, system: "be terse", tools: [noop], maxIterations: 3, onStep: () => {} });
    await agent.run("hi");

    const passed = runInference.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.tools).toBeUndefined();
    expect(passed.maxIterations).toBeUndefined();
    expect(passed.onStep).toBeUndefined();
    expect(passed.system).toBeUndefined();
    // The passthrough still carries the real inference args.
    expect(passed.network).toBe("testnet");
    expect(passed.model).toBe("llama3-8b");
    // The base system prompt is folded into the composed prompt, not passed as `system`.
    expect((passed.prompt as string)).toContain("be terse");
  });
});

describe("Agent.run error handling", () => {
  it("packages a throwing tool handler as a tool_error step and keeps looping", async () => {
    const boom: AgentTool = {
      name: "boom",
      description: "Always throws.",
      args: {},
      handler: () => {
        throw new Error("kaboom");
      },
    };
    // Turn 1: call the throwing tool. Turn 2: recover with an answer.
    queueModelOutputs(["<tool>boom {}</tool>", "<answer>recovered</answer>"]);

    const agent = new Agent({ ...baseOpts, tools: [boom] });
    const result = await agent.run("go");

    // The throw did NOT crash run(); it became a tool_error step.
    const errStep = result.steps.find((s) => s.kind === "tool_error");
    expect(errStep).toMatchObject({ kind: "tool_error", name: "boom", error: "kaboom" });

    // The error message was threaded back into the next prompt as an Observation.
    const secondPrompt = (runInference.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain("Observation: error: kaboom");

    // The loop continued and produced the final answer.
    expect(result.answer).toBe("recovered");
    expect(result.hitLimit).toBe(false);
    expect(result.iterations).toBe(2);
  });

  it("records a tool_error for an unknown tool name and continues", async () => {
    const real: AgentTool = { name: "real", description: "exists", args: {}, handler: () => "ok" };
    queueModelOutputs(['<tool>ghost {"x":1}</tool>', "<answer>ok then</answer>"]);

    const agent = new Agent({ ...baseOpts, tools: [real] });
    const result = await agent.run("go");

    const errStep = result.steps.find((s) => s.kind === "tool_error");
    expect(errStep).toMatchObject({ kind: "tool_error", name: "ghost", error: 'unknown tool "ghost"' });
    const secondPrompt = (runInference.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('Observation: error: unknown tool "ghost"');
    expect(result.answer).toBe("ok then");
  });
});

describe("Agent.run maxIterations", () => {
  it("stops after maxIterations without an answer and reports hitLimit", async () => {
    const tool: AgentTool = { name: "spin", description: "spins", args: {}, handler: () => "again" };
    // The model never emits <answer>; it keeps calling the tool forever.
    queueModelOutputs(["<tool>spin {}</tool>"]);

    const agent = new Agent({ ...baseOpts, tools: [tool], maxIterations: 3 });
    const result = await agent.run("loop forever");

    expect(runInference).toHaveBeenCalledTimes(3);
    expect(result.iterations).toBe(3);
    expect(result.hitLimit).toBe(true);
    expect(result.answer).toBe("");
  });

  it("clamps a maxIterations below 1 up to a single iteration", async () => {
    const tool: AgentTool = { name: "spin", description: "spins", args: {}, handler: () => "x" };
    queueModelOutputs(["<tool>spin {}</tool>"]);

    const agent = new Agent({ ...baseOpts, tools: [tool], maxIterations: 0 });
    const result = await agent.run("go");

    // Math.max(1, 0) => exactly one inference fired.
    expect(runInference).toHaveBeenCalledTimes(1);
    expect(result.iterations).toBe(1);
    expect(result.hitLimit).toBe(true);
  });
});

describe("Agent.run answer + thoughts", () => {
  it("returns the final <answer> immediately without running any tool", async () => {
    const handler = vi.fn(() => "should not run");
    const tool: AgentTool = { name: "unused", description: "x", args: {}, handler };
    queueModelOutputs(["<answer>direct reply</answer>"]);

    const agent = new Agent({ ...baseOpts, tools: [tool] });
    const result = await agent.run("just answer");

    expect(handler).not.toHaveBeenCalled();
    expect(runInference).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("direct reply");
    expect(result.hitLimit).toBe(false);
    expect(result.steps).toEqual([{ kind: "answer", text: "direct reply" }]);
  });

  it("threads a thought back into the transcript and emits each step via onStep", async () => {
    const seen: string[] = [];
    const tool: AgentTool = { name: "t", description: "x", args: {}, handler: () => "r" };
    // Turn 1: a bare reasoning line (thought). Turn 2: the answer.
    queueModelOutputs(["I will think about this first.", "<answer>final</answer>"]);

    const agent = new Agent({ ...baseOpts, tools: [tool], onStep: (s) => seen.push(s.kind) });
    const result = await agent.run("go");

    // onStep fired for the thought then the answer.
    expect(seen).toEqual(["thought", "answer"]);
    const thought = result.steps.find((s) => s.kind === "thought");
    expect(thought).toMatchObject({ kind: "thought", text: "I will think about this first." });
    // The thought was wrapped in <think> in the next prompt.
    const secondPrompt = (runInference.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain("<think>I will think about this first.</think>");
    expect(result.answer).toBe("final");
  });
});

describe("Agent constructor guards", () => {
  it("rejects construction with no tools", () => {
    expect(() => new Agent({ ...baseOpts, tools: [] })).toThrow(/at least one tool/i);
  });

  it("rejects duplicate tool names", () => {
    const a: AgentTool = { name: "dup", description: "x", args: {}, handler: () => 1 };
    const b: AgentTool = { name: "dup", description: "y", args: {}, handler: () => 2 };
    expect(() => new Agent({ ...baseOpts, tools: [a, b] })).toThrow(/duplicate tool name/i);
  });
});
