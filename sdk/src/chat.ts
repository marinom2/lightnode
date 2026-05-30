/**
 * Multi-turn conversation helper. The LightChain inference protocol is
 * single-turn at the session level (one createSession + one submitJob =
 * one answer), but stateful chat is the most common builder need. So this
 * keeps the conversation HISTORY client-side, serializes it into a single
 * prompt per turn, and runs one full encrypted inference per turn under
 * the hood. To the protocol it looks like N independent jobs; to the
 * caller it reads as a coherent chat.
 *
 * Usage:
 *
 *   const chat = new Conversation({ network: "testnet", privateKey: "0x..." });
 *   const a = await chat.send("Who wrote 'The Great Gatsby'?");
 *   const b = await chat.send("In what year?");      // 'b' sees the prior turn
 *   console.log(chat.messages());                    // full transcript
 */

import { runInferenceWithKey, type RunInferenceWithKeyArgs, type RunInferenceResult } from "./inference.js";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ConversationOptions extends Omit<RunInferenceWithKeyArgs, "prompt"> {
  /**
   * Initial system message (optional). Prepended to the serialized prompt on
   * every turn. Use for persona, response constraints, or guardrails.
   */
  system?: string;
  /**
   * Cap how many prior turns are serialized into each new prompt. Older
   * turns drop off in FIFO order. Default 20. Models tolerate longer
   * histories but per-call fees scale with prompt length on token-priced
   * networks.
   */
  maxHistoryTurns?: number;
}

export interface ConversationSendResult extends RunInferenceResult {
  /** Updated transcript after this turn (includes the latest user + assistant pair). */
  messages: ChatMessage[];
}

/**
 * One round of `send` returns the assistant's reply plus all the
 * on-chain receipts. `messages()` exposes the running transcript so a UI
 * can render it; `reset()` clears history.
 */
export class Conversation {
  private readonly opts: ConversationOptions;
  private readonly history: ChatMessage[] = [];

  constructor(opts: ConversationOptions) {
    if (!opts.network) throw new Error("Conversation: network is required");
    if (!opts.privateKey) throw new Error("Conversation: privateKey is required");
    this.opts = opts;
  }

  /** Read-only snapshot of the conversation so far. */
  messages(): ChatMessage[] {
    return [...this.history];
  }

  /** Drop the running history (the next send becomes a fresh first turn). */
  reset(): void {
    this.history.length = 0;
  }

  /**
   * Push a single user message and run one full inference. Returns the
   * assistant's reply plus the standard runInference result (txs, worker,
   * jobId). The assistant's reply is automatically appended to history so
   * the next send sees it.
   */
  async send(message: string): Promise<ConversationSendResult> {
    if (!message?.trim()) throw new Error("Conversation.send: message is empty");

    // 1. Add the new user turn BEFORE serializing so the model sees it.
    this.history.push({ role: "user", content: message });

    // 2. Build the serialized prompt: system (if any) + last N turns.
    const prompt = this.serialize();

    // 3. Run one full encrypted inference with the conversation as prompt.
    const result = await runInferenceWithKey({
      ...this.opts,
      prompt,
    });

    // 4. Append the assistant's reply and return.
    this.history.push({ role: "assistant", content: result.answer });
    return { ...result, messages: this.messages() };
  }

  /**
   * Format the current history as a single text prompt the model can read.
   * Chat-style turn markers ("User:" / "Assistant:") since the protocol's
   * llama3-8b serving stack treats prompts as raw text and any reasonable
   * formatting works. Uses the configured max-history-turns cap.
   */
  private serialize(): string {
    const cap = this.opts.maxHistoryTurns ?? 20;
    // A "turn" here is one message; cap*2 messages = cap user+assistant pairs.
    const recent = this.history.slice(Math.max(0, this.history.length - cap * 2));
    const sys = this.opts.system?.trim();
    const lines: string[] = [];
    if (sys) lines.push(`System: ${sys}`);
    for (const m of recent) {
      const tag = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
      lines.push(`${tag}: ${m.content}`);
    }
    // Trailing prompt for the model to continue from.
    lines.push("Assistant:");
    return lines.join("\n");
  }
}

/** Functional shortcut for `new Conversation(opts)` so it reads inline. */
export function chat(opts: ConversationOptions): Conversation {
  return new Conversation(opts);
}
