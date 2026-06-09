"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Server } from "lucide-react";
import { useNetwork } from "@/lib/network-context";
import { NETWORKS } from "lightnode-sdk";
import { ConsolePanel } from "@/components/build/console/panel";
import { CodeTabs } from "@/components/build/console/code-tabs";
import { PanelGrid, PanelColumn, Field, RunButton, ResponseEmpty, ProofRow, Notice, short } from "@/components/build/console/panel-kit";
import { cn } from "@/lib/utils";

type Action = "config" | "status" | "job";
const ACTIONS: { id: Action; label: string }[] = [
  { id: "config", label: "Protocol config" },
  { id: "status", label: "Worker status" },
  { id: "job", label: "Classify a job" },
];

interface ConfigData {
  minStakeLcai: number;
  ackTimeoutSec: number;
  completionTimeoutSec: number;
  resolutionTimeoutSec: number;
  disputeWindowSec: number;
  slashBps: { ackTimeout: number; completionTimeout: number; dispute: number; max: number };
  feeBps: { protocol: number; worker: number; feePool: number };
  suspensionThreshold: number;
  suspensionCooldownSec: number;
}
interface ModelRow {
  id: string;
  name: string | null;
  isLive: boolean;
  isStale: boolean;
}
interface StatusData {
  registered: boolean;
  stakeLcai: number;
  belowFloor: boolean;
  claimableLcai: number;
  walletBalanceLcai: number;
  lifetimeJobsCompleted: number;
  lifetimeJobsTimedOut: number;
  recentReleased: number;
  recentPendingRelease: number;
  recentStuck: number;
  recentInFlight: number;
  registeredModels: ModelRow[];
}
interface JobStatusData {
  category: string;
  refundable: boolean;
  worker: string | null;
  submitTx: string | null;
  completionTx: string | null;
}
type PreviewResponse =
  | { action: "config"; config: ConfigData }
  | { action: "status"; worker: string; status: StatusData }
  | { action: "job"; jobId: string; status: JobStatusData | null };

const SNIPPET = `import { WorkerOperator } from "lightnode-sdk";

const op = new WorkerOperator("mainnet", { publicClient, walletClient });

await op.config();              // live AIConfig: stake floor, timeouts, slash bps
await op.status();              // registered, stake, claimable, below-floor
await op.clearStuck(jobIds);    // recover acked-but-stuck jobs that block exit
await op.unstickAndDeregister(jobIds); // clear + settle + withdraw + exit`;

function KV({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2">
      <div className="text-[11px] text-content-soft">{k}</div>
      <div className={cn("mt-0.5 text-sm font-medium tabular-nums", warn ? "text-warning" : "text-content-primary")}>{v}</div>
    </div>
  );
}

function ConfigView({ c }: { c: ConfigData }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV k="Min stake" v={`${c.minStakeLcai.toLocaleString()} LCAI`} />
        <KV k="Ack timeout" v={`${c.ackTimeoutSec}s`} />
        <KV k="Completion timeout" v={`${c.completionTimeoutSec}s`} />
        <KV k="Dispute window" v={`${c.disputeWindowSec}s`} />
        <KV k="Suspension at" v={`${c.suspensionThreshold} timeouts`} />
        <KV k="Suspension cooldown" v={`${c.suspensionCooldownSec}s`} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Slash (bps)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV k="Ack timeout" v={c.slashBps.ackTimeout} />
          <KV k="Completion" v={c.slashBps.completionTimeout} />
          <KV k="Dispute" v={c.slashBps.dispute} />
          <KV k="Max" v={c.slashBps.max} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Fee split (bps)</p>
        <div className="grid grid-cols-3 gap-2">
          <KV k="Protocol" v={c.feeBps.protocol} />
          <KV k="Worker" v={c.feeBps.worker} />
          <KV k="Fee pool" v={c.feeBps.feePool} />
        </div>
      </div>
    </div>
  );
}

