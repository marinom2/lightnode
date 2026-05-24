"use client";

import { useEffect, useMemo, useState } from "react";
import { Cpu, MemoryStick, HardDrive, MonitorCog, Sparkles, AlertTriangle, Coins } from "lucide-react";
import { assessMachine, autodetect, estimateRewards, type MachineInput } from "@/lib/hardware";
import { fmt } from "@/lib/utils";
import type { OS } from "@/lib/scriptgen";
import { Badge } from "@/components/ui/badge";

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
  onResult: (r: { eligible: boolean; os: OS }) => void;
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

  useEffect(() => {
    const d = autodetect();
    setM((prev) => ({ ...prev, ...d, ramGb: d.ramGb ? Math.max(prev.ramGb, d.ramGb) : prev.ramGb }));
    // seed a conservative jobs/day from observed throughput, capped sanely
    if (avgJobsPerLiveWorker > 0) setJobsPerDay(Math.min(200, Math.max(10, Math.round(avgJobsPerLiveWorker / 7))));
  }, [avgJobsPerLiveWorker]);

  const a = useMemo(() => assessMachine(m), [m]);
  const reward = useMemo(() => estimateRewards(jobsPerDay), [jobsPerDay]);

  useEffect(() => {
    onResult({ eligible: a.workerEligible, os: m.os });
  }, [a.workerEligible, m.os, onResult]);

  const ring = a.score >= 75 ? "#1fc16b" : a.score >= 45 ? "#7064e9" : "#f6b51e";

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      {/* inputs */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
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
          We pre-filled what the browser can see (cores, OS, GPU name). VRAM and RAM you confirm — the browser can&apos;t read them reliably.
        </p>

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
        <div className="rounded-2xl border border-bdr-soft bg-card/60 p-5 text-center">
          <div
            className="mx-auto grid size-28 place-items-center rounded-full"
            style={{ background: `conic-gradient(${ring} ${a.score * 3.6}deg, var(--surface-base-faint) 0deg)` }}
          >
            <div className="grid size-[5.25rem] place-items-center rounded-full bg-card">
              <span className="text-3xl font-semibold text-content-primary">{a.score}</span>
            </div>
          </div>
          <div className="mt-3 text-sm font-medium text-content-primary">Machine score</div>
          <div className="mt-1 text-xs text-content-soft">{a.tierLabel}</div>
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
            {fmt(reward.perJobLcai, 3)} LCAI per completed job (80% of the 0.02 fee). Actual earnings depend on
            network demand and routing — this is an estimate, not a guarantee.
          </p>
        </div>
      </div>
    </div>
  );
}
