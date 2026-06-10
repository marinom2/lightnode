import { runInferenceWithKey, type RunInferenceWithKeyArgs } from "./inference.js";

/**
 * One tool the agent can call. The model decides when by emitting a tool
 * call block; the handler returns plain JSON which is threaded back into
 * the next turn as an observation.
 *
 * The handler MUST return JSON-serializable data so the model can read
 * it back. Use `String()` to stringify primitives, `JSON.stringify`-able
 * objects otherwise.
 */
export interface AgentTool {
  /** Short snake_case name. The model uses this exact string in tool calls. */
  name: string;
  /** One-line description shown to the model so it knows when to use the tool. */
  description: string;
  /**
   * Argument schema, very informal: { argName: "string description" }. The
   * model is told to fill in matching JSON values; the SDK does not enforce
   * types beyond JSON parsing.
   */
  args: Record<string, string>;
  /** Run the tool. Return JSON-serializable data (string, number, object, etc.). */
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** One step in the agent's reasoning loop. */
export type AgentStep =
  | { kind: "thought"; text: string }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; result: unknown }
  | { kind: "tool_error"; name: string; args: Record<string, unknown>; error: string }
  | { kind: "answer"; text: string };

export interface AgentRunResult {
  /** The model's final answer. May be empty if maxIterations was hit. */
  answer: string;
  /** Every step taken (thoughts + tool calls + final answer). Useful for debugging + UI. */
  steps: AgentStep[];
  /** Total inferences fired. Each iteration is one inference, so this is also iteration count. */
  iterations: number;
  /** True if the loop bailed because it ran out of iterations without an `answer` block. */
  hitLimit: boolean;
}

/** How the agent runs each inference: with a funded key (Node), OR an injected
 *  function (e.g. a browser wallet flow) so the SAME loop runs anywhere. */
export type AgentInferenceBackend =
  | Omit<RunInferenceWithKeyArgs, "prompt" | "system">
  | { inferenceFn: (args: { prompt: string }) => Promise<{ answer: string }> };

export type AgentOptions = AgentInferenceBackend & {
  /** Human-readable goal / persona. Becomes the BASE system prompt; the tool harness is appended automatically. */
  system?: string;
  /** Tools the model is allowed to call. */
  tools: ReadonlyArray<AgentTool>;
  /** Hard cap on reasoning steps. Default 5. */
  maxIterations?: number;
  /** Called after every step (thought / tool call / answer). Useful for live UI. */
  onStep?: (step: AgentStep) => void;
};

/**
 * ReAct-style agent on top of `runInferenceWithKey`. Each iteration:
 *   1. The SDK sends a system prompt that lists tools + the JSON tool-call
 *      format to the model, plus the running transcript.
 *   2. The model emits either a tool call (`<tool>name {"k":"v"}</tool>`)
 *      or a final answer (`<answer>...</answer>`).
 *   3. The SDK parses, runs the tool, threads the result back, repeats.
 *
 * Designed for smaller open models (llama3-8b). The protocol is simple
 * string markers, not native function calling, so it works on any model
 * the LightChain network exposes.
 *
 * @example
 * ```ts
 * import { Agent } from "lightnode-sdk";
 *
 * const agent = new Agent({
 *   network: "testnet",
 *   privateKey: process.env.PRIVATE_KEY!,
 *   model: "llama3-8b",
 *   system: "You are a careful research assistant.",
 *   tools: [
 *     {
 *       name: "add",
 *       description: "Add two integers and return the sum.",
 *       args: { a: "first integer", b: "second integer" },
 *       handler: ({ a, b }) => Number(a) + Number(b),
 *     },
 *   ],
 *   maxIterations: 3,
 * });
 *
 * const { answer, steps } = await agent.run("What is 17 + 25?");
 * console.log(answer); // "42"
 * ```
 */
export class Agent {
  private readonly opts: AgentOptions;

  constructor(opts: AgentOptions) {
    if (!opts.tools || opts.tools.length === 0) {
      throw new Error("Agent: at least one tool is required (use runInferenceWithKey for plain inference)");
    }
    // Tool names must be unique - the SDK matches model-emitted names by
    // string and a dup would silently route to the wrong handler.
    const seen = new Set<string>();
    for (const t of opts.tools) {
      if (seen.has(t.name)) throw new Error(`Agent: duplicate tool name "${t.name}"`);
      seen.add(t.name);
    }
    this.opts = opts;
  }

