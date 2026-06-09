"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, Wallet2 } from "lucide-react";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import {
  PanelGrid,
  PanelColumn,
  Field,
  RunButton,
  ResponseEmpty,
  ProofRow,
  Notice,
  short,
} from "@/components/build/console/panel-kit";

const DEFAULT_PROMPT = "Reply with a one-sentence fun fact about the ocean.";
const TESTNET_EXPLORER = NETWORKS.testnet.explorer;

const SNIPPET = `import { runInferenceWithKey } from "lightnode-sdk";

const { answer, txs } = await runInferenceWithKey({
  network: "testnet",                  // or "mainnet"
  privateKey: process.env.PRIVATE_KEY,  // 0x... funded key
  prompt: "Reply with a one-sentence fun fact about the ocean.",
});

console.log(answer);          // the decrypted reply
console.log(txs.submitJob);   // verifiable on-chain receipt`;

interface Result {
  answer: string;
  jobId?: string;
  worker?: string;
  elapsedMs: number;
}
interface Err {
  message: string;
  howTo?: string;
}

export default function InferencePanel() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (status === "running") {
      startRef.current = Date.now();
      tickRef.current = setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [status]);

  const run = async () => {
    if (!prompt.trim()) return;
    setStatus("running");
    setResult(null);
    setErr(null);
    setElapsed(0);
    const started = Date.now();
    try {
      const res = await fetch("/api/chat-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt.trim() }),
      });
      const data = (await res.json()) as { answer?: string; jobId?: string; worker?: string; error?: string; howTo?: string };
      if (!res.ok || data.error || !data.answer) {
        setErr({ message: data.error ?? "The demo could not complete. Try again shortly.", howTo: data.howTo });
        setStatus("error");
        return;
      }
      setResult({ answer: data.answer, jobId: data.jobId, worker: data.worker, elapsedMs: Date.now() - started });
      setStatus("done");
    } catch {
      setErr({ message: "Network error reaching the demo endpoint. Try again." });
      setStatus("error");
    }
  };

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Inference"
        title="Encrypted inference"
        subtitle="Send an encrypted prompt and get a verifiable answer back. This panel runs a real inference on a shared testnet wallet - no key, no wallet, free. For the full wallet-signed flow with all three on-chain proofs, open the Playground."
        actions={
          <Link
            href="/playground"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-bdr-soft bg-surface-base-subtle px-3 py-2 text-sm font-medium text-content-default transition-colors hover:border-primary/40 hover:text-content-primary"
          >
            <Wallet2 className="size-4" /> Wallet-signed flow <ArrowRight className="size-3.5" />
          </Link>
        }
      >
        <PanelGrid>
          <PanelColumn title="Request">
            <div className="space-y-4">
              <Field label="Model">
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft bg-surface-base-faint px-2.5 py-1.5 text-sm text-content-default">
                  <Sparkles className="size-3.5 text-primary" /> llama3-8b
                </div>
              </Field>
              <Field label="Prompt" hint="Runs one real testnet inference on a shared demo wallet (rate-limited).">
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask the model anything..."
                  className="w-full rounded-xl border border-bdr-soft bg-surface-base-faint p-3 font-mono text-sm leading-relaxed text-content-primary outline-none transition-colors focus:border-primary/60"
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-soft">Free on testnet</span>
                <RunButton running={status === "running"} disabled={!prompt.trim()} onClick={run} idle="Run inference" busy="Running..." />
              </div>
            </div>
          </PanelColumn>

          <PanelColumn
            title="Response"
            badge={
              status === "running" ? (
                <span className="font-mono text-[11px] text-content-soft">{(elapsed / 1000).toFixed(1)}s</span>
              ) : result ? (
                <span className="font-mono text-[11px] text-content-soft">{(result.elapsedMs / 1000).toFixed(1)}s</span>
              ) : null
            }
          >
            {status === "idle" && (
              <ResponseEmpty>Type a prompt and Run to see a real decrypted answer plus its on-chain job.</ResponseEmpty>
            )}
            {status === "running" && (
              <ResponseEmpty>
                Negotiating an encrypted session, submitting on-chain, and streaming the worker&apos;s reply. First testnet calls can take 10-60s.
              </ResponseEmpty>
            )}
            {status === "error" && err && (
              <div className="space-y-3">
                <Notice tone="warn">{err.message}</Notice>
                {err.howTo && <CodeTabs tabs={[{ label: "run it locally", code: err.howTo }]} />}
              </div>
            )}
            {status === "done" && result && (
              <div className="space-y-3">
                <p className="whitespace-pre-wrap rounded-xl border border-bdr-soft bg-surface-base-faint p-3.5 text-sm leading-relaxed text-content-default">
                  {result.answer}
                </p>
                <div className="rounded-xl border border-bdr-soft p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">On-chain</p>
                  {result.jobId && <ProofRow label="jobId" value={result.jobId} />}
                  {result.worker && (
                    <ProofRow label="worker" value={short(result.worker)} href={`${TESTNET_EXPLORER}/address/${result.worker}`} />
                  )}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-content-soft">
                    The answer was decrypted with your session key, and the job is recorded on-chain - the same proof chain the wallet-signed flow shows in full.
                  </p>
                </div>
              </div>
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK call this panel makes</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Same five-line call any dApp uses. Drop it into a project with{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add inference</code>.
        </p>
      </section>
    </div>
  );
}
