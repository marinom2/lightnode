"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { privateKeyToAccount } from "viem/accounts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "@/components/onboard/model-picker";
import { InstallProgress } from "@/components/onboard/install-progress";
import { useNetwork } from "@/lib/network-context";
import { DEFAULT_MODEL, NETWORKS } from "@/lib/network";
import { addModelsCommand, desktopInstallCommand, type OS } from "@/lib/scriptgen";
import { appendCleanLog } from "@/lib/install-log";
import { detectClientOS } from "@/lib/os-detect";
import { runSetupStreamed, detectNativeHardware, fetchWorkerHealth } from "@/lib/tauri";
import { getSecret, getWorkerAddr, resolveManagedWorkerAddr, getServedModels, setServedModels, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";

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
  // The set the worker ACTUALLY serves right now (the locked/can't-remove base the
  // picker adds onto). Authoritative source is the running container's
  // SUPPORTED_MODELS; we seed from the local record for an instant render, then
  // reconcile - the local record can drift if a model-change install was
  // interrupted after recording its intended (not-yet-applied) set.
  const [current, setCurrent] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

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
  // Seed from this network's recorded set for an instant render, then reconcile
  // with the worker actually running here (its container SUPPORTED_MODELS is the
  // truth - the local record can show a set a prior interrupted install intended
  // but never applied, e.g. showing a model as "serving" that the worker never
  // switched to).
  useEffect(() => {
    const recorded = getServedModels(network);
    const seed = recorded.length ? recorded : [DEFAULT_MODEL];
    setCurrent(seed);
    setSel(seed);
    let on = true;
    let tries = 0;
    // fetchWorkerHealth shares one native channel with the dashboard's health
    // poller and returns null while that's mid-read (or Docker is down). Retry a
    // few times so a momentary collision doesn't leave the stale local set showing.
    const reconcile = () => {
      if (!on) return;
      fetchWorkerHealth().then((h) => {
        if (!on) return;
        if (!h) {
          if (++tries < 4) setTimeout(reconcile, 1500);
          return;
        }
        if (h.servedModels.length === 0) return;
        // Only trust the running container if it's THIS network's worker.
        if (h.chainId != null && h.chainId !== NETWORKS[network].chainId) return;
        setCurrent(h.servedModels);
        setSel(h.servedModels);
        setServedModels(network, h.servedModels); // heal the drifted local record
      });
    };
    reconcile();
    return () => {
      on = false;
    };
  }, [network]);
  useEffect(() => () => stopRef.current?.(), []);

  const append = (line: string) => setLog((l) => appendCleanLog(l, line));

  const additions = sel.filter((m) => !current.includes(m));
  const removals = current.filter((m) => !sel.includes(m));
  // You can ADD models live; removing one isn't safe live (the gateway could still
  // route its jobs to you), so a set that drops a current model is blocked here.
  const canApply = additions.length > 0 && removals.length === 0;

  const apply = useCallback(async () => {
    if (!canApply) return;
    setPhase("running");
    setLog([`$ adding model(s): ${additions.join(", ")}...`]);
    const env: Record<string, string> = { NETWORK: network };
    const [pw, k] = await Promise.all([getSecret(SECRET_WORKER_PW, network), getSecret(SECRET_WORKER_KEY, network)]);
    if (pw) env.WORKER_PASSWORD = pw;
    // Target the worker the app holds the key for, so add-models signs with THIS
    // network's keystore, not a stale stored address.
    const addr = (await resolveManagedWorkerAddr(network)) || getWorkerAddr(network);
    if (addr) env.WORKER_ADDR = addr;
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k) && keyMatchesAddr(k, addr)) env.WORKER_PRIVKEY = k;

    // 1) add the new models on-chain (binary add-models), then 2) restart the
    // worker advertising the full set (pulls + warms the new model).
    stopRef.current = await runSetupStreamed(
      addModelsCommand(os, network, additions),
      env,
      append,
      async (code) => {
        if (code !== 0) {
          append("exited - adding the model on-chain failed.");
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
  }, [canApply, additions, sel, os, network]);

  return (
    <Card className="p-6">
      <div className="mb-3 flex items-center gap-2">
        <Boxes className="size-4 text-content-soft" />
        <h3 className="text-sm font-semibold text-content-primary">Models this worker serves</h3>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-content-soft">
        Add a model to what this worker already serves. This adds it to your on-chain set and restarts the worker, with no
        re-stake. Every served model must stay loaded in memory at once, so the picker flags a set that won&apos;t fit this
        machine. To drop a model, deregister and reinstall with the smaller set (removing one live isn&apos;t safe - the
        network could still send you its jobs).
      </p>

      {phase === "idle" || phase === "done" || phase === "failed" ? (
        <>
          <ModelPicker network={network} vramGb={vramGb} value={sel} onChange={setSel} locked={current} />
          {phase === "done" && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" /> Updated. Give the worker about a minute to re-attest and go live.
            </p>
          )}
          {phase === "failed" && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
              <XCircle className="size-4" /> Adding the model stopped. See the log below.
            </p>
          )}
          <p className="mt-3 text-[11px] text-content-soft">
            Want to drop {current.length === 1 ? "this model" : "a model"} and serve a different one instead? Deregister this
            worker (Operations above), then reinstall and pick the model set you want. Removing one while registered isn&apos;t
            safe, so it can&apos;t be unselected here.
          </p>
          <Button variant="gradient" className="mt-3 w-full" disabled={!canApply} onClick={apply}>
            <Boxes /> {additions.length > 0 ? `Add ${additions.join(", ")}` : "Select a model to add"}
          </Button>
        </>
      ) : (
        <p className="inline-flex items-center gap-2 text-sm text-content-primary">
          <Loader2 className="size-4 animate-spin" /> Updating served models...
        </p>
      )}

      {log.length > 0 && phase !== "idle" && (
        <div className="mt-4">
          <InstallProgress log={log} phase={phase} />
        </div>
      )}
    </Card>
  );
}
