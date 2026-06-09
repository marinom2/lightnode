"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { Notice } from "@/components/build/console/panel-kit";
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

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok || data.error || !data.answer) {
        setError(data.error ?? "The demo could not complete. Try again shortly.");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.answer as string }]);
    } catch {
      setError("Network error reaching the demo endpoint. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Chat"
        title="Multi-turn chat"
        subtitle="A Conversation keeps history client-side and runs one encrypted inference per turn (one on-chain job each). This panel talks to a shared testnet wallet - free, no key needed."
      >
        <div className="flex h-[28rem] flex-col rounded-2xl border border-bdr-soft bg-card/60 backdrop-blur-sm">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="grid h-full place-items-center text-center text-sm text-content-soft">
                <div>
                  <Sparkles className="mx-auto mb-2 size-5 text-primary" />
                  Start a conversation. Each turn is a real encrypted inference, and the model remembers the thread.
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
            {sending && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-bdr-soft bg-surface-base-faint px-3.5 py-2.5 text-sm text-content-soft">
                  <Loader2 className="size-3.5 animate-spin" /> thinking...
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 pb-2">
              <Notice tone="warn">{error}</Notice>
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
                  void send();
                }
              }}
              placeholder="Type a message, Enter to send..."
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none transition-colors focus:border-primary/60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-content-soft">
          Free on testnet, rate-limited, shared demo wallet. History is sent each turn so the model keeps context.
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
