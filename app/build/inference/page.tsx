"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, Wallet2 } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import {
  PanelGrid,
  PanelColumn,
  Field,
  RunButton,
  ResponseEmpty,
} from "@/components/build/console/panel-kit";
import { ConnectStrip, PhaseLine, FlowProofs, FlowError, isRunning } from "@/components/build/console/inference-flow";
import { useEncryptedInference, DEFAULT_MODEL } from "@/lib/use-encrypted-inference";

const DEFAULT_PROMPT = "Reply with a one-sentence fun fact about the ocean.";

const snippet = (net: string) => `import { runInferenceWithKey } from "lightnode-sdk";

const { answer, txs } = await runInferenceWithKey({
  network: "${net}",
  privateKey: process.env.PRIVATE_KEY,  // 0x... funded key
  prompt: "Reply with a one-sentence fun fact about the ocean.",
});

console.log(answer);          // the decrypted reply
console.log(txs.submitJob);   // verifiable on-chain receipt`;

export default function InferencePanel() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const { state, run, reset, isConnected, address, wrongChain, expectedChain, cfg, explorer, net } =
    useEncryptedInference();

  const running = isRunning(state.phase);
  const testnet = net === "testnet";

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Inference"
        title="Encrypted inference"
        subtitle="Send an encrypted prompt and get a verifiable answer back - signed and paid by your own connected wallet, the exact flow any dApp runs. Switch network from the toggle in the top bar."
        actions={
          <Link
            href="/playground"
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-bdr-soft bg-surface-base-subtle px-3 py-2 text-sm font-medium text-content-default transition-colors hover:border-primary/40 hover:text-content-primary"
          >
            <Wallet2 className="size-4" /> Full playground <ArrowRight className="size-3.5" />
          </Link>
        }
      >
        <PanelGrid>
          <PanelColumn title="Request">
            <div className="space-y-4">
              <ConnectStrip
                label={cfg.label}
                chainId={cfg.chainId}
                isConnected={isConnected}
                address={address}
                wrongChain={wrongChain}
                expectedChain={expectedChain}
                testnet={testnet}
              />
              <Field label="Model">
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft bg-surface-base-faint px-2.5 py-1.5 text-sm text-content-default">
                  <Sparkles className="size-3.5 text-primary" /> {DEFAULT_MODEL}
                </div>
              </Field>
              <Field
                label="Prompt"
                hint={
                  testnet
                    ? "Runs one real inference. Free testnet LCAI - your wallet signs createSession + submitJob."
                    : "Runs one real inference. Costs real LCAI - your wallet signs createSession + submitJob."
                }
              >
                <textarea
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask the model anything..."
                  className="w-full rounded-xl border border-bdr-soft bg-surface-base-faint p-3 font-mono text-sm leading-relaxed text-content-primary outline-none transition-colors focus:border-primary/60"
                />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-soft">
                  {state.feeLcai != null ? `${state.feeLcai} LCAI` : "~0.02 LCAI"} {testnet ? "(free testnet)" : "(real)"} per call
                </span>
                <div className="flex items-center gap-2">
                  {(state.phase === "done" || state.phase === "error") && (
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-[10px] border border-bdr-soft px-3 py-2 text-sm text-content-soft transition-colors hover:text-content-primary"
                    >
                      Reset
                    </button>
                  )}
                  <RunButton
                    running={running}
                    disabled={!isConnected || !prompt.trim()}
                    onClick={() => void run(prompt, { model: DEFAULT_MODEL })}
                    idle={isConnected ? "Run inference" : "Connect a wallet to run"}
                    busy="Running..."
                  />
                </div>
              </div>
            </div>
          </PanelColumn>

          <PanelColumn
            title="Response"
            badge={
              running ? (
                <span className="font-mono text-[11px] text-content-soft">{(state.elapsedMs / 1000).toFixed(1)}s</span>
              ) : state.phase === "done" ? (
                <span className="font-mono text-[11px] text-content-soft">{(state.elapsedMs / 1000).toFixed(1)}s</span>
              ) : null
            }
          >
            <div className="space-y-3">
              {state.phase === "idle" && !state.output && (
                <ResponseEmpty>
                  Connect your wallet, type a prompt, and Run to see a real decrypted answer plus its on-chain proofs.
                </ResponseEmpty>
              )}
              <PhaseLine state={state} />
              {state.error && <FlowError message={state.error} />}
              {state.output && (
                <p className="whitespace-pre-wrap rounded-xl border border-bdr-soft bg-surface-base-faint p-3.5 text-sm leading-relaxed text-content-default">
                  {state.output}
                </p>
              )}
              <FlowProofs state={state} explorer={explorer} />
            </div>
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK call this panel makes</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: snippet(net) }]} />
        <p className="text-xs text-content-soft">
          Same five-line call any dApp uses. Drop it into a project with{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add inference</code>.
        </p>
      </section>
    </div>
  );
}
