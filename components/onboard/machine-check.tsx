"use client";

import { useEffect, useMemo, useState } from "react";
import { Cpu, MemoryStick, HardDrive, MonitorCog, Sparkles, AlertTriangle, Coins, ScanLine, Pencil, Zap } from "lucide-react";
import { assessMachine, autodetect, estimateRewards, energyCostPerDay, type MachineInput } from "@/lib/hardware";
import { detectNativeHardware, bridgeInfo, lastHardwareError } from "@/lib/tauri";
import { fmt } from "@/lib/utils";
import type { OS } from "@/lib/scriptgen";
import { Badge } from "@/components/ui/badge";
import { RadialGauge } from "@/components/ui/radial-gauge";

const VRAM_OPTIONS = [0, 6, 8, 12, 16, 24, 48, 80];
const RAM_OPTIONS = [8, 16, 32, 64, 128];
const STORAGE_OPTIONS = [256, 512, 1024, 2048];

function Field({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-content-soft">
        <Icon className="size-3.5" /> {label}
      </span>
      {children}
    </label>
  );
}

const selectCls =
  "h-10 rounded-lg border border-bdr-soft bg-surface-base-subtle px-3 text-sm text-content-primary outline-none focus:border-primary";

export function MachineCheck({
  onResult,
  avgJobsPerLiveWorker,
}: {
  onResult: (r: { eligible: boolean; vramOk: boolean; os: OS; vramGb: number }) => void;
  avgJobsPerLiveWorker: number;
}) {
  const [m, setM] = useState<MachineInput>({
    cores: 8,
    ramGb: 16,
    vramGb: 8,
    storageGb: 512,
    os: "linux",
    gpuName: "",
  });
  const [jobsPerDay, setJobsPerDay] = useState(50);
  const [detected, setDetected] = useState<{ vramInferred: boolean; unified: boolean; gpuLabel?: string } | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [diag, setDiag] = useState<{ env: "web" | "desktop"; detail: string } | null>(null);

  useEffect(() => {
    const d = autodetect();
    setM((prev) => ({
      ...prev,
      ...d.input,
      ramGb: d.input.ramGb ? Math.max(prev.ramGb, d.input.ramGb) : prev.ramGb,
      unified: d.unified,
    }));
    setDetected({ vramInferred: d.vramInferred, unified: d.unified, gpuLabel: d.gpuLabel });
    setShowEdit(!d.vramInferred && !d.unified); // open the form only if we couldn't infer VRAM
    if (avgJobsPerLiveWorker > 0) setJobsPerDay(Math.min(200, Math.max(10, Math.round(avgJobsPerLiveWorker / 7))));

    // In the desktop shell: real OS-level detection (true VRAM) overrides guesses.
    const info = bridgeInfo();
    detectNativeHardware().then((nat) => {
      if (!nat) {
        setDiag(
          info.inDesktop
            ? {
                env: "desktop",
                detail: `Desktop detected (internals:${info.hasInternals} global:${info.hasGlobal}) but the hardware read failed${lastHardwareError() ? ` - ${lastHardwareError()}` : ""}.`,
              }
            : { env: "web", detail: "Running in a web browser - open the LightNode desktop app for full no-input auto-detection." },
        );
        return;
      }
      setDiag({ env: "desktop", detail: "Auto-detected from the desktop app." });
      setM((prev) => ({
        ...prev,
        os: nat.os,
        cores: nat.cores || prev.cores,
        ramGb: nat.ram_gb || prev.ramGb,
        vramGb: nat.unified ? Math.max(nat.ram_gb || prev.ramGb, 16) : nat.vram_gb ?? prev.vramGb,
        gpuName: nat.gpu || prev.gpuName,
        unified: nat.unified,
      }));
      setDetected({ vramInferred: nat.vram_gb != null, unified: nat.unified, gpuLabel: nat.gpu });
      setShowEdit(false);
    });
  }, [avgJobsPerLiveWorker]);

  const [watts, setWatts] = useState(200);
  const [pricePerKwh, setPricePerKwh] = useState(0.15);

  const a = useMemo(() => assessMachine(m), [m]);
  const reward = useMemo(() => estimateRewards(jobsPerDay), [jobsPerDay]);
  const energyCost = useMemo(() => energyCostPerDay(watts, pricePerKwh), [watts, pricePerKwh]);

  useEffect(() => {
    onResult({ eligible: a.workerEligible, vramOk: a.vramOk, os: m.os, vramGb: m.vramGb });
  }, [a.workerEligible, a.vramOk, m.os, m.vramGb, onResult]);

  const grad: [string, string] =
    a.score >= 75 ? ["#1fc16b", "#46e09a"] : a.score >= 45 ? ["#7064e9", "#b06ae0"] : ["#f6b51e", "#f7c948"];

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      {/* inputs */}
      <div className="space-y-4">
        {detected && (detected.vramInferred || detected.unified) && (
          <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3">
            <ScanLine className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="text-xs text-content-default">
              <span className="font-medium text-content-primary">Auto-detected your machine.</span>{" "}
              {detected.gpuLabel ? `GPU: ${detected.gpuLabel}. ` : ""}
              {detected.unified
                ? `Apple Silicon, ${Math.max(m.ramGb, m.vramGb)}GB unified memory. llama3-8b fits comfortably.`
                : `Inferred ~${m.vramGb}GB VRAM.`}{" "}
              <button onClick={() => setShowEdit((s) => !s)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Pencil className="size-3" /> {showEdit ? "Hide" : "Adjust"}
              </button>
            </div>
          </div>
        )}

        {/* read-only view of what we detected (so the numbers are visible) */}
        {detected && !showEdit && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: "Operating system", value: { macos: "macOS", linux: "Linux", windows: "Windows" }[m.os] },
              { label: "Detected GPU", value: m.gpuName || "Unknown" },
              {
                label: detected.unified ? "Unified memory (RAM + GPU)" : "GPU VRAM",
                value: detected.unified ? `${Math.max(m.ramGb, m.vramGb)} GB shared` : `${m.vramGb} GB`,
              },
              // On Apple Silicon RAM and VRAM are one pool, so a separate
              // "System RAM" figure (which the browser caps at 8GB) is both
              // redundant and misleading - omit it.
              ...(detected.unified ? [] : [{ label: "System RAM", value: `${m.ramGb} GB` }]),
              { label: "CPU cores", value: `${m.cores}` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-bdr-soft bg-surface-base-subtle px-3 py-2">
                <div className="text-[11px] text-content-soft">{s.label}</div>
                <div className="truncate text-sm font-medium text-content-primary">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className={showEdit ? "grid grid-cols-2 gap-3" : "hidden"}>
          <Field icon={MonitorCog} label="Operating system">
            <select className={selectCls} value={m.os} onChange={(e) => setM({ ...m, os: e.target.value as MachineInput["os"] })}>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </Field>
          <Field icon={Sparkles} label="GPU VRAM">
            <select className={selectCls} value={m.vramGb} onChange={(e) => setM({ ...m, vramGb: Number(e.target.value) })}>
              {VRAM_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "No dedicated GPU / CPU only" : `${v} GB`}
                </option>
              ))}
            </select>
          </Field>
          <Field icon={MemoryStick} label="System RAM">
            <select className={selectCls} value={m.ramGb} onChange={(e) => setM({ ...m, ramGb: Number(e.target.value) })}>
              {RAM_OPTIONS.map((v) => (
                <option key={v} value={v}>{v} GB</option>
              ))}
            </select>
          </Field>
          <Field icon={Cpu} label="CPU cores">
            <input
              type="number"
              min={1}
              className={selectCls}
              value={m.cores}
              onChange={(e) => setM({ ...m, cores: Number(e.target.value) || 1 })}
            />
          </Field>
          <Field icon={HardDrive} label="Free storage">
            <select className={selectCls} value={m.storageGb} onChange={(e) => setM({ ...m, storageGb: Number(e.target.value) })}>
              {STORAGE_OPTIONS.map((v) => (
                <option key={v} value={v}>{v >= 1024 ? `${v / 1024} TB` : `${v} GB`}</option>
              ))}
            </select>
          </Field>
          <Field icon={Sparkles} label="Detected GPU">
            <input
              className={selectCls}
              placeholder="auto-detected"
              value={m.gpuName ?? ""}
              onChange={(e) => setM({ ...m, gpuName: e.target.value })}
            />
          </Field>
        </div>
        <p className="text-xs text-content-soft">
          {showEdit
            ? "A browser can't read VRAM/RAM directly - confirm the values above. Full no-input auto-detection is coming in the LightNode desktop app."
            : "Detected automatically from your browser. Wrong GPU? Hit Adjust."}
        </p>
        {diag && (
          <p
            className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${
              diag.env === "desktop"
                ? "border-warning/30 bg-warning/10 text-content-default"
                : "border-bdr-soft bg-surface-base-faint text-content-soft"
            }`}
          >
            diag · {diag.detail}
          </p>
        )}

        {a.notes.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-warning/30 bg-warning/10 p-3">
            {a.notes.map((n) => (
              <p key={n} className="flex items-start gap-2 text-xs text-content-default">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> {n}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* score + rewards */}
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl border border-bdr-soft bg-card/60 p-6 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 size-48 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
            style={{ background: `radial-gradient(circle, ${grad[1]}, transparent 70%)` }}
          />
          <RadialGauge value={a.score / 100} gradient={grad} size={176} className="mx-auto">
            <div>
              <div className="text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums text-content-primary">
                {a.score}
              </div>
              <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-content-soft">out of 100</div>
            </div>
          </RadialGauge>
          <div className="mt-4 text-sm font-semibold text-content-primary">Machine score</div>
          <div className="mt-1 text-xs leading-relaxed text-content-soft">{a.tierLabel}</div>
          <div className="mt-3">
            {a.vramOk ? (
              <Badge tone="success">✓ Worker-eligible</Badge>
            ) : a.cpuFallback ? (
              <Badge tone="warning">CPU fallback only</Badge>
            ) : (
              <Badge tone="danger">Below minimum</Badge>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-bdr-soft bg-card/60 p-5">
          <div className="flex items-center gap-2 text-content-soft">
            <Coins className="size-4" />
            <span className="text-xs font-medium">Reward estimate</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-content-primary">{fmt(reward.dailyLcai, 2)}</span>
            <span className="text-sm text-content-soft">LCAI / day</span>
          </div>
          <div className="text-xs text-content-soft">≈ {fmt(reward.monthlyLcai, 0)} LCAI / month</div>

          <label className="mt-4 block text-xs text-content-soft">
            Assumed jobs/day: <span className="font-medium text-content-primary">{jobsPerDay}</span>
            <input
              type="range"
              min={5}
              max={400}
              value={jobsPerDay}
              onChange={(e) => setJobsPerDay(Number(e.target.value))}
              className="mt-1.5 w-full accent-[var(--primary)]"
            />
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-content-soft">
            {fmt(reward.perJobLcai, 3)} LCAI per job · varies with demand &amp; routing.
          </p>

          <div className="mt-4 border-t border-bdr-light pt-3">
            <div className="flex items-center gap-2 text-content-soft">
              <Zap className="size-3.5" />
              <span className="text-xs font-medium">Running cost</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-content-soft">
                GPU draw (W)
                <input
                  type="number"
                  min={0}
                  value={watts}
                  onChange={(e) => setWatts(Number(e.target.value) || 0)}
                  className="mt-1 h-8 w-full rounded-md border border-bdr-soft bg-surface-base-subtle px-2 text-sm text-content-primary outline-none focus:border-primary"
                />
              </label>
              <label className="text-[11px] text-content-soft">
                $/kWh
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={pricePerKwh}
                  onChange={(e) => setPricePerKwh(Number(e.target.value) || 0)}
                  className="mt-1 h-8 w-full rounded-md border border-bdr-soft bg-surface-base-subtle px-2 text-sm text-content-primary outline-none focus:border-primary"
                />
              </label>
            </div>
            <div className="mt-2 flex items-baseline justify-between text-xs">
              <span className="text-content-soft">Energy ≈</span>
              <span className="font-medium text-content-primary">
                ${fmt(energyCost, 2)}/day · ${fmt(energyCost * 30, 0)}/mo
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-content-soft">
              Net profit = {fmt(reward.dailyLcai, 2)} LCAI/day minus ${fmt(energyCost, 2)} energy - positive once LCAI
              clears your power cost. (We don&apos;t price LCAI here.)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
