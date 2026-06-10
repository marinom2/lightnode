"use client";

import { useState } from "react";
import { Bot, ArrowRight, Brain, Wrench, Eye, CheckCircle2, Play, Loader2, AlertTriangle } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { Agent, type AgentTool, type AgentStep, type AgentRunResult } from "lightnode-sdk";
import { useEncryptedInference, DEFAULT_MODEL } from "@/lib/use-encrypted-inference";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field } from "@/components/build/console/panel-kit";
import { ConnectStrip, isRunning, phaseLabel } from "@/components/build/console/inference-flow";
import { cn } from "@/lib/utils";

const TOOL_DEFS: Record<string, { label: string; desc: string; code: string; tool: AgentTool }> = {
  add: {
    label: "add",
    desc: "Add two numbers",
    tool: { name: "add", description: "Add two numbers", args: { a: "number", b: "number" }, handler: ({ a, b }) => Number(a) + Number(b) },
    code: `    {
      name: "add",
      description: "Add two numbers",
      args: { a: "number", b: "number" },
      handler: ({ a, b }) => Number(a) + Number(b),
    },`,
  },
  now: {
    label: "now",
    desc: "Current ISO timestamp",
    tool: { name: "now", description: "Current ISO timestamp", args: {}, handler: () => new Date().toISOString() },
    code: `    {
      name: "now",
      description: "Current ISO timestamp",
      args: {},
      handler: () => new Date().toISOString(),
    },`,
  },
  fetchTitle: {
    label: "fetch_title",
    desc: "Fetch a URL's <title>",
    tool: {
      name: "fetch_title",
      description: "Fetch the <title> of a web page",
      args: { url: "string" },
      handler: async ({ url }) => {
        const html = await (await fetch(String(url))).text();
        return html.match(/<title>(.*?)<\/title>/i)?.[1] ?? "(no title)";
      },
    },
    code: `    {
      name: "fetch_title",
      description: "Fetch the <title> of a web page",
      args: { url: "string" },
      handler: async ({ url }) => {
        const html = await (await fetch(String(url))).text();
        return html.match(/<title>(.*?)<\\/title>/i)?.[1] ?? "(no title)";
      },
    },`,
  },
};

function agentCode(task: string, tools: string[], maxIterations: number, net: string): string {
  const blocks = (tools.length ? tools : ["add", "now"]).map((t) => TOOL_DEFS[t].code).join("\n");
  const t = task.trim() || "What is 21 + 21, and what time is it now?";
  return `import { Agent } from "lightnode-sdk";

const agent = new Agent({
  network: "${net}",
  privateKey: process.env.PRIVATE_KEY,
  maxIterations: ${maxIterations},
  tools: [
${blocks}
  ],
});

const { answer, steps } = await agent.run(${JSON.stringify(t)});
console.log(answer);
console.log(steps.map((s) => s.kind)); // thought / tool_call / answer`;
}

const LOOP = [
  { icon: Brain, label: "Thought" },
  { icon: Wrench, label: "Tool call" },
  { icon: Eye, label: "Observation" },
  { icon: CheckCircle2, label: "Answer" },
];

function StepView({ step }: { step: AgentStep }) {
  if (step.kind === "thought")
    return (
      <div className="flex items-start gap-2 text-xs">
        <Brain className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span className="italic text-content-soft">{step.text}</span>
      </div>
    );
  if (step.kind === "tool_call")
    return (
      <div className="flex items-start gap-2 text-xs">
        <Wrench className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span className="text-content-default">
          <span className="font-mono">{step.name}({JSON.stringify(step.args)})</span> → <span className="font-mono text-success">{JSON.stringify(step.result)}</span>
        </span>
      </div>
    );
  if (step.kind === "tool_error")
    return (
      <div className="flex items-start gap-2 text-xs">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
        <span className="text-warning">{step.name}: {step.error}</span>
      </div>
    );
  return (
    <div className="flex items-start gap-2 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      <span className="font-medium text-content-primary">{step.text}</span>
    </div>
  );
}

