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
import { repairWorkerCommand, toolkitOpCommand, dockerOpCommand, type OS } from "@/lib/scriptgen";
import { detectClientOS } from "@/lib/os-detect";
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
  { key: "restart", label: "Restart", desc: "Recover a stalled worker (clears stale session, restarts)", icon: RefreshCw, cmd: () => `docker restart lightchain-worker` },
  { key: "stop", label: "Stop", desc: "Stop the worker (stake stays staked)", icon: Square, cmd: () => `docker stop lightchain-worker` },
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
  const [desktop, setDesktop] = useState(false);
  const [os, setOs] = useState<OS>("macos");
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [dest, setDest] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  // Docker-based ops: status/restart/stop/tail. (Sweep/Deregister are on-chain
  // cast scripts run via the toolkit, not docker.)
  const DOCKER_OPS = new Set(["status", "restart", "stop", "tail"]);
  // Restart runs the full repair (stop + clear stale session store + start), not a bare docker restart.
  const baseCmd = (op: Op) => (op.key === "restart" ? repairWorkerCommand(os) : op.cmd(dest));
  // Desktop execution wraps docker ops so they survive the launched-app
  // environment (PATH + reachable socket + auto-start Docker). The copy-to-clipboard
  // path stays raw - the user's own terminal already has Docker on PATH.
  const runCmd = (op: Op) => (DOCKER_OPS.has(op.key) ? dockerOpCommand(baseCmd(op), os) : baseCmd(op));
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

  const runOp = async (op: Op) => {
    if (op.needsDest && !/^0x[a-fA-F0-9]{40}$/.test(dest)) return;
    if (op.danger && !window.confirm(`This will ${op.label.toLowerCase()} your worker. Continue?`)) return;
    stopRef.current?.();
    setActive(op.key);
    setLog([`$ ${op.label.toLowerCase()}...`]);
    stopRef.current = await runSetupStreamed(
      runCmd(op),
      {},
      (line) => setLog((l) => [...l, line]),
      (code) => setLog((l) => [...l, code === 0 ? "done." : `exited (${code}).`]),
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
        {OPS.map((op) => (
          <div
            key={op.key}
            className={cn(
              "rounded-xl border bg-card/50 p-4",
              op.danger ? "border-destructive/30" : "border-bdr-soft",
            )}
          >
            <div className="mb-2 flex items-center gap-2">
              {op.danger ? (
                <span className="grid size-8 place-items-center rounded-lg bg-destructive/15 text-destructive">
                  <op.icon className="size-4" />
                </span>
              ) : (
                <IconChip icon={op.icon} size="sm" />
              )}
              <div>
                <div className="text-sm font-medium text-content-primary">{op.label}</div>
                <div className="text-[11px] text-content-soft">{op.desc}</div>
              </div>
            </div>

            {desktop ? (
              <Button
                variant={op.danger ? "destructive" : "outline"}
                size="sm"
                className="mt-1 w-full"
                disabled={active === op.key || (op.needsDest && !/^0x[a-fA-F0-9]{40}$/.test(dest))}
                onClick={() => runOp(op)}
              >
                {active === op.key ? <Loader2 className="animate-spin" /> : <op.icon />}
                {op.label}
              </Button>
            ) : (
              <CopyCommand value={baseCmd(op)} />
            )}
          </div>
        ))}
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
    </div>
  );
}
