"use client";

import { useEffect, useMemo, useState } from "react";
import { Apple, Terminal, MonitorCog, Download, ListChecks, HeartPulse, Wrench, Box, Rocket, ChevronUp, ChevronDown } from "lucide-react";
import { generateSetup, type OS } from "@/lib/scriptgen";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL } from "@/lib/network";

const OS_TABS: { id: OS; label: string; icon: typeof Apple }[] = [
  { id: "macos", label: "macOS", icon: Apple },
  { id: "linux", label: "Linux", icon: Terminal },
  { id: "windows", label: "Windows", icon: MonitorCog },
];

export function SetupGuide({ defaultOS = "linux" as OS }) {
  const { network } = useNetwork();
  const [os, setOS] = useState<OS>(defaultOS);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL]);
  const [showSteps, setShowSteps] = useState(false);

  // Live whitelisted+enabled models — so the serve-target adapts as the registry grows.
  useEffect(() => {
    let on = true;
    fetch(`/api/models?net=${network}`)
      .then((r) => r.json())
      .then((j) => {
        if (!on || !j.ok) return;
        const live: string[] = j.models
          .filter((m: { is_enabled: boolean; is_whitelisted: boolean }) => m.is_enabled && m.is_whitelisted)
          .map((m: { name: string }) => m.name);
        if (live.length) {
          setModels(live);
          setModel((cur) => (live.includes(cur) ? cur : live.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : live[0]));
        }
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [network]);

  const bundle = useMemo(() => generateSetup(os, network, model), [os, network, model]);

  const fullScript = useMemo(
    () =>
      [
        `# LightNode worker setup — ${bundle.network} — model: ${bundle.model}`,
        "",
        "# === Prerequisites (one-time) ===",
        ...bundle.prereqs.map((p) => `# ${p.label}\n${p.cmd}`),
        "",
        "# === One command: set up + run everything ===",
        bundle.oneLiner,
        "",
        "# === Verify ===",
        bundle.verify,
        "",
        "# === Keep it alive ===",
        bundle.watchdog,
      ].join("\n"),
    [bundle],
  );

  const download = () => {
    const ext = os === "windows" ? "ps1" : "sh";
    const blob = new Blob([fullScript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lightnode-worker-setup.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-bdr-soft bg-surface-base-subtle p-1">
          {OS_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setOS(t.id)}
              aria-pressed={os === t.id}
              aria-label={`${t.label} setup`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                os === t.id ? "bg-primary text-primary-foreground" : "text-content-soft hover:text-content-primary",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-xl border border-bdr-soft bg-surface-base-subtle px-2.5 py-1.5 text-sm">
            <Box className="size-4 text-content-soft" />
            <span className="text-content-soft">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={models.length <= 1}
              className="bg-transparent font-mono text-content-primary outline-none disabled:opacity-70"
              aria-label="Model to serve"
            >
              {models.map((m) => (
                <option key={m} value={m} className="bg-card text-content-primary">
                  {m}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={download}>
            <Download /> Download script
          </Button>
        </div>
      </div>

      <Section icon={Wrench} title="1 · Prerequisites" subtitle="One-time installs (Docker, Ollama, Foundry).">
        <CodeBlock code={bundle.prereqs.map((p) => `# ${p.label}\n${p.cmd}`).join("\n\n")} />
      </Section>

      <Section icon={Rocket} title="2 · One command — set up everything" subtitle="Clones, configures, runs all 9 phases. Prompts only for a password + your funder key.">
        <CodeBlock code={bundle.oneLiner} label={os === "windows" ? "PowerShell — paste & run" : "paste & run"} />
        <p className="mt-2 text-xs text-content-soft">
          Generates a fresh worker key, stakes 50,000 LCAI, and starts the container with{" "}
          <code className="rounded bg-surface-base-light px-1 py-0.5">--restart always</code>. You&apos;ll need a{" "}
          <span className="text-content-primary">funder wallet with ~50,005 LCAI</span> (it prompts for the key, never stored by us).
        </p>
      </Section>

      <button
        onClick={() => setShowSteps((s) => !s)}
        className="flex w-full items-center justify-between rounded-xl border border-bdr-soft bg-surface-base-subtle px-4 py-2.5 text-sm text-content-soft hover:text-content-primary"
      >
        <span className="inline-flex items-center gap-2">
          <ListChecks className="size-4" /> Prefer to run it step by step? Show the 9 phases
        </span>
        {showSteps ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {showSteps && (
        <Section icon={Terminal} title="Worker setup — step by step" subtitle="The official 9-phase onboarding, wrapped. Every step is safe to re-run.">
          <CodeBlock code={bundle.setup} label="run top to bottom" />
        </Section>
      )}

      <Section icon={ListChecks} title="3 · Verify it's online" subtitle="Confirms the #1 silent failure (model name mismatch) can't bite you.">
        <CodeBlock code={bundle.verify} />
      </Section>

      <Section icon={HeartPulse} title="4 · Keep it alive (recommended)" subtitle="Auto-restart on stale heartbeat — avoids the ack-then-silent 15% slash.">
        <CodeBlock code={bundle.watchdog} />
      </Section>

      <div className="rounded-2xl border border-bdr-soft bg-surface-base-subtle p-5">
        <div className="mb-3 text-sm font-medium text-content-primary">Day-2 operations</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {bundle.ops.map((o) => (
            <div key={o.label} className="rounded-lg border border-bdr-light bg-card/50 p-3">
              <div className="text-xs text-content-soft">{o.label}</div>
              <code className="mt-1 block break-all font-mono text-xs text-content-default">{o.cmd}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Terminal;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <div className="text-sm font-semibold text-content-primary">{title}</div>
          <div className="text-xs text-content-soft">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
