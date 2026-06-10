"use client";

import { useState } from "react";
import { Plus, X, Layers } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field } from "@/components/build/console/panel-kit";

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

export default function BatchPanel() {
  const { network } = useNetwork();
  const [prompts, setPrompts] = useState<string[]>(["", ""]);
  const [concurrency, setConcurrency] = useState(4);
  const [system, setSystem] = useState("");

  const setPrompt = (i: number, v: string) => setPrompts((p) => p.map((x, j) => (j === i ? v : x)));
  const addPrompt = () => setPrompts((p) => [...p, ""]);
  const removePrompt = (i: number) => setPrompts((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : p));

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Batch"
        title="Batch inference"
        subtitle="Run many prompts as parallel encrypted inferences against the same worker pool - capped concurrency, results in submission order, and a stalled slot fails on its own instead of taking down the batch. A batch is many real jobs, so build the exact call here and run it locally or in StackBlitz."
      >
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
              <Field label="Concurrency" hint="Max inferences in flight at once (1-8).">
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
            </div>
          </PanelColumn>

          <div className="flex flex-col gap-2">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Generated call</span>
            <CodeTabs tabs={[{ label: "TypeScript", code: batchCode(prompts, concurrency, system, network) }]} />
            <p className="px-1 text-[11px] text-content-soft">
              <Layers className="mr-1 inline size-3.5 text-primary" />
              Each slot is one createSession + submitJob pair, so concurrency also caps wallet-nonce pressure.
            </p>
          </div>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-2">
        <p className="text-xs text-content-soft">
          Run it with your funded key locally or in{" "}
          <a href="https://github.com/marinom2/lightnode-examples" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            the examples repo
          </a>
          . Full options in the <a href="/build/reference" className="text-primary hover:underline">SDK reference</a>.
        </p>
      </section>
    </div>
  );
}
