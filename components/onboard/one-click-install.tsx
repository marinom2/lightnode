"use client";

import { useEffect, useRef, useState } from "react";
import { Rocket, Loader2, CheckCircle2, XCircle, Terminal, ShieldCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL, NETWORKS } from "@/lib/network";
import { desktopInstallCommand } from "@/lib/scriptgen";
import { isDesktop, runSetupStreamed } from "@/lib/tauri";

type Phase = "idle" | "running" | "done" | "failed";

/**
 * The literal one-click button - only in the desktop shell (a browser can't
 * install/run anything). Collects the password + funder key in-memory, passes
 * them as process env to the native runner, and streams the install log.
 */
export function OneClickInstall({ model = DEFAULT_MODEL }: { model?: string }) {
  const { network } = useNetwork();
  const [desktop, setDesktop] = useState(false);
  const [pw, setPw] = useState("");
  const [funder, setFunder] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setDesktop(isDesktop()), []);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);

  if (!desktop) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-start gap-2.5 text-sm text-content-soft">
          <Rocket className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="font-medium text-content-primary">Want true one-click?</span> The desktop app installs &amp;
            runs everything with a single button. On the web, use the one command below.
          </span>
        </div>
        <a href="https://github.com/marinom2/lightnode/releases/latest" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            <Download /> Get the desktop app
          </Button>
        </a>
      </div>
    );
  }

  const valid = pw.length >= 6 && /^0x[a-fA-F0-9]{64}$/.test(funder);

  const run = async () => {
    setPhase("running");
    setLog([]);
    const command = desktopInstallCommand(network, model);
    stopRef.current = await runSetupStreamed(
      command,
      { WORKER_PASSWORD: pw, FUNDER_PRIVKEY: funder, NETWORK: network, SUPPORTED_MODELS: model },
      (line) => setLog((l) => [...l, line]),
      (code) => {
        setPhase(code === 0 ? "done" : "failed");
        setPw("");
        setFunder(""); // clear secrets from memory once the run ends
      },
    );
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Rocket className="size-4 text-primary" />
        <span className="text-sm font-semibold text-content-primary">One-click install (desktop)</span>
      </div>

      {phase === "idle" && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-content-soft">
              Keystore password
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="choose a strong password"
                className="mt-1 h-9 w-full rounded-lg border border-bdr-soft bg-card/60 px-2.5 text-sm text-content-primary outline-none focus:border-primary"
              />
            </label>
            <label className="text-xs text-content-soft">
              Funder private key (0x..., holds ~{NETWORKS[network].fundLcai.toLocaleString()} LCAI)
              <input
                type="password"
                value={funder}
                onChange={(e) => setFunder(e.target.value.trim())}
                placeholder="0x... (used once to fund + stake)"
                className="mt-1 h-9 w-full rounded-lg border border-bdr-soft bg-card/60 px-2.5 font-mono text-sm text-content-primary outline-none focus:border-primary"
              />
            </label>
          </div>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-content-soft">
            <ShieldCheck className="size-3.5 text-success" /> Kept in memory only - passed to the local installer, never
            stored or sent anywhere.
          </p>
          <Button variant="gradient" className="mt-3" disabled={!valid} onClick={run}>
            <Rocket /> Install &amp; run my worker
          </Button>
        </>
      )}

      {phase !== "idle" && (
        <>
          <div className="mb-2 flex items-center gap-2 text-sm">
            {phase === "running" && (
              <span className="inline-flex items-center gap-2 text-content-primary">
                <Loader2 className="size-4 animate-spin" /> Installing...
              </span>
            )}
            {phase === "done" && (
              <span className="inline-flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="size-4" /> Worker online - track it on the dashboard.
              </span>
            )}
            {phase === "failed" && (
              <span className="inline-flex items-center gap-2 font-medium text-destructive">
                <XCircle className="size-4" /> Install stopped - see the log.
              </span>
            )}
          </div>
          <div className="max-h-56 overflow-auto rounded-lg border border-bdr-soft bg-[#0b0b14] p-3 font-mono text-[12px] leading-relaxed text-content-default">
            <div className="mb-1 flex items-center gap-1.5 text-content-soft">
              <Terminal className="size-3" /> install log
            </div>
            {log.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">{l}</div>
            ))}
            <div ref={logEnd} />
          </div>
        </>
      )}
    </div>
  );
}
