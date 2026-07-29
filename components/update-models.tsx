"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { privateKeyToAccount } from "viem/accounts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "@/components/onboard/model-picker";
import { InstallProgress } from "@/components/onboard/install-progress";
import { useNetwork } from "@/lib/network-context";
import { autodetect, detectWebGpu } from "@/lib/hardware";
import { isModelId, lookupModel } from "@/lib/model-catalog";
import { DEFAULT_MODEL, NETWORKS } from "@/lib/network";
import { addModelsCommand, desktopInstallCommand, type OS } from "@/lib/scriptgen";
import { appendCleanLog } from "@/lib/install-log";
import { detectClientOS } from "@/lib/os-detect";
import { runSetupStreamed, detectNativeHardware, fetchWorkerHealth } from "@/lib/tauri";
import { getSecret, getWorkerAddr, resolveManagedWorkerAddr, getServedModels, setServedModels, SECRET_WORKER_KEY, SECRET_WORKER_PW } from "@/lib/secrets";

type Phase = "idle" | "running" | "done" | "failed";

/**
 * Fold a stored model reference back to its servable tag.
 *
 * Everything downstream - SUPPORTED_MODELS, `ollama pull`, add-models' keccak -
 * consumes the TAG, but a record written before model ids and tags were told
 * apart can hold the on-chain id instead. The catalog inverts the ones we know;
 * anything it cannot invert is returned untouched, so callers can still spot it.
 */
function tagOf(model: string): string {
  return lookupModel(model)?.tag ?? model;
}

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
  // Memory available to keep models warm. `known` is separate from the number:
  // an unread VRAM is 0, and a gate that measures every model against 0GB is a
  // gate that lies. See the detection effect below.
  const [vram, setVram] = useState<{ gb: number; known: boolean }>({ gb: 0, known: false });
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
  // Same precedence the onboarding machine check uses: the desktop shell reads
  // VRAM from the OS, and where that comes back empty (no discrete GPU reported,
  // an older binary, a failed nvidia-smi) we fall back to the browser's GPU-name
  // inference. If BOTH come back empty we record known:false so the picker drops
  // its memory gate instead of showing a false one against 0GB.
  useEffect(() => {
    let on = true;
    detectNativeHardware().then(async (hw) => {
      if (!on) return;
      // Apple Silicon shares one pool, so the GPU can draw on system RAM.
      const native = hw ? (hw.unified ? Math.max(hw.ram_gb || 0, hw.vram_gb || 0) : (hw.vram_gb ?? 0)) : 0;
      if (native > 0) {
        setVram({ gb: native, known: true });
        return;
      }
      const d = autodetect(); // WebGL renderer -> known-GPU table; unified already floors at 16
      let gb = d.input.vramGb ?? 0;
      if (!gb) {
        // Some webviews mask the WebGL renderer string but still expose a WebGPU adapter.
        const w = await detectWebGpu();
        gb = w.unified ? Math.max(d.input.ramGb ?? 16, 16) : (w.vramGb ?? 0);
      }
      if (!on) return;
      setVram(gb > 0 ? { gb, known: true } : { gb: 0, known: false });
    });
    return () => {
      on = false;
    };
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

  // Compare on identity, not on the raw string: an id sitting next to its own
  // tag would otherwise read as one addition plus one removal, blocking the
  // whole panel over a naming artefact. Both sides compare - and `additions` is
  // sent on chain - as real tags.
  const additions = sel.filter((m) => !current.some((c) => tagOf(c) === tagOf(m))).map(tagOf);
  const removals = current.filter((m) => !sel.some((s) => tagOf(s) === tagOf(m)));
  // You can ADD models live; removing one isn't safe live (the gateway could still
  // route its jobs to you), so a set that drops a current model is blocked here.
  // add-models hashes whatever string it is handed, so an id we could not fold
  // back to a tag would register a second, meaningless model on chain and stake
  // against it - refuse rather than sign that.
  const canApply = additions.length > 0 && removals.length === 0 && !additions.some(isModelId);
  // A disabled button with no reason is indistinguishable from a broken one -
  // and this panel spent a release genuinely broken (the picker used to drop
  // the locked set on mount, which made `removals` non-empty and left Apply
  // dead with nothing on screen to explain it). Say which guard is holding.
  const blockedReason =
    removals.length > 0
      ? `Your selection drops ${removals.join(", ")}. Models can only be added here - deregister and reinstall to serve a smaller set.`
      : additions.some(isModelId)
        ? "One of the models you picked has no published name, only an on-chain id. It can't be pulled or registered from here."
        : null;

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
        // The container pulls SUPPORTED_MODELS verbatim, so fold any id the
        // seeded set still carries back to its tag before it goes in (and
        // before we record it as this network's served set).
        const served = sel.map(tagOf);
        setServedModels(network, served);
        stopRef.current = await runSetupStreamed(
          desktopInstallCommand(os, network, served),
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
          <ModelPicker network={network} vramGb={vram.gb} vramKnown={vram.known} value={sel} onChange={setSel} locked={current} />
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
          {blockedReason && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {blockedReason}
            </p>
          )}
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
