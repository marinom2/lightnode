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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/code-block";
import { Badge } from "@/components/ui/badge";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const TK = "cd lightchain-worker-toolkit/scripts/bash";

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
  { key: "status", label: "Status", desc: "Stake, model, on-chain health", icon: Activity, cmd: () => `${TK} && bash status.sh` },
  { key: "restart", label: "Restart", desc: "Recover a stalled worker", icon: RefreshCw, cmd: () => `docker restart lightchain-worker` },
  { key: "stop", label: "Stop", desc: "Stop the worker (stake stays staked)", icon: Square, cmd: () => `${TK} && bash stop.sh` },
  { key: "tail", label: "Tail jobs", desc: "Live job log", icon: ScrollText, cmd: () => `docker logs -f --tail=50 lightchain-worker` },
  {
    key: "sweep",
    label: "Sweep rewards",
    desc: "Send earnings to your wallet",
    icon: Coins,
    needsDest: true,
    confirmWord: "sweep",
    cmd: (dest) => `${TK} && echo sweep | bash sweep-rewards.sh ${dest || "<destination-address>"}`,
  },
  {
    key: "dereg",
    label: "Deregister",
    desc: "Exit + withdraw stake",
    icon: LogOut,
    danger: true,
    confirmWord: "deregister",
    cmd: () => `${TK} && echo deregister | bash deregister.sh`,
  },
];

export function OperationsPanel() {
  const [desktop, setDesktop] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [dest, setDest] = useState("");
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

  const runOp = async (op: Op) => {
    if (op.needsDest && !/^0x[a-fA-F0-9]{40}$/.test(dest)) return;
    if (op.danger && !window.confirm(`This will ${op.label.toLowerCase()} your worker. Continue?`)) return;
    stopRef.current?.();
    setActive(op.key);
    setLog([`$ ${op.label.toLowerCase()}...`]);
    stopRef.current = await runSetupStreamed(
      op.cmd(dest),
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
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-lg",
                  op.danger ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary",
                )}
              >
                <op.icon className="size-4" />
              </span>
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
              <CodeBlock code={op.cmd(dest)} />
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
