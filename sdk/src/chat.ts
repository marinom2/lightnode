/**
 * Multi-turn conversation helper. The conversation HISTORY lives client-side
 * and is serialized into a single prompt per turn, but the on-chain session is
 * REUSED across turns: the first send runs the SIWE handshake and the one
 * createSession tx, and every follow-up turn submits straight onto that open
 * session (one submitJob tx per turn, no second createSession). When the
 * session window expires or the bound worker stops serving, the next send
 * transparently opens a fresh session and retries the turn - history is
 * client-side, so nothing is lost.
 *
 * Usage:
 *
 *   const chat = new Conversation({ network: "testnet", privateKey: "0x..." });
 *   const a = await chat.send("Who wrote 'The Great Gatsby'?");
 *   const b = await chat.send("In what year?");      // 'b' sees the prior turn
 *   console.log(chat.messages());                    // full transcript
 */

import {
  connectWithKey,
  openSession,
  runJobOnSession,
  type KeyConnection,
  type OpenSession,
  type RunInferenceWithKeyArgs,
  type RunInferenceResult,
} from "./inference.js";

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

// Reopen rather than submit when the session window closes within this margin:
// a job submitted seconds before expiry can complete after it and be lost.
const EXPIRY_MARGIN_SEC = 30;

/**
 * One round of `send` returns the assistant's reply plus all the
 * on-chain receipts. `messages()` exposes the running transcript so a UI
 * can render it; `reset()` clears history (the open session is kept - it is
 * prompt-agnostic).
 */
export class Conversation {
  private readonly opts: ConversationOptions;
  private readonly history: ChatMessage[] = [];
  private connection: KeyConnection | null = null;
  private session: OpenSession | null = null;

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

  /** The session currently bound (worker, sessionId, expiry) or null before the first send. */
  currentSession(): OpenSession | null {
    return this.session;
  }

  /**
   * Push a single user message and run one inference turn. The first send
   * opens the session (SIWE + createSession); follow-ups reuse it, so a turn
   * costs one submitJob tx. Returns the assistant's reply plus the standard
   * receipts. The reply is appended to history so the next send sees it.
   */
  async send(message: string): Promise<ConversationSendResult> {
    if (!message?.trim()) throw new Error("Conversation.send: message is empty");

    // 1. Add the new user turn BEFORE serializing so the model sees it.
    this.history.push({ role: "user", content: message });
    const prompt = this.serialize();

    // 2. Run on the open session; on the first failure, assume the session is
    // the problem (expired window, worker gone), reopen once, and retry the
    // SAME turn. A second failure is a real error and propagates.
    try {
      const result = await this.runTurn(prompt, false);
      this.history.push({ role: "assistant", content: result.answer });
      return { ...result, messages: this.messages() };
    } catch (firstError) {
      if (this.opts.signal?.aborted) throw firstError;
      const result = await this.runTurn(prompt, true);
      this.history.push({ role: "assistant", content: result.answer });
      return { ...result, messages: this.messages() };
    }
  }

  private async runTurn(prompt: string, forceReopen: boolean): Promise<RunInferenceResult> {
    const session = await this.ensureSession(forceReopen);
    return runJobOnSession(session, prompt, {
      onChunk: this.opts.onChunk,
      searchEnabled: this.opts.searchEnabled,
      jobCompletedTimeoutMs: this.opts.jobCompletedTimeoutMs,
      WebSocket: this.connection?.WebSocket,
      relayUrl: this.opts.relayUrl,
      signal: this.opts.signal,
    });
  }

  /** Open (or reopen) the underlying session; reuse it while it is healthy. */
  private async ensureSession(forceReopen: boolean): Promise<OpenSession> {
    const expiringSoon =
      this.session !== null && Date.now() / 1000 >= this.session.expirySec - EXPIRY_MARGIN_SEC;
    if (this.session && !forceReopen && !expiringSoon) return this.session;

    if (!this.connection) {
      this.connection = await connectWithKey({
        network: this.opts.network,
        privateKey: this.opts.privateKey,
        gatewayUrl: this.opts.gatewayUrl,
        WebSocket: this.opts.WebSocket,
        signal: this.opts.signal,
      });
    }
    this.session = await openSession({
      gateway: this.connection.gateway,
      wallet: this.connection.wallet,
      publicClient: this.connection.publicClient,
      network: this.connection.network,
      model: this.opts.model,
      ...(this.opts.searchEnabled ? { requiredCapabilities: ["search"] } : {}),
    });
    return this.session;
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
