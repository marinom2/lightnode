"use client";

import { useState } from "react";
import { Bot, ArrowRight, Brain, Wrench, Eye, CheckCircle2 } from "lucide-react";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

const TOOL_DEFS: Record<string, { label: string; desc: string; code: string }> = {
  add: {
    label: "add",
    desc: "Add two numbers",
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

function agentCode(task: string, tools: string[], maxIterations: number): string {
  const blocks = (tools.length ? tools : ["add", "now"]).map((t) => TOOL_DEFS[t].code).join("\n");
  const t = task.trim() || "What is 21 + 21, and what time is it now?";
  return `import { Agent } from "lightnode-sdk";

const agent = new Agent({
  network: "testnet",
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

export default function AgentPanel() {
  const [task, setTask] = useState("What is 21 + 21, and what time is it now?");
  const [tools, setTools] = useState<string[]>(["add", "now"]);
  const [maxIterations, setMaxIterations] = useState(4);

  const toggle = (t: string) => setTools((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Agent"
        title="ReAct agent"
        subtitle="A tool-calling loop on any LightChain-hosted model - no native function-calling required. The model thinks, calls a tool, reads the observation, and repeats until it answers. An agent runs several inferences, so build the exact setup here and run it locally or in StackBlitz."
      >
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
                        tools.includes(id)
                          ? "border-primary/40 bg-primary/10 text-content-primary"
                          : "border-bdr-soft text-content-soft hover:text-content-primary",
                      )}
                    >
                      {def.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-content-soft/80">Toggle the tools the model may call. Add your own in code.</p>
              </div>
              <Field label="Max iterations" hint="Hard cap on reasoning steps (1-8).">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                  className="w-full accent-[var(--color-primary,#7064E9)]"
                />
                <span className="mt-1 block text-xs tabular-nums text-content-default">{maxIterations} steps max</span>
              </Field>
            </div>
          </PanelColumn>

          <div className="flex flex-col gap-2">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Generated agent</span>
            <CodeTabs tabs={[{ label: "TypeScript", code: agentCode(task, tools, maxIterations) }]} />
            <p className="px-1 text-[11px] text-content-soft">
              <Bot className="mr-1 inline size-3.5 text-primary" />
              Each reasoning step that calls the model is one encrypted inference.
            </p>
          </div>
        </PanelGrid>
      </ConsolePanel>

      <section>
        <p className="text-xs text-content-soft">
          Run it with your funded key locally or in{" "}
          <a href="https://github.com/marinom2/lightnode-examples" target="_blank" rel="noreferrer" className="text-primary hover:underline">
            the examples repo
          </a>
          , or from the CLI: <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">lightnode agent &quot;your task&quot;</code>.
        </p>
      </section>
    </div>
  );
}