  async run(userMessage: string): Promise<AgentRunResult> {
    const maxIter = Math.max(1, this.opts.maxIterations ?? 5);
    const steps: AgentStep[] = [];
    const transcript: string[] = [`User: ${userMessage}`];
    const system = this.buildSystemPrompt();

    let iterations = 0;
    // The inference backend: an injected fn (browser wallet, mock, ...) when
    // provided, else runInferenceWithKey with the funded key. The agent loop is
    // identical either way.
    const opts = this.opts as Record<string, unknown>;
    const injected =
      typeof opts.inferenceFn === "function"
        ? (opts.inferenceFn as (a: { prompt: string }) => Promise<{ answer: string }>)
        : null;
    // Strip Agent-only fields before passing through to runInferenceWithKey.
    const passthrough = { ...this.opts } as Partial<AgentOptions> & { inferenceFn?: unknown };
    delete passthrough.tools;
    delete passthrough.maxIterations;
    delete passthrough.onStep;
    delete passthrough.system;
    delete passthrough.inferenceFn;
    while (iterations < maxIter) {
      iterations++;
      const prompt = `${system}\n\n${transcript.join("\n\n")}\n\nAssistant:`;
      const { answer: raw } = injected
        ? await injected({ prompt })
        : await runInferenceWithKey({ ...(passthrough as RunInferenceWithKeyArgs), prompt });
      const parsed = parseAgentOutput(raw);
      if (parsed.kind === "answer") {
        const step: AgentStep = { kind: "answer", text: parsed.text };
        steps.push(step);
        this.opts.onStep?.(step);
        return { answer: parsed.text, steps, iterations, hitLimit: false };
      }
      if (parsed.kind === "thought") {
        const step: AgentStep = { kind: "thought", text: parsed.text };
        steps.push(step);
        this.opts.onStep?.(step);
        transcript.push(`Assistant: <think>${parsed.text}</think>`);
        continue;
      }
      // tool_call: look up + execute
      const tool = this.opts.tools.find((t) => t.name === parsed.name);
      if (!tool) {
        const step: AgentStep = {
          kind: "tool_error",
          name: parsed.name,
          args: parsed.args,
          error: `unknown tool "${parsed.name}"`,
        };
        steps.push(step);
        this.opts.onStep?.(step);
        transcript.push(`Assistant: <tool>${parsed.name} ${JSON.stringify(parsed.args)}</tool>`);
        transcript.push(`Observation: error: unknown tool "${parsed.name}"`);
        continue;
      }
      try {
        const result = await tool.handler(parsed.args);
        const step: AgentStep = { kind: "tool_call", name: parsed.name, args: parsed.args, result };
        steps.push(step);
        this.opts.onStep?.(step);
        transcript.push(`Assistant: <tool>${parsed.name} ${JSON.stringify(parsed.args)}</tool>`);
        transcript.push(`Observation: ${JSON.stringify(result)}`);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        const step: AgentStep = {
          kind: "tool_error",
          name: parsed.name,
          args: parsed.args,
          error: msg,
        };
        steps.push(step);
        this.opts.onStep?.(step);
        transcript.push(`Assistant: <tool>${parsed.name} ${JSON.stringify(parsed.args)}</tool>`);
        transcript.push(`Observation: error: ${msg}`);
      }
    }
    return { answer: "", steps, iterations, hitLimit: true };
  }

  private buildSystemPrompt(): string {
    const base = this.opts.system?.trim() ?? "You are a helpful assistant.";
    const toolDocs = this.opts.tools
      .map((t) => {
        const argList = Object.entries(t.args)
          .map(([k, v]) => `    "${k}": <${v}>`)
          .join(",\n");
        return `- ${t.name}: ${t.description}\n  Call as: <tool>${t.name} {\n${argList}\n  }</tool>`;
      })
      .join("\n");
    return `${base}

You have access to these tools:
${toolDocs}

To call a tool, write EXACTLY one line:
<tool>tool_name {"arg":"value"}</tool>

After the tool runs, the user will reply with: Observation: <json>

When you are done, respond with EXACTLY:
<answer>your final reply to the user</answer>

Use one tool at a time. Do not invent tools. Keep observations short.`;
  }
}

type ParsedOutput =
  | { kind: "tool_call"; name: string; args: Record<string, unknown> }
  | { kind: "answer"; text: string }
  | { kind: "thought"; text: string };

/**
 * Parse the model's raw output into either a tool call, a final answer, or
 * a thought (everything else). Tolerant of whitespace and the model
 * forgetting to close a tag. Visible for testing.
 */
export function parseAgentOutput(raw: string): ParsedOutput {
  const answer = raw.match(/<answer>([\s\S]*?)(?:<\/answer>|$)/i);
  if (answer) return { kind: "answer", text: answer[1].trim() };
  const tool = raw.match(/<tool>\s*([a-zA-Z_][\w-]*)\s*(\{[\s\S]*?\})\s*(?:<\/tool>|$)/i);
  if (tool) {
    const name = tool[1];
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(tool[2]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // best-effort: leave args empty so the handler sees missing fields
    }
    return { kind: "tool_call", name, args };
  }
  return { kind: "thought", text: raw.trim() };
}
