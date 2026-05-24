"use client";

import { useMemo, useState } from "react";
import { Apple, Terminal, MonitorCog, Download, ListChecks, HeartPulse, Wrench } from "lucide-react";
import { generateSetup, type OS } from "@/lib/scriptgen";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/network-context";

const OS_TABS: { id: OS; label: string; icon: typeof Apple }[] = [
  { id: "macos", label: "macOS", icon: Apple },
  { id: "linux", label: "Linux", icon: Terminal },
  { id: "windows", label: "Windows", icon: MonitorCog },
];

export function SetupGuide({ defaultOS = "linux" as OS }) {
  const { network } = useNetwork();
  const [os, setOS] = useState<OS>(defaultOS);
  const bundle = useMemo(() => generateSetup(os, network), [os, network]);

  const fullScript = useMemo(
    () =>
      [
        "# === Prerequisites ===",
        ...bundle.prereqs.map((p) => `# ${p.label}\n${p.cmd}`),
        "",
        "# === Worker setup (9 phases) ===",
        bundle.setup,
        "",
        "# === Verify ===",
        bundle.verify,
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
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                os === t.id ? "bg-primary text-primary-foreground" : "text-content-soft hover:text-content-primary",
              )}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={download}>
          <Download /> Download script
        </Button>
      </div>

      <Section icon={Wrench} title="1 · Prerequisites" subtitle="One-time installs.">
        <CodeBlock code={bundle.prereqs.map((p) => `# ${p.label}\n${p.cmd}`).join("\n\n")} />
      </Section>

      <Section icon={Terminal} title="2 · Worker setup" subtitle="The official 9-phase onboarding, wrapped. Every step is safe to re-run.">
        <CodeBlock code={bundle.setup} label="run top to bottom" />
        <p className="mt-2 text-xs text-content-soft">
          You&apos;ll need a <span className="text-content-primary">funder wallet with ~50,005 LCAI</span> (50,000 stake + gas).
          The worker key is generated fresh and kept separate from your funder — never paste your funder key into the worker.
        </p>
      </Section>

      <Section icon={ListChecks} title="3 · Verify it's online" subtitle="Confirms the #1 silent failure (model alias mismatch) can't bite you.">
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