export default function AgentPanel() {
  const { network } = useNetwork();
  const [task, setTask] = useState("What is 21 + 21, and what time is it now?");
  const [tools, setTools] = useState<string[]>(["add", "now"]);
  const [maxIterations, setMaxIterations] = useState(4);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { state, run, isConnected, address, wrongChain, expectedChain, cfg, net } = useEncryptedInference();
  const testnet = net === "testnet";

  const toggle = (t: string) => setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const runLive = async () => {
    if (!isConnected || busy) return;
    const selected = (tools.length ? tools : ["add", "now"]).map((id) => TOOL_DEFS[id].tool);
    setSteps([]);
    setErr(null);
    setBusy(true);
    try {
      const agent = new Agent({
        tools: selected,
        maxIterations,
        inferenceFn: async ({ prompt }) => {
          const r = await run(prompt, { model: DEFAULT_MODEL });
          if (!r) throw new Error("inference failed or was rejected in the wallet");
          return { answer: r.answer };
        },
        onStep: (s) => setSteps((cur) => [...cur, s]),
      });
      await agent.run(task.trim() || "What is 21 + 21, and what time is it now?");
    } catch (e) {
      setErr((e as Error).message?.split("\n")[0] ?? "agent failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Agent"
        title="ReAct agent"
        subtitle="A tool-calling loop on any LightChain model - no native function-calling needed. The model thinks, calls a tool, reads the observation, repeats. Run it LIVE with your wallet below (each reasoning step is one user-paid inference), or copy the Node setup."
      >
        <div className="mb-4">
          <ConnectStrip label={cfg.label} chainId={cfg.chainId} isConnected={isConnected} address={address} wrongChain={wrongChain} expectedChain={expectedChain} testnet={testnet} />
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-bdr-soft bg-surface-base-faint p-3">
          {LOOP.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-bdr-soft bg-card px-2.5 py-1.5 text-xs text-content-default">
                <s.icon className="size-3.5 text-primary" /> {s.label}
              </span>
              {i < LOOP.length - 1 && <ArrowRight className="size-3.5 text-content-soft" />}
            </div>
          ))}
          <span className="ml-1 text-[11px] text-content-soft">loop until done, capped at maxIterations</span>
        </div>

        <PanelGrid>
          <PanelColumn title="Build the agent">
            <div className="space-y-4">
              <Field label="Task" hint="The goal the agent reasons toward.">
                <textarea
                  rows={2}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 text-sm text-content-primary outline-none focus:border-primary/60"
                />
              </Field>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-content-soft">Tools</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(TOOL_DEFS).map(([id, def]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(id)}
                      title={def.desc}
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        tools.includes(id) ? "border-primary/40 bg-primary/10 text-content-primary" : "border-bdr-soft text-content-soft hover:text-content-primary",
                      )}
                    >
                      {def.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-content-soft/80">Toggle the tools the model may call. Add your own in code.</p>
              </div>
              <Field label="Max iterations" hint="Hard cap on reasoning steps (1-8). Each step is one user-paid inference.">
                <input type="range" min={1} max={8} value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} className="w-full accent-[var(--color-primary,#7064E9)]" />
                <span className="mt-1 block text-xs tabular-nums text-content-default">{maxIterations} steps max</span>
              </Field>
              <button
                type="button"
                onClick={runLive}
                disabled={!isConnected || busy || isRunning(state.phase)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[linear-gradient(94deg,#dd00ac_0%,#7130c3_38%,#7064e9_68%,#4f7cf6_100%)] px-4 text-sm font-medium tracking-[0.3px] text-white transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {busy ? "Agent running..." : isConnected ? `Run live on ${cfg.label}` : "Connect a wallet to run"}
              </button>
            </div>
          </PanelColumn>

          <PanelColumn title="Reasoning trace">
            {steps.length === 0 && !busy && !err && (
              <div className="grid min-h-[8rem] place-items-center rounded-xl border border-dashed border-bdr-soft px-4 py-8 text-center text-sm text-content-soft">
                Run the agent to watch it think, call tools, and answer - live.
              </div>
            )}
            <div className="space-y-2.5">
              {steps.map((s, i) => (
                <StepView key={i} step={s} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-xs text-content-soft">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  {isRunning(state.phase) ? phaseLabel(state.phase) : "Reasoning..."}
                </div>
              )}
              {err && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-content-default">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> {err}
                </div>
              )}
            </div>
          </PanelColumn>
        </PanelGrid>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-content-soft">
          <Bot className="size-3.5 text-primary" />
          The live agent drives the SDK&apos;s own Agent loop with your wallet as the inference backend - the same code below, in the browser.
        </p>
      </ConsolePanel>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The same agent in Node</h2>
        <CodeTabs tabs={[{ label: "TypeScript", code: agentCode(task, tools, maxIterations, network) }]} />
        <p className="text-xs text-content-soft">
          Scaffold it into your project:{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add agent</code>.
        </p>
      </section>
    </div>
  );
}
