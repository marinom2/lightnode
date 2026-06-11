/**
 * In-wallet encrypted AI chat. One explicit session consent (model + fee per
 * message), then every message auto-signs its two LightChain transactions with
 * no further confirmations. A running total keeps the spending visible.
 */
import { useEffect, useRef, useState } from "react";
import { humanizeError } from "../../src/rpc/humanize";
import { Ic, Sheet } from "./shared";

type ChatModel = { id: string; name: string; feeLcai: number };
type Msg = { role: "user" | "ai"; text: string };
type Phase = "auth" | "prepare" | "create" | "upload" | "submit" | "stream" | null;

const PHASE_LABEL: Record<Exclude<Phase, null>, string> = {
  auth: "Authenticating…",
  prepare: "Picking a worker…",
  create: "Opening the encrypted session…",
  upload: "Uploading the encrypted prompt…",
  submit: "Paying the job fee…",
  stream: "Thinking…",
};

export function ChatSheet({ from, onClose }: { from: string; onClose: () => void }) {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const [models, setModels] = useState<ChatModel[] | null | undefined>(undefined);
  const [model, setModel] = useState<ChatModel | null>(null);
  const [consented, setConsented] = useState(false);
  const [thread, setThread] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);
  const [sent, setSent] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "lc-chat" });
    portRef.current = port;
    port.onMessage.addListener((m: { type: string; models?: ChatModel[]; phase?: Phase; text?: string; feeLcai?: number; message?: string }) => {
      if (m.type === "models") {
        setModels(m.models ?? []);
        if (m.models?.[0]) setModel(m.models[0]);
      }
      if (m.type === "phase") setPhase(m.phase ?? null);
      if (m.type === "chunk" && m.text) {
        const piece = m.text;
        setPhase("stream");
        setThread((t) => {
          const last = t[t.length - 1];
          if (last?.role === "ai") return [...t.slice(0, -1), { role: "ai" as const, text: last.text + piece }];
          return [...t, { role: "ai" as const, text: piece }];
        });
      }
      if (m.type === "done") {
        setBusy(false);
        setPhase(null);
        setSpent((s) => s + (m.feeLcai ?? 0));
        setSent((n) => n + 1);
      }
      if (m.type === "error") {
        setBusy(false);
        setPhase(null);
        setErr(humanizeError(m.message ?? "Chat failed.", "LCAI"));
      }
    });
    port.onDisconnect.addListener(() => {
      portRef.current = null;
    });
    port.postMessage({ type: "models" });
    return () => port.disconnect();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread, phase]);

  const send = () => {
    const prompt = input.trim();
    if (!prompt || !model || busy || !portRef.current) return;
    setErr(null);
    setBusy(true);
    setInput("");
    setThread((t) => [...t, { role: "user", text: prompt }]);
    portRef.current.postMessage({ type: "send", from, model, prompt });
  };

  const fee = model ? model.feeLcai : 0;

  return (
    <Sheet title="AI Chat" onClose={onClose} busy={busy} dirty={thread.length > 0}>
      {!consented ? (
        <>
          <p className="muted">Private inference on LightChain: your prompt and the answer are end-to-end encrypted between this wallet and the worker that serves it.</p>
          {models === undefined && <span className="skel" style={{ width: 150 }} />}
          {models === null && <p className="err">Could not reach the AI gateway. Try again in a moment.</p>}
          {models && models.length === 0 && <p className="muted">No models are live right now. Check back soon.</p>}
          {models && models.length > 0 && (
            <>
              <div className="chips" style={{ flexWrap: "wrap" }}>
                {models.map((m) => (
                  <button key={m.id} className={`chip${model?.id === m.id ? " active" : ""}`} onClick={() => setModel(m)}>{m.name}</button>
                ))}
              </div>
              <div className="card" style={{ padding: 10 }}>
                <div className="row between"><span className="muted">Fee per message</span><b>{fee} LCAI + gas</b></div>
                <div className="row between"><span className="faint">Runs on</span><span className="faint">LightChain</span></div>
              </div>
              <p className="faint">Approve once: every message in this session then signs its two LightChain transactions automatically, with the running total shown. Closing this sheet ends the session.</p>
              <button onClick={() => setConsented(true)}>Start chat session</button>
            </>
          )}
        </>
      ) : (
        <>
          <div className="row between" style={{ fontSize: 11 }}>
            <span className="faint">{model?.name} · {fee} LCAI per message</span>
            <span className="faint">{sent} sent · {spent.toLocaleString(undefined, { maximumFractionDigits: 4 })} LCAI spent</span>
          </div>
          <div className="chat-thread">
            {thread.length === 0 && <div className="empty" style={{ padding: "30px 8px" }}>Encrypted, on-chain, yours. Ask anything.</div>}
            {thread.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-ai"}`}>{m.text}</div>
            ))}
            {busy && <p className="faint" style={{ margin: "2px 4px" }}>{phase ? PHASE_LABEL[phase] : "Working…"}</p>}
            <div ref={endRef} />
          </div>
          {err && <p className="err">{err}</p>}
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Message…"
              value={input}
              disabled={busy}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button style={{ flexShrink: 0, padding: "11px 16px" }} disabled={busy || !input.trim()} onClick={send}><Ic name="send" size={15} /></button>
          </div>
        </>
      )}
    </Sheet>
  );
}
