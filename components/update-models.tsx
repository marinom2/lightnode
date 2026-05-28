"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, Loader2, CheckCircle2, XCircle, Terminal } from "lucide-react";
import { privateKeyToAccount } from "viem/accounts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "@/components/onboard/model-picker";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL } from "@/lib/network";
import { updateModelsCommand, desktopInstallCommand, type OS } from "@/lib/scriptgen";
import { detectClientOS } from "@/lib/os-detect";
import { runSetupStreamed, detectNativeHardware } from "@/lib/tauri";
import { getSecret, getWorkerAddr, getServedModels, setServedModels, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";

type Phase = "idle" | "running" | "done" | "failed";

function keyMatchesAddr(key: string, addr: string): boolean {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return false;
  try {
    return privateKeyToAccount(key as `0x${string}`).address.toLowerCase() === addr.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Change the models an existing, registered worker serves - live, with no
 * re-stake. It updates the on-chain model set (updateWorkerModels) and then
 * restarts the worker with the new set (which pulls + warms any new model and
 * re-attests readiness). Desktop only; acts on the worker that lives here.
 */
export function UpdateModels() {
  const { network } = useNetwork();
  const [os, setOs] = useState<OS>("macos");
  const [vramGb, setVramGb] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = detectClientOS();
    setOs(d === "windows" ? "windows" : d === "linux" ? "linux" : "macos");
  }, []);
  useEffect(() => {
    detectNativeHardware().then((hw) => {
      if (!hw) return;
      setVramGb(hw.unified ? Math.max(hw.ram_gb || 0, hw.vram_gb || 0) : hw.vram_gb || 0);
    });
  }, []);
  // Seed the selection from this network's recorded set.
  useEffect(() => {
    const cur = getServedModels(network);
    setSel(cur.length ? cur : [DEFAULT_MODEL]);
  }, [network]);
  useEffect(() => logEnd.current?.scrollIntoView({ behavior: "smooth" }), [log]);
  useEffect(() => () => stopRef.current?.(), []);

  const append = (line: string) => setLog((l) => [...l, line]);

  const current = getServedModels(network);
  const changed = sel.length > 0 && (sel.length !== current.length || sel.some((m) => !current.includes(m)));

  const apply = useCallback(async () => {
    if (!changed) return;
    setPhase("running");
    setLog([`$ updating served models to ${sel.join(", ")}...`]);
    const env: Record<string, string> = { NETWORK: network };
    const [pw, k] = await Promise.all([getSecret(SECRET_WORKER_PW, network), getSecret(SECRET_WORKER_KEY, network)]);
    if (pw) env.WORKER_PASSWORD = pw;
    const addr = getWorkerAddr(network);
    if (addr) env.WORKER_ADDR = addr;
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k) && keyMatchesAddr(k, addr)) env.WORKER_PRIVKEY = k;

    // 1) on-chain updateWorkerModels, then 2) restart the worker with the new set.
    stopRef.current = await runSetupStreamed(
      updateModelsCommand(os, network, sel),
      env,
      append,
      async (code) => {
        if (code !== 0) {
          append("exited - on-chain model update failed.");
          setPhase("failed");
          return;
        }
        setServedModels(network, sel);
        stopRef.current = await runSetupStreamed(
          desktopInstallCommand(os, network, sel),
          env,
          append,
          (code2) => {
            append(code2 === 0 ? "done." : `exited (${code2}).`);
            setPhase(code2 === 0 ? "done" : "failed");
          },
        );
      },
    );
  }, [changed, sel, os, network]);

  return (
    <Card className="p-6">
      <div className="mb-3 flex items-center gap-2">
        <Boxes className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Models this worker serves</h3>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-content-soft">
        Add or remove models live. This updates your on-chain model set and restarts the worker with it. No re-stake.
        Each model you serve must stay loaded in memory at once, so the picker flags a set that won&apos;t fit this machine.
      </p>

      {phase === "idle" || phase === "done" || phase === "failed" ? (
        <>
          <ModelPicker network={network} vramGb={vramGb} value={sel} onChange={setSel} />
          {phase === "done" && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" /> Updated. Give the worker about a minute to re-attest and go live.
            </p>
          )}
          {phase === "failed" && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
              <XCircle className="size-4" /> Update stopped. See the log below.
            </p>
          )}
          <Button variant="gradient" className="mt-4 w-full" disabled={!changed} onClick={apply}>
            <Boxes /> {changed ? `Apply (${sel.length} model${sel.length === 1 ? "" : "s"})` : "No changes"}
          </Button>
        </>
      ) : (
        <p className="inline-flex items-center gap-2 text-sm text-content-primary">
          <Loader2 className="size-4 animate-spin" /> Updating served models...
        </p>
      )}

      {log.length > 0 && (
        <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-bdr-soft bg-[#0b0b14] p-4 font-mono text-[12px] leading-relaxed text-content-default">
          <div className="mb-1.5 flex items-center gap-1.5 text-content-soft"><Terminal className="size-3" /> log</div>
          {log.map((l, i) => (<div key={i} className="whitespace-pre-wrap">{l}</div>))}
          <div ref={logEnd} />
        </div>
      )}
    </Card>
  );
}
