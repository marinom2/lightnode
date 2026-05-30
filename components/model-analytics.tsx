"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Code2, Copy, Check, Download, RefreshCw, Info, ShieldCheck, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "@/lib/network";
import { openExternal } from "@/lib/tauri";
import { HideOnDesktop } from "@/components/hide-on-desktop";
import { modelStatsCsv, workerStatsCsv, type ModelStat, type WorkerStat, type NetworkAnalytics } from "@/lib/analytics";
import { fmt, cn, shortAddr } from "@/lib/utils";

/**
 * Compact "Use in your app" footer that lets a developer copy a working
 * lightnode-sdk snippet that fetches the same data the table above is rendering,
 * with a link into the /build hub for the full quickstart. The snippet is real,
 * not pseudocode - paste-and-run after `npm i lightnode-sdk`.
 */
function SdkSnippet({ snippet, label }: { snippet: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group border-t border-bdr-soft px-5 py-3">
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-[11px] font-medium text-content-soft transition-colors hover:text-content-default">
        <span className="inline-flex items-center gap-1.5">
          <Code2 className="size-3.5" /> {label}
        </span>
        <span className="inline-flex items-center gap-1.5 text-content-soft">
          <HideOnDesktop>
            <Link href="/build" className="text-primary hover:underline">
              Full quickstart in /build
            </Link>
            <span className="text-content-soft/40">·</span>
          </HideOnDesktop>
          <span className="text-content-soft">click to expand</span>
        </span>
      </summary>
      <div className="relative mt-3">
        <pre className="overflow-x-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[11px] leading-relaxed text-content-default">
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(snippet).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-bdr-soft bg-card px-2 py-1 text-[11px] text-content-soft transition-colors hover:text-content-primary"
          aria-label="Copy snippet"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </details>
  );
}

const MODEL_SNIPPET_TEMPLATE = (net: string) => `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("${net}");
// Per-model performance: completion, p50/p95, incomplete, earnings
const models = await ln.getModelStats();
for (const m of models) {
  console.log(m.name, m.total, \`completion=\${m.completionRate}\`, \`p50=\${m.p50}s\`);
}`;

const WORKER_SNIPPET_TEMPLATE = (net: string) => `import { LightNode } from "lightnode-sdk";

const ln = new LightNode("${net}");
// Per-worker reliability ordered by busiest first
const workers = await ln.getWorkerStats(1000, 25);
for (const w of workers) {
  console.log(w.address, \`completion=\${w.completionRate}\`, \`incomplete=\${w.incomplete}\`);
}
// On-chain registration truth (independent of the indexer)
const reg = await ln.isRegistered(workers[0].address); // true | false | null`;

function pct(r: number | null): string {
  return r == null ? "-" : `${Math.round(r * 100)}%`;
}
function rateTone(r: number | null): string {
  if (r == null) return "text-content-soft";
  if (r >= 0.95) return "text-success";
  if (r >= 0.8) return "text-warning";
  return "text-destructive";
}
function secs(n: number | null): string {
  return n == null ? "-" : `${n}s`;
}

