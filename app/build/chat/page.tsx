"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { ConnectStrip, FlowError, isRunning, phaseLabel } from "@/components/build/console/inference-flow";
import { useEncryptedInference } from "@/lib/use-encrypted-inference";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SNIPPET = `import { Conversation } from "lightnode-sdk";

const chat = new Conversation({
  network: "testnet",
  privateKey: process.env.PRIVATE_KEY,
  system: "You are a concise assistant.",
});

const a = await chat.send("What is LightChain AI?");
const b = await chat.send("And how do workers earn?"); // remembers context
console.log(a.answer, b.answer);`;

// Multi-turn over a single-shot SDK call: each turn replays the running
// transcript as the prompt so the model keeps context, then runs one
// wallet-signed encrypted inference (one on-chain job) for it.
function composePrompt(history: Msg[], userText: string): string {
  const lines = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  lines.push(`User: ${userText}`);
  lines.push("Assistant:");
  return lines.join("\n");
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // True between a send() and the assistant turn being committed - so the
  // phase->done effect commits exactly once.
  const awaitingRef = useRef(false);

  const { state, run, isConnected, address, wrongChain, expectedChain, cfg, net } = useEncryptedInference();
  const running = isRunning(state.phase);
  const testnet = net === "testnet";

  // Commit the decrypted answer to the transcript when a turn completes.
  useEffect(() => {
    if (!awaitingRef.current) return;
    if (state.phase === "done") {
      awaitingRef.current = false;
      const answer = state.output.trim();
      if (answer) setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } else if (state.phase === "error") {
      awaitingRef.current = false;
    }
  }, [state.phase, state.output]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, state.phase, state.output]);

  const send = () => {
    const text = input.trim();
    if (!text || running || !isConnected) return;
    const composed = composePrompt(messages, text);
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    awaitingRef.current = true;
    void run(composed);
  };

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Chat"
        title="Multi-turn chat"
        subtitle="A conversation keeps history client-side and runs one encrypted inference per turn (one on-chain job each), signed and paid by your own connected wallet."
      >
        <div className="mb-3">
          <ConnectStrip
            label={cfg.label}
            chainId={cfg.chainId}
            isConnected={isConnected}
            address={address}
            wrongChain={wrongChain}
            expectedChain={expectedChain}
            testnet={testnet}
          />
        </div>

        <div className="flex h-[28rem] flex-col rounded-2xl border border-bdr-soft bg-card/60 backdrop-blur-sm">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && !running && (
              <div className="grid h-full place-items-center text-center text-sm text-content-soft">
                <div>
                  <Sparkles className="mx-auto mb-2 size-5 text-primary" />
                  Connect your wallet and start a conversation. Each turn is a real encrypted inference, and the model
                  remembers the thread.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-primary/15 text-content-primary"
                      : "border border-bdr-soft bg-surface-base-faint text-content-default",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {running && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-bdr-soft bg-surface-base-faint px-3.5 py-2.5 text-sm leading-relaxed text-content-default">
                  {state.output ? (
                    <span className="whitespace-pre-wrap">{state.output}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-content-soft">
                      <Loader2 className="size-3.5 animate-spin" /> {phaseLabel(state.phase)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {state.error && (
            <div className="px-4 pb-2">
              <FlowError message={state.error} />
            </div>
          )}

          <div className="flex items-end gap-2 border-t border-bdr-soft p-3">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={isConnected ? "Type a message, Enter to send..." : "Connect a wallet to chat..."}
              disabled={!isConnected}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none transition-colors focus:border-primary/60 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={send}
              disabled={running || !input.trim() || !isConnected}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-content-soft">
          {testnet ? "Free testnet LCAI" : "Real LCAI"} per turn. History is replayed each turn so the model keeps
          context; your wallet signs createSession + submitJob each time.
        </p>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK call this panel makes</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Drop a chat UI into your project with{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add chat</code>.
        </p>
      </section>
    </div>
  );
}
