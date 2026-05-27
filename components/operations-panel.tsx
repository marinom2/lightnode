"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  RefreshCw,
  Square,
  ScrollText,
  Coins,
  Banknote,
  Gauge,
  LogOut,
  Download,
  Terminal,
  Loader2,
  ShieldAlert,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconChip } from "@/components/ui/icon-chip";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";
import { repairWorkerCommand, dockerOpCommand, stopWorkerCommand, deregisterCommand, settleJobsCommand, benchmarkCommand, type OS } from "@/lib/scriptgen";
import { detectClientOS } from "@/lib/os-detect";
import { fetchInferenceBudgetSec } from "@/lib/budget";
import { useNetwork } from "@/lib/network-context";
import { getSecret, getWorkerAddr, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";
import { useSavedWorkers } from "@/lib/saved-workers";
import { cn } from "@/lib/utils";

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-1 w-full"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {copied ? "Copied command" : "Copy command"}
    </Button>
  );
}

type Op = {
  key: string;
  label: string;
  desc: string;
  icon: typeof Activity;
  danger?: boolean;
  // builds the shell command; `dest` used by sweep
  cmd: (dest?: string) => string;
  needsDest?: boolean;
  confirmWord?: string;
};

const OPS: Op[] = [
  { key: "status", label: "Status", desc: "Local container health + recent log", icon: Activity, cmd: () => 'docker ps -a --filter name=lightchain-worker --format "container: {{.Status}}"; echo "--- recent log ---"; docker logs --tail 25 lightchain-worker 2>&1' },
  { key: "restart", label: "Restart", desc: "Recover a stalled worker + re-arm the keep-online watchdog", icon: RefreshCw, cmd: () => `docker restart lightchain-worker` },
  { key: "stop", label: "Stop", desc: "Pause the worker - stays down until you Install/Restart (stake intact)", icon: Square, cmd: () => `docker stop lightchain-worker` },
  { key: "tail", label: "Tail jobs", desc: "Live job log", icon: ScrollText, cmd: () => `docker logs -f --tail=50 lightchain-worker` },
  {
    key: "bench",
    label: "Speed test",
    desc: "Benchmark this machine's inference speed against the job deadline",
    icon: Gauge,
    cmd: () => "",
  },
  {
    key: "settle",
    label: "Settle earnings",
    desc: "Release completed jobs - pays your pending rewards now",
    icon: Banknote,
    cmd: () => "",
  },
  {
    key: "dereg",
    label: "Deregister",
    desc: "Exit + withdraw stake",
    icon: LogOut,
    danger: true,
    confirmWord: "deregister",
    cmd: () => "",
  },
];