function CompletionBar({ s }: { s: { success: number; incomplete: number; disputed: number } }) {
  const denom = s.success + s.incomplete + s.disputed;
  if (denom === 0) return <div className="h-1.5 w-full rounded-full bg-surface-base-faint" />;
  const w = (n: number) => `${(n / denom) * 100}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-base-faint">
      <div className="h-full bg-success" style={{ width: w(s.success) }} />
      <div className="h-full bg-destructive/80" style={{ width: w(s.incomplete) }} />
      <div className="h-full bg-warning/70" style={{ width: w(s.disputed) }} />
    </div>
  );
}

export function ModelAnalytics() {
  const { network } = useNetwork();
  const [stats, setStats] = useState<ModelStat[] | null>(null);
  const [workers, setWorkers] = useState<WorkerStat[]>([]);
  const [summary, setSummary] = useState<NetworkAnalytics | null>(null);
  const [sampled, setSampled] = useState(0);
  const [err, setErr] = useState(false);
  const explorer = NETWORKS[network].explorer;

  useEffect(() => {
    let on = true;
    setStats(null);
    setWorkers([]);
    setSummary(null);
    setErr(false);
    const load = () =>
      fetch(`/api/analytics?net=${network}`)
        .then((r) => r.json())
        .then((j) => {
          if (!on) return;
          if (!j.ok) return setErr(true);
          setStats(j.stats);
          setWorkers(Array.isArray(j.workers) ? j.workers : []);
          setSummary(j.summary ?? null);
          setSampled(j.sampled ?? 0);
        })
        .catch(() => on && setErr(true));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network]);

  const download = (csv: string, name: string) => {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportCsv = () => {
    if (stats && stats.length > 0) download(modelStatsCsv(stats), `lightchain-${network}-model-stats.csv`);
  };
  const exportWorkersCsv = () => {
    if (workers.length > 0) download(workerStatsCsv(workers), `lightchain-${network}-worker-reliability.csv`);
  };

  const headline = [
    { label: "Completion", value: summary ? pct(summary.completionRate) : "-", tone: summary ? rateTone(summary.completionRate) : "" },
    { label: "Jobs sampled", value: fmt(sampled, 0) },
    { label: "Incomplete", value: summary ? fmt(summary.incomplete, 0) : "-", tone: summary && summary.incomplete > 0 ? "text-destructive" : "" },
    { label: "Earnings", value: summary ? `${fmt(summary.earnings, 2)} LCAI` : "-", tone: "text-success" },
  ];

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bdr-soft px-5 py-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-content-primary">Model performance</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-content-soft">
              <RefreshCw className="size-3" /> 30s
            </span>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!stats || stats.length === 0}>
              <Download /> CSV
            </Button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-px border-b border-bdr-soft bg-bdr-soft sm:grid-cols-4">
            {headline.map((h) => (
              <div key={h.label} className="bg-card px-5 py-3">
                <div className="text-[11px] text-content-soft">{h.label}</div>
                <div className={cn("text-xl font-semibold tabular-nums", h.tone || "text-content-primary")}>{h.value}</div>
              </div>
            ))}
          </div>
        )}

        {err && !stats && <p className="px-5 py-8 text-center text-sm text-content-soft">Analytics unavailable right now.</p>}
        {!err && stats == null && <div className="px-5 py-8 text-center text-sm text-content-soft">Loading…</div>}
        {stats && stats.length === 0 && <p className="px-5 py-8 text-center text-sm text-content-soft">No jobs yet on this network.</p>}

        {stats && stats.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr-soft text-left text-[11px] font-medium text-content-soft">
                  <th className="px-5 py-2.5">Model</th>
                  <th className="px-3 py-2.5 text-right">Jobs</th>
                  <th className="px-3 py-2.5">Completion</th>
                  <th className="px-3 py-2.5 text-right">p50</th>
                  <th className="px-3 py-2.5 text-right">p95</th>
                  <th className="px-3 py-2.5 text-right">Incomplete</th>
                  <th className="px-3 py-2.5 text-right">Disputed</th>
                  <th className="px-5 py-2.5 text-right">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.modelId} className="border-b border-bdr-soft/60 last:border-0">
                    <td className="px-5 py-3 font-medium text-content-primary">{s.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-default">{fmt(s.total, 0)}</td>
                    <td className="min-w-[8rem] px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-9 shrink-0 text-right font-semibold tabular-nums", rateTone(s.completionRate))}>
                          {pct(s.completionRate)}
                        </span>
                        <CompletionBar s={s} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p50)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(s.p95)}</td>
                    <td
                      className={cn("px-3 py-3 text-right tabular-nums", s.incomplete > 0 ? "text-destructive" : "text-content-soft")}
                      title={`${s.timedOut} timed out + ${s.stuck} acked-but-never-finished`}
                    >
                      {s.incomplete}
                    </td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", s.disputed > 0 ? "text-warning" : "text-content-soft")}>
                      {s.disputed}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-success">{fmt(s.earnings, 3)} LCAI</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="flex items-start gap-1.5 px-5 py-3 text-[11px] leading-relaxed text-content-soft">
          <Info className="mt-0.5 size-3 shrink-0" />
          Completion = succeeded / resolved. <span className="text-content-default">Incomplete</span> counts jobs taken but
          never finished in time: explicit timeouts plus jobs the indexer left in &quot;Acknowledged&quot; for over 10
          minutes (it rarely marks them timed-out, so these would otherwise be missed). Latency is acknowledged to
          completed; earnings are settled worker share over the sampled window.
        </p>
        <SdkSnippet label="Use this in your app (lightnode-sdk)" snippet={MODEL_SNIPPET_TEMPLATE(network)} />
      </Card>

      {workers.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bdr-soft px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              <h2 className="text-sm font-semibold text-content-primary">Worker reliability</h2>
              <span className="text-xs text-content-soft">busiest in the window</span>
            </div>
            <Button variant="outline" size="sm" onClick={exportWorkersCsv} disabled={workers.length === 0}>
              <Download /> CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bdr-soft text-left text-[11px] font-medium text-content-soft">
                  <th className="px-5 py-2.5">Worker</th>
                  <th className="px-3 py-2.5 text-right">Jobs</th>
                  <th className="px-3 py-2.5">Completion</th>
                  <th className="px-3 py-2.5 text-right">p50</th>
                  <th className="px-3 py-2.5 text-right">p95</th>
                  <th className="px-3 py-2.5 text-right">Incomplete</th>
                  <th className="px-5 py-2.5 text-right">Earned</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.address} className="border-b border-bdr-soft/60 last:border-0">
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => openExternal(`${explorer}/address/${w.address}`)}
                        className="inline-flex items-center gap-1 font-mono text-xs text-content-primary transition-colors hover:text-primary"
                      >
                        {shortAddr(w.address)} <ExternalLink className="size-3" />
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-default">{fmt(w.total, 0)}</td>
                    <td className="min-w-[8rem] px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-9 shrink-0 text-right font-semibold tabular-nums", rateTone(w.completionRate))}>
                          {pct(w.completionRate)}
                        </span>
                        <CompletionBar s={w} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(w.p50)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-content-soft">{secs(w.p95)}</td>
                    <td className={cn("px-3 py-3 text-right tabular-nums", w.incomplete > 0 ? "text-destructive" : "text-content-soft")}>
                      {w.incomplete}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-success">{fmt(w.earnings, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SdkSnippet label="Use this in your app (lightnode-sdk)" snippet={WORKER_SNIPPET_TEMPLATE(network)} />
        </Card>
      )}
    </div>
  );
}
