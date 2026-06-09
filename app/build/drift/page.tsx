"use client";

import { useCallback, useEffect, useState } from "react";
import { Radar, Loader2, AlertTriangle, CheckCircle2, Pin, Download } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS, diffProtocolSnapshots, type ProtocolSnapshot, type ProtocolChange } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { Notice } from "@/components/build/console/panel-kit";

interface Baseline {
  snapshot: ProtocolSnapshot;
  at: string; // ISO
}

const SNIPPET = `import { LightNode, diffProtocolSnapshots } from "lightnode-sdk";
import lock from "./lightchain.lock.json"; // committed baseline

// Fail CI when a fee / timeout / slash / model changes under your app:
const changes = diffProtocolSnapshots(lock, await new LightNode("mainnet").protocolSnapshot());
if (changes.length) {
  console.error("Protocol drift:", changes);
  process.exit(1);
}`;

function key(net: string): string {
  return `lc.protocol.baseline.${net}`;
}

export default function DriftPage() {
  const { network } = useNetwork();
  const [current, setCurrent] = useState<ProtocolSnapshot | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const netLabel = NETWORKS[network].label;

  const loadBaseline = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(key(network));
      setBaseline(raw ? (JSON.parse(raw) as Baseline) : null);
    } catch {
      setBaseline(null);
    }
  }, [network]);

  useEffect(() => {
    let on = true;
    setCurrent(null);
    setError(null);
    loadBaseline();
    fetch(`/api/operator-preview?action=snapshot&net=${network}`)
      .then((r) => r.json())
      .then((j: { snapshot?: ProtocolSnapshot; error?: string }) => {
        if (!on) return;
        if (j.error || !j.snapshot) setError(j.error ?? "Could not read the protocol snapshot.");
        else setCurrent(j.snapshot);
      })
      .catch(() => on && setError("Network error reaching the snapshot endpoint."));
    return () => {
      on = false;
    };
  }, [network, loadBaseline]);

  const pin = () => {
    if (!current) return;
    const b: Baseline = { snapshot: current, at: new Date().toISOString() };
    window.localStorage.setItem(key(network), JSON.stringify(b));
    setBaseline(b);
  };

  const download = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lightchain.lock.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const changes: ProtocolChange[] = baseline && current ? diffProtocolSnapshots(baseline.snapshot, current) : [];

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Reference · Drift"
        title="Protocol drift watcher"
        subtitle={`Pin every economically load-bearing AIConfig parameter (stake floor, slash bps, fee split, timeouts, suspension, per-model fees) as a baseline, then see exactly what changed - so a fee or timeout shift never silently breaks your integration. Live from ${netLabel}.`}
      >
        {error && <Notice tone="warn">{error}</Notice>}
        {!current && !error && (
          <div className="flex items-center gap-2 text-sm text-content-soft">
            <Loader2 className="size-4 animate-spin" /> Reading the live protocol parameters on {netLabel}...
          </div>
        )}
        {current && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={pin} className="inline-flex items-center gap-1.5 rounded-[10px] border border-bdr-soft bg-surface-base-subtle px-3 py-2 text-sm font-medium text-content-default transition-colors hover:border-primary/40 hover:text-content-primary">
                <Pin className="size-4" /> {baseline ? "Re-pin baseline" : "Pin baseline"}
              </button>
              <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-[10px] border border-bdr-soft bg-surface-base-subtle px-3 py-2 text-sm font-medium text-content-default transition-colors hover:border-primary/40 hover:text-content-primary">
                <Download className="size-4" /> Download lightchain.lock.json
              </button>
              {baseline && <span className="text-[11px] text-content-soft">baseline pinned {new Date(baseline.at).toLocaleString()}</span>}
            </div>

            {!baseline && <Notice tone="warn">No baseline pinned for {netLabel}. Pin one to start watching for drift, or download the lock for CI.</Notice>}

            {baseline && changes.length === 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3.5 text-sm text-success">
                <CheckCircle2 className="size-4" /> No drift since your baseline - every parameter matches.
              </div>
            )}

            {baseline && changes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3.5 text-sm text-warning">
                  <AlertTriangle className="size-4" /> {changes.length} parameter{changes.length === 1 ? "" : "s"} changed since your baseline.
                </div>
                <div className="divide-y divide-bdr-light overflow-hidden rounded-xl border border-bdr-soft">
                  {changes.map((c) => (
                    <div key={c.path} className="flex flex-wrap items-baseline gap-x-3 px-3.5 py-2.5 text-sm">
                      <span className="flex-1 font-mono text-xs text-content-primary">{c.path}</span>
                      <span className="font-mono text-xs text-content-soft line-through">{String(c.from)}</span>
                      <span className="text-content-soft">→</span>
                      <span className="font-mono text-xs font-semibold text-warning">{String(c.to)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-bdr-soft p-3 text-xs text-content-soft">
              <p className="mb-1.5 font-semibold uppercase tracking-wider text-content-soft/80">Watched now ({netLabel})</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <span>stake floor {current.minStakeLcai.toLocaleString()}</span>
                <span>ack/compl {current.ackTimeoutSec}/{current.completionTimeoutSec}s</span>
                <span>dispute {current.disputeWindowSec}s</span>
                <span>slash compl {current.slashBps.completionTimeout / 100}%</span>
                <span>fee split {current.feeBps.worker / 100}/{current.feeBps.protocol / 100}/{current.feeBps.feePool / 100}%</span>
                <span>suspend @ {current.suspensionThreshold}</span>
                {current.models.map((m) => (
                  <span key={m.id}>{m.name} {m.feeLcai} LCAI{m.enabled ? "" : " (off)"}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Radar className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">Gate CI on protocol drift</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Commit the downloaded <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">lightchain.lock.json</code> and diff it in CI - the build fails the day a fee, timeout, slash rate, or model changes under your app.
        </p>
      </section>
    </div>
  );
}