function StatusView({ s, explorer, worker }: { s: StatusData; explorer: string; worker: string }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KV k="Registered" v={s.registered ? "yes" : "no"} warn={!s.registered} />
        <KV k="Stake" v={`${s.stakeLcai.toLocaleString()} LCAI`} warn={s.belowFloor} />
        <KV k="Claimable" v={`${s.claimableLcai} LCAI`} />
        <KV k="Wallet gas" v={`${s.walletBalanceLcai.toFixed(4)} LCAI`} warn={s.walletBalanceLcai < 0.001} />
        <KV k="Lifetime jobs" v={s.lifetimeJobsCompleted} />
        <KV k="Timed out" v={s.lifetimeJobsTimedOut} warn={s.lifetimeJobsTimedOut > 0} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Recent jobs (last 50)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KV k="Released" v={s.recentReleased} />
          <KV k="Pending release" v={s.recentPendingRelease} />
          <KV k="Stuck" v={s.recentStuck} warn={s.recentStuck > 0} />
          <KV k="In flight" v={s.recentInFlight} />
        </div>
      </div>
      {s.registeredModels.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-content-soft">Models served</p>
          <div className="flex flex-wrap gap-1.5">
            {s.registeredModels.map((m) => (
              <span
                key={m.id}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  m.isLive
                    ? "border-success/30 bg-success/10 text-success"
                    : m.isStale
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-bdr-soft text-content-soft",
                )}
              >
                {m.name ?? short(m.id)}
                {m.isStale ? " (stale)" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <ProofRow label="address" value={short(worker)} href={`${explorer}/address/${worker}`} />
    </div>
  );
}

export default function WorkerPanel() {
  const { network } = useNetwork();
  const [action, setAction] = useState<Action>("config");
  const [worker, setWorker] = useState("");
  const [jobId, setJobId] = useState("");
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const explorer = NETWORKS[network].explorer;

  const run = useCallback(
    async (a: Action) => {
      setRunning(true);
      setError(null);
      setData(null);
      const qs = new URLSearchParams({ action: a, net: network });
      if (a === "status") {
        if (!/^0x[0-9a-fA-F]{40}$/.test(worker.trim())) {
          setError("Paste a valid 0x worker address.");
          setRunning(false);
          return;
        }
        qs.set("worker", worker.trim());
      }
      if (a === "job") {
        if (!/^\d+$/.test(jobId.trim())) {
          setError("Enter a numeric job id.");
          setRunning(false);
          return;
        }
        qs.set("jobId", jobId.trim());
      }
      try {
        const res = await fetch(`/api/operator-preview?${qs.toString()}`);
        const d = (await res.json()) as PreviewResponse & { error?: string };
        if (!res.ok || d.error) {
          setError(d.error ?? "Read failed.");
          return;
        }
        setData(d);
      } catch {
        setError("Network error reaching the operator endpoint.");
      } finally {
        setRunning(false);
      }
    },
    [network, worker, jobId],
  );

  // Auto-load protocol config on mount / network change for instant live data.
  useEffect(() => {
    if (action === "config") void run("config");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  return (
    <div className="space-y-10">
      <ConsolePanel
        kicker="Capability · Worker ops"
        title="Worker operator"
        subtitle="The Docker-free operator surface: read live protocol config, inspect any worker's on-chain status and stuck-job exposure, and classify a job - the same reads the desktop Action Center and the lightnode worker CLI use. Write ops (settle, clearStuck, withdraw, deregister) sign with your own key."
      >
        <PanelGrid>
          <PanelColumn title="Request">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAction(a.id);
                      setData(null);
                      setError(null);
                      if (a.id === "config") void run("config");
                    }}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      action === a.id
                        ? "border-primary/40 bg-primary/10 text-content-primary"
                        : "border-bdr-soft text-content-soft hover:text-content-primary",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {action === "status" && (
                <Field label="Worker address" hint="Any registered worker on the selected network.">
                  <input
                    value={worker}
                    onChange={(e) => setWorker(e.target.value.trim())}
                    placeholder="0x..."
                    className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                  />
                </Field>
              )}
              {action === "job" && (
                <Field label="Job id" hint="A numeric on-chain job id to classify (completed / stalled / refundable).">
                  <input
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value.trim())}
                    placeholder="1234"
                    className="w-full rounded-lg border border-bdr-soft bg-surface-base-faint px-3 py-2 font-mono text-sm text-content-primary outline-none focus:border-primary/60"
                  />
                </Field>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-content-soft">Read-only · {NETWORKS[network].label}</span>
                <RunButton running={running} onClick={() => run(action)} idle="Read" busy="Reading..." />
              </div>
            </div>
          </PanelColumn>

          <PanelColumn title="Response">
            {error && <Notice tone="warn">{error}</Notice>}
            {!error && !data && !running && <ResponseEmpty>Pick an action and read live on-chain operator data.</ResponseEmpty>}
            {!error && running && <ResponseEmpty>Reading the chain...</ResponseEmpty>}
            {!error && data && data.action === "config" && <ConfigView c={data.config} />}
            {!error && data && data.action === "status" && <StatusView s={data.status} explorer={explorer} worker={data.worker} />}
            {!error && data && data.action === "job" && (
              data.status ? (
                <div className="space-y-1">
                  <ProofRow label="category" value={data.status.category} />
                  <ProofRow label="refundable" value={String(data.status.refundable)} />
                  {data.status.worker && <ProofRow label="worker" value={short(data.status.worker)} href={`${explorer}/address/${data.status.worker}`} />}
                  {data.status.submitTx && <ProofRow label="submitJob" value={short(data.status.submitTx)} href={`${explorer}/tx/${data.status.submitTx}`} />}
                  {data.status.completionTx && <ProofRow label="jobCompleted" value={short(data.status.completionTx)} href={`${explorer}/tx/${data.status.completionTx}`} />}
                </div>
              ) : (
                <ResponseEmpty>No record for that job id on {NETWORKS[network].label} yet.</ResponseEmpty>
              )
            )}
          </PanelColumn>
        </PanelGrid>
      </ConsolePanel>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-content-soft">The SDK behind it</h2>
        </div>
        <CodeTabs tabs={[{ label: "TypeScript", code: SNIPPET }]} />
        <p className="text-xs text-content-soft">
          Scaffold a runnable operator console with{" "}
          <code className="rounded bg-surface-base-faint px-1 py-0.5 font-mono text-content-default">npx lightnode add worker-operator</code>.
        </p>
      </section>
    </div>
  );
}