export function OperationsPanel() {
  const { network } = useNetwork();
  const { saved } = useSavedWorkers();

  // Resolve the worker address: the saved address, else the first watchlisted
  // worker. (An earlier wipe could clear lightnode.workerAddress while the
  // watchlist still has it - the dashboard falls back the same way.)
  const resolveWorkerAddr = (): string => {
    const a = getWorkerAddr(network); // per-network address for the current toggle
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) return a;
    return saved.find((s) => /^0x[a-fA-F0-9]{40}$/.test(s)) ?? "";
  };
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [budgetSec, setBudgetSec] = useState(120);
  const [activeJobs, setActiveJobs] = useState(0);
  const [completedJobs, setCompletedJobs] = useState<number[]>([]);
  const [workerAddr, setWorkerAddr] = useState("");
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);
  const [settlement, setSettlement] = useState<{
    total: number;
    ready: number;
    waiting: number;
    nextClaimableAt: number;
    allClaimableAt: number;
  } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);

  // The Speed test compares this machine against the REAL on-chain inference
  // deadline (deadline - acknowledged from a recent settled job), so it stays
  // honest if LightChain ever retunes it. Best-effort; defaults to 120s.
  useEffect(() => {
    let on = true;
    fetchInferenceBudgetSec(network).then((b) => on && setBudgetSec(b));
    return () => {
      on = false;
    };
  }, [network]);

  // Track in-flight jobs for YOUR worker, so Stop/Deregister can warn before
  // stranding acked jobs (an acked-then-abandoned job is the slash-risk case).
  useEffect(() => {
    const addr = resolveWorkerAddr();
    setWorkerAddr(addr);
    if (!desktop || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return;
    let on = true;
    const check = () =>
      fetch(`/api/worker?net=${network}&address=${addr}`)
        .then((r) => r.json())
        .then((j) => {
          if (!on || !j.ok || !j.worker) return;
          setActiveJobs(j.worker.active_job_count ?? 0);
          // Completed (unreleased) jobs - what Settle/Deregister will release.
          const done = (j.jobs ?? [])
            .filter((x: { state: string }) => /complet/i.test(x.state))
            .map((x: { id: string }) => Number(x.id))
            .filter((n: number) => Number.isFinite(n));
          setCompletedJobs(done);
        })
        .catch(() => {});
    // Settlement status: which completed jobs are in LightChain's release hold
    // and when they unlock (a heavier on-chain read, so poll less often).
    const checkSettlement = () =>
      fetch(`/api/worker/settlement?net=${network}&address=${addr}`)
        .then((r) => r.json())
        .then((j) => on && j.ok && setSettlement({ total: j.total, ready: j.ready, waiting: j.waiting, nextClaimableAt: j.nextClaimableAt, allClaimableAt: j.allClaimableAt }))
        .catch(() => {});
    check();
    checkSettlement();
    const t = setInterval(check, 20_000);
    const t2 = setInterval(checkSettlement, 60_000);
    return () => {
      on = false;
      clearInterval(t);
      clearInterval(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, desktop, saved.join(",")]);

  const etaText = (ts: number): string => {
    const s = ts - Math.floor(Date.now() / 1000);
    if (s <= 0) return "now";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `~${h}h ${m}m` : `~${m}m`;
  };

  // Dynamic description for the Settle tile based on the release-hold status.
  const tileDesc = (op: Op): string => {
    if (op.key !== "settle" || !settlement || settlement.total === 0) return op.desc;
    if (settlement.waiting === 0) return `${settlement.ready} job(s) ready - claim your rewards now`;
    return `${settlement.ready} ready · ${settlement.waiting} in release hold (all claimable ${etaText(settlement.allClaimableAt)})`;
  };
  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  // Docker ops that need the engine reachable before they run get the docker
  // preamble (PATH + socket + auto-start). Stop is excluded: it writes the pause
  // marker first and must work even when Docker is already down.
  const DOCKER_OPS = new Set(["status", "restart", "tail"]);
  // Several ops are OS-aware builders rather than the raw OPS.cmd:
  // - restart = full repair (stop + clear stale session + start), clears the pause marker
  // - stop    = write pause marker (so the watchdog leaves it down) + docker stop
  // - dereg   = deregister + remove the watchdog schedule
  const baseCmd = (op: Op) => {
    if (op.key === "restart") return repairWorkerCommand(os);
    if (op.key === "stop") return stopWorkerCommand(os);
    if (op.key === "dereg") return deregisterCommand(os, network, completedJobs);
    if (op.key === "settle") return settleJobsCommand(os, network, completedJobs);
    if (op.key === "bench") return benchmarkCommand(os, budgetSec);
    return op.cmd();
  };
  // Desktop execution wraps docker ops so they survive the launched-app
  // environment (PATH + reachable socket + auto-start Docker). The copy-to-clipboard
  // path stays raw - the user's own terminal already has Docker on PATH.
  const runCmd = (op: Op) => (DOCKER_OPS.has(op.key) ? dockerOpCommand(baseCmd(op), os) : baseCmd(op));
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

  // Stop/Deregister need a confirmation. We must NOT use window.confirm: in the
  // Tauri webview it returns false (no-op), which silently swallowed Deregister.
  // So we gate through an in-app confirmation panel instead.
  const needsConfirm = (op: Op) => op.danger || (op.key === "stop" && activeJobs > 0);

  const confirmBody = (op: Op) => {
    const lead = op.danger ? "Stops your worker and withdraws your stake (re-run setup to rejoin). " : "";
    const jobs = activeJobs > 0 ? `${activeJobs} in-flight job(s) will be stranded (no pay; slash risk). ` : "";
    return `${lead}${jobs}`.trim();
  };

  const requestOp = (op: Op) => {
    if (needsConfirm(op)) {
      setConfirmOp(op);
      return;
    }
    void executeOp(op);
  };

  // Fetch the worker's completed (unreleased) job IDs FRESH (so Settle/Deregister
  // never act on a stale/empty list if the panel just mounted).
  const fetchCompletedJobIds = async (): Promise<number[]> => {
    try {
      const addr = resolveWorkerAddr();
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return completedJobs;
      const j = await fetch(`/api/worker?net=${network}&address=${addr}`).then((r) => r.json());
      if (!j.ok) return completedJobs;
      return (j.jobs ?? [])
        .filter((x: { state: string }) => /complet/i.test(x.state))
        .map((x: { id: string }) => Number(x.id))
        .filter((n: number) => Number.isFinite(n));
    } catch {
      return completedJobs;
    }
  };

  const executeOp = async (op: Op) => {
    setConfirmOp(null);
    stopRef.current?.();
    setActive(op.key);
    setLog([`$ ${op.label.toLowerCase()}...`]);
    // Sweep/Deregister are toolkit scripts that sign on-chain with the worker
    // key - they need it (+ keystore password + network). On desktop the native
    // runner injects them straight from the keychain by NAME (the web never
    // holds the value); on web we fall back to passing them via env.
    const env: Record<string, string> = {};
    const secretEnv: string[] | undefined = undefined;
    if (op.key === "dereg" || op.key === "settle") {
      env.NETWORK = network;
      // The op decrypts the worker key from the on-disk keystore using the
      // PASSWORD, so the raw key never has to pass through the web. We supply
      // the password (+ the public address, + the key if the app happens to
      // still hold one); the command derives anything missing from the keystore.
      const [pw, k] = await Promise.all([getSecret(SECRET_WORKER_PW, network), getSecret(SECRET_WORKER_KEY, network)]);
      if (pw) env.WORKER_PASSWORD = pw;
      if (k) env.WORKER_PRIVKEY = k;
      const addr = resolveWorkerAddr();
      if (addr) env.WORKER_ADDR = addr;
    }
    // Settle/Deregister act on the worker's completed jobs - fetch them fresh so
    // we never build the command with a stale/empty list.
    let command = runCmd(op);
    if (op.key === "settle" || op.key === "dereg") {
      const ids = await fetchCompletedJobIds();
      if (ids.length) setCompletedJobs(ids);
      // Settle with nothing to release: explain WHY (network + address checked),
      // instead of a bare "no completed jobs".
      if (op.key === "settle" && ids.length === 0) {
        const addr = resolveWorkerAddr();
        setLog((l) => [
          ...l,
          `checked worker ${addr ? addr.slice(0, 10) + "…" + addr.slice(-6) : "(none saved)"} on ${network}`,
          settlement && settlement.total > 0
            ? `your ${settlement.total} completed job(s) are still in the release hold - claimable ${etaText(settlement.allClaimableAt)}.`
            : "no completed jobs found. If your worker is on a different network, switch the toggle at the top.",
          "done.",
        ]);
        setActive(null);
        return;
      }
      command = op.key === "dereg" ? deregisterCommand(os, network, ids) : settleJobsCommand(os, network, ids);
    }
    stopRef.current = await runSetupStreamed(
      command,
      env,
      (line) => setLog((l) => [...l, line]),
      (code) => {
        setLog((l) => [...l, code === 0 ? "done." : `exited (${code}).`]);
        setActive(null); // clear the tile's loading state once the command finishes
        // (Deregister prints its own accurate success/failure - and only on real
        // success does it remove the watchdog. The key is wiped via Withdraw,
        // never here, so the returned stake stays reachable.)
      },
      secretEnv,
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Terminal className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Operations</h3>
        <span className="text-xs text-content-soft">manage your worker</span>
        {desktop ? (
          <Badge tone="success" className="ml-auto">one-click</Badge>
        ) : (
          <Badge tone="muted" className="ml-auto">copy-run</Badge>
        )}
      </div>

      {/* diagnostic: makes the network / worker / UI build visible so "nothing
          to settle" is never a mystery (wrong network? stale UI? no address?) */}
      {desktop && (
        <p className="mb-3 font-mono text-[11px] text-content-soft">
          diag · net:{network} · worker:{workerAddr ? `${workerAddr.slice(0, 8)}…${workerAddr.slice(-4)}` : "none"} ·
          completed:{settlement ? settlement.total : "?"} · ui:{(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev").slice(0, 7)}
        </p>
      )}

      {!desktop && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm text-content-soft">
          <span>
            A browser can&apos;t reach your local node. Copy any command below to run it, or get the desktop app for
            one-click buttons.
          </span>
          <a href="https://github.com/marinom2/lightnode/releases/latest" target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Download /> Desktop app
            </Button>
          </a>
        </div>
      )}

      {/* release-hold status: shows completed jobs held by LightChain + when they unlock */}
      {desktop && settlement && settlement.total > 0 && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-bdr-soft bg-surface-base-subtle/60 p-3 text-xs text-content-default">
          <Coins className="mt-0.5 size-4 shrink-0 text-content-soft" />
          <span>
            {settlement.ready > 0 && (
              <span className="font-medium text-success">{settlement.ready} job(s) ready to settle now. </span>
            )}
            {settlement.waiting > 0 && (
              <>
                <span className="font-medium text-content-primary">{settlement.waiting} completed job(s)</span> are in
                LightChain&apos;s release hold (dispute window) - all claimable {etaText(settlement.allClaimableAt)}.{" "}
              </>
            )}
            <span className="text-content-soft">
              ≈ {(settlement.total * 0.016).toFixed(3)} LCAI pending · Settle releases the ready ones and pays you.
            </span>
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OPS.map((op) => {
          const isActive = active === op.key;
          const blocked = false;
          const Icon = op.icon;

          // Web: can't run locally, so the card carries a copy-command action.
          if (!desktop) {
            return (
              <div
                key={op.key}
                className={cn("rounded-xl border bg-card/50 p-4", op.danger ? "border-destructive/30" : "border-bdr-soft")}
              >
                <div className="mb-2 flex items-center gap-2.5">
                  {op.danger ? (
                    <span className="grid size-9 place-items-center rounded-xl bg-destructive/15 text-destructive">
                      <Icon className="size-4" />
                    </span>
                  ) : (
                    <IconChip icon={Icon} size="sm" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-content-primary">{op.label}</div>
                    <div className="text-[11px] text-content-soft">{tileDesc(op)}</div>
                  </div>
                </div>
                <CopyCommand value={baseCmd(op)} />
              </div>
            );
          }

          // Desktop: the whole card is the button (no duplicate control).
          return (
            <button
              key={op.key}
              type="button"
              disabled={isActive || blocked}
              onClick={() => requestOp(op)}
              title={blocked ? "Enter a payout address above first" : undefined}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50",
                op.danger
                  ? "border-destructive/30 hover:border-destructive/60 hover:bg-destructive/5"
                  : "border-bdr-soft bg-card/50 hover:border-primary/40 hover:bg-card/80",
              )}
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105 group-disabled:scale-100",
                  op.danger
                    ? "bg-destructive/15 text-destructive"
                    : "bg-gradient-primary text-white shadow-[0_6px_16px_-6px_rgba(112,100,233,0.6)]",
                )}
              >
                {isActive ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-content-primary">{op.label}</span>
                <span className={cn("block text-[11px] leading-snug", blocked ? "text-warning" : "text-content-soft")}>
                  {blocked ? "Enter a payout address above to enable" : tileDesc(op)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {desktop && log.length > 0 && (
        <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[12px] leading-relaxed text-content-default">
          {log.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap">{l}</div>
          ))}
          <div ref={logEnd} />
        </div>
      )}

      <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-content-soft">
        <ShieldAlert className="size-3.5 text-warning" /> Deregister exits the network and unlocks your stake. To move
        funds out, use Withdraw Funds below. Stake stays locked until you deregister.
      </p>

      {/* In-app confirmation (window.confirm is a no-op in the desktop webview). */}
      {confirmOp && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60" onClick={() => setConfirmOp(null)}>
          <div className="flex min-h-full items-center justify-center p-4">
          <div
            className="my-auto w-full max-w-md rounded-2xl border border-bdr-soft bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-xl",
                  confirmOp.danger ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning",
                )}
              >
                <ShieldAlert className="size-4" />
              </span>
              <h3 className="text-base font-semibold text-content-primary">Confirm {confirmOp.label.toLowerCase()}</h3>
            </div>
            <p className="text-sm leading-relaxed text-content-default">{confirmBody(confirmOp) || "Are you sure?"}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmOp(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmOp.danger ? "destructive" : "default"}
                size="sm"
                onClick={() => executeOp(confirmOp)}
              >
                {confirmOp.label}
              </Button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
