"use client";

import { useState } from "react";
import { Plus, X, Layers, Loader2, CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { useEncryptedInference, DEFAULT_MODEL } from "@/lib/use-encrypted-inference";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field } from "@/components/build/console/panel-kit";
import { ConnectStrip, isRunning } from "@/components/build/console/inference-flow";
import { cn } from "@/lib/utils";

function batchCode(prompts: string[], concurrency: number, system: string, net: string): string {
  const used = prompts.map((p) => p.trim()).filter(Boolean);
  const list = (used.length ? used : ["Summarize LightChain AI in one sentence.", "Name one risk of centralized inference."])
    .map((p) => `    ${JSON.stringify(p)},`)
    .join("\n");
  const sys = system.trim() ? `\n  system: ${JSON.stringify(system.trim())},` : "";
  return `import { runInferenceBatch } from "lightnode-sdk";

const results = await runInferenceBatch({
  network: "${net}",
  privateKey: process.env.PRIVATE_KEY,
  concurrency: ${concurrency},${sys}
  prompts: [
${list}
  ],
  onSlotComplete: ({ index, result, error }) =>
    console.log(index, error?.message ?? result?.answer),
});

// Results are in submission order; a stalled slot fails on its own.
for (const r of results) console.log(r.index, r.error?.message ?? r.result?.answer);`;
}

type Status = "pending" | "running" | "done" | "error";
interface Row {
  prompt: string;
  status: Status;
  answer?: string;
}

export default function BatchPanel() {
  const { network } = useNetwork();
  const [prompts, setPrompts] = useState<string[]>(["What is Porsche?", "What is Lamborghini?"]);
  const [concurrency, setConcurrency] = useState(4);
  const [system, setSystem] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);

  const { state, run, isConnected, address, wrongChain, expectedChain, cfg, net } = useEncryptedInference();
  const testnet = net === "testnet";

  const setPrompt = (i: number, v: string) => setPrompts((p) => p.map((x, j) => (j === i ? v : x)));
  const addPrompt = () => setPrompts((p) => [...p, ""]);
  const removePrompt = (i: number) => setPrompts((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));

  // Live execution. The wallet signs one job at a time, so the demo runs the
  // prompts sequentially (the concurrency slider shapes the generated Node code,
  // where a funded key can parallelise). Each prompt is one real createSession +
  // submitJob, user-paid.
  const runLive = async () => {
    const used = prompts.map((p) => p.trim()).filter(Boolean);
    if (!used.length || !isConnected || busy) return;
    setBusy(true);
    setRows(used.map((p) => ({ prompt: p, status: "pending" })));
    for (let i = 0; i < used.length; i++) {
      setRows((r) => r?.map((x, j) => (j === i ? { ...x, status: "running" } : x)) ?? null);
      const composed = system.trim() ? `${system.trim()}\n\n${used[i]}` : used[i];
      const res = await run(composed, { model: DEFAULT_MODEL });
      setRows((r) => r?.map((x, j) => (j === i ? { ...x, status: res ? "done" : "error", answer: res?.answer } : x)) ?? null);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Batch"
        title="Batch inference"
        subtitle="Run many prompts as encrypted inferences against the same worker pool - results in submission order, a stalled slot fails on its own. Run it live with your wallet below (user-pays, one job per prompt), or copy the parallel Node call."
      >
        <div className="mb-4">
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

        <PanelGrid>
          <PanelColumn title="Build the call">
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-content-soft">Prompts</span>
                <div className="space-y-2">
                  {prompts.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p}
                        onChange={(e) => setPrompt(i, e.target.value)}
                        placeholder={`Prompt ${i + 1}`}
                        className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60"
                      />
                      <button
                        type="button"
                        onClick={() => removePrompt(i)}
                        aria-label="Remove prompt"
                        className="grid size-8 shrink-0 place-items-center rounded-lg border border-bdr-soft text-content-soft transition-colors hover:text-destructive disabled:opacity-40"
                        disabled={prompts.length <= 1}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addPrompt}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft px-2.5 py-1.5 text-xs font-medium text-content-soft transition-colors hover:text-content-primary"
                >
                  <Plus className="size-3.5" /> Add prompt
                </button>
              </div>
              <Field label="Concurrency (Node code)" hint="Max inferences in flight in the generated call (1-8). The live demo runs sequentially - your wallet signs one at a time.">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="w-full accent-[var(--color-primary,#7064E9)]"
                />
                <span className="mt-1 block text-xs tabular-nums text-content-default">{concurrency} in flight</span>
              </Field>
              <Field label="Shared system prompt (optional)">
                <input
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  placeholder="You are a concise assistant."
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60"
                />
              </Field>
              <button
                type="button"
                onClick={runLive}
                disabled={!isConnected || busy || isRunning(state.phase) || prompts.every((p) => !p.trim())}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[linear-gradient(94deg,#dd00ac_0%,#7130c3_38%,#7064e9_68%,#4f7cf6_100%)] px-4 text-sm font-medium tracking-[0.3px] text-white transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {busy ? "Running batch..." : isConnected ? `Run ${prompts.filter((p) => p.trim()).length} live on ${cfg.label}` : "Connect a wallet to run"}
              </button>
            </div>
          </PanelColumn>

          <PanelColumn title="Results">
            {!rows && <div className="grid min-h-[8rem] place-items-center rounded-xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">Run the batch to see each prompt&apos;s decrypted answer, in order.</div>}
            {rows && (
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-xl border border-bdr-soft p-3">
                    <div className="flex items-center gap-2 text-xs">
                      {r.status === "done" ? (
                        <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                      ) : r.status === "error" ? (
                        <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                      ) : r.status === "running" ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                      ) : (
                        <span className="size-3.5 shrink-0 rounded-full border border-bdr-soft" />
                      )}
                      <span className="truncate font-medium text-content-primary">{r.prompt}</span>
                    </div>
                    {r.status === "running" && state.output && (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-content-soft">{state.output}</p>
                    )}
                    {r.status === "done" && (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-content-default">{r.answer}</p>
                    )}
                    {r.status === "error" && (
                      <p className="mt-1.5 text-xs text-warning">{state.error ?? "This slot failed or was rejected - the others are unaffected."}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </PanelColumn>
        </PanelGrid>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-content-soft">
          <Layers className="size-3.5 text-primary" />
          Each slot is one createSession + submitJob pair on {cfg.label}{testnet ? " (free testnet LCAI)" : " (real LCAI)"}.
        </p>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The same call in Node (parallel)</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: batchCode(prompts, concurrency, system, network) }]} />
        <p className="text-xs text-content-soft">
          Scaffold it into your project:{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add batch</code>.
        </p>
      </section>
    </div>
  );
}
