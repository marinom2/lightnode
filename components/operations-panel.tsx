"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  RefreshCw,
  Square,
  ScrollText,
  Coins,
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
import { repairWorkerCommand, toolkitOpCommand, dockerOpCommand, stopWorkerCommand, deregisterCommand, sweepCommand, type OS } from "@/lib/scriptgen";
import { detectClientOS } from "@/lib/os-detect";
import { useNetwork } from "@/lib/network-context";
import { getSecret, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";
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
    key: "sweep",
    label: "Sweep rewards",
    desc: "Send earnings to your wallet",
    icon: Coins,
    needsDest: true,
    confirmWord: "sweep",
    cmd: (dest) => toolkitOpCommand(`sweep-rewards.sh ${dest || "<destination-address>"}`, "sweep"),
  },
  {
    key: "dereg",
    label: "Deregister",
    desc: "Exit + withdraw stake",
    icon: LogOut,
    danger: true,
    confirmWord: "deregister",
    cmd: () => toolkitOpCommand("deregister.sh", "deregister"),
  },
];

export function OperationsPanel() {
  const { network } = useNetwork();
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [dest, setDest] = useState("");
  const [activeJobs, setActiveJobs] = useState(0);
  const [confirmOp, setConfirmOp] = useState<Op | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);

  // Track in-flight jobs for YOUR worker, so Stop/Deregister can warn before
  // stranding acked jobs (an acked-then-abandoned job is the slash-risk case).
  useEffect(() => {
    let addr = "";
    try { addr = window.localStorage.getItem("lightnode.workerAddress") || ""; } catch { /* ignore */ }
    if (!desktop || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return;
    let on = true;
    const check = () =>
      fetch(`/api/worker?net=${network}&address=${addr}`)
        .then((r) => r.json())
        .then((j) => on && j.ok && j.worker && setActiveJobs(j.worker.active_job_count ?? 0))
        .catch(() => {});
    check();
    const t = setInterval(check, 20_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [network, desktop]);
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
    if (op.key === "dereg") return deregisterCommand(os);
    if (op.key === "sweep") return sweepCommand(os, dest);
    return op.cmd(dest);
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
    const lead = op.danger ? `This stops your worker and withdraws your stake - you'd re-run setup to rejoin. ` : "";
    const jobs =
      activeJobs > 0
        ? `Your worker has ${activeJobs} job(s) in flight - ${op.danger ? "deregistering" : "stopping"} now strands them (they can't finish, won't pay, and an acked job risks a slash). `
        : "";
    return `${lead}${jobs}`.trim();
  };

  const requestOp = (op: Op) => {
    if (op.needsDest && !/^0x[a-fA-F0-9]{40}$/.test(dest)) return;
    if (needsConfirm(op)) {
      setConfirmOp(op);
      return;
    }
    void executeOp(op);
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
    if (op.key === "sweep" || op.key === "dereg") {
      env.NETWORK = network;
      // The op decrypts the worker key from the on-disk keystore using the
      // PASSWORD, so the raw key never has to pass through the web. We supply
      // the password (+ the public address, + the key if the app happens to
      // still hold one); the command derives anything missing from the keystore.
      const [pw, k] = await Promise.all([getSecret(SECRET_WORKER_PW), getSecret(SECRET_WORKER_KEY)]);
      if (pw) env.WORKER_PASSWORD = pw;
      if (k) env.WORKER_PRIVKEY = k;
      try {
        const addr = window.localStorage.getItem("lightnode.workerAddress") || "";
        if (addr) env.WORKER_ADDR = addr;
      } catch {
        /* ignore */
      }
    }
    stopRef.current = await runSetupStreamed(
      runCmd(op),
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

      {/* sweep destination (shared) */}
      <div className="mb-3">
        <label className="text-xs text-content-soft">
          Sweep / payout destination
          <input
            value={dest}
            onChange={(e) => setDest(e.target.value.trim())}
            placeholder="0x... your personal wallet (for Sweep rewards)"
            className="mt-1 h-9 w-full rounded-lg border border-bdr-soft bg-surface-base-subtle px-2.5 font-mono text-sm text-content-primary outline-none focus:border-primary"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OPS.map((op) => {
          const isActive = active === op.key;
          const blocked = !!op.needsDest && !/^0x[a-fA-F0-9]{40}$/.test(dest);
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
                    <div className="text-[11px] text-content-soft">{op.desc}</div>
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
                  {blocked ? "Enter a payout address above to enable" : op.desc}
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
        <ShieldAlert className="size-3.5 text-warning" /> Sweep and Deregister move funds / exit the network. Stake stays
        locked until you deregister.
      </p>

      {/* In-app confirmation (window.confirm is a no-op in the desktop webview). */}
      {confirmOp && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setConfirmOp(null)}>
          <div
            className="w-full max-w-md rounded-2xl border border-bdr-soft bg-card p-6 shadow-2xl"
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
      )}
    </div>
  );
}
