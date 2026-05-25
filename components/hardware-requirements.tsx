import Image from "next/image";
import { Cpu, MemoryStick, HardDrive, Sparkles, Gauge } from "lucide-react";
import { HARDWARE, DEFAULT_MODEL } from "@/lib/network";

const { min, rec } = HARDWARE;

function tb(gb: number): string {
  return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`;
}

// Spec rows are derived from the network HARDWARE config (single source of truth).
const ROWS = [
  { icon: Cpu, spec: "CPU", minimum: `${min.cores} cores (x86_64)`, recommended: `${rec.cores}+ cores` },
  { icon: MemoryStick, spec: "RAM", minimum: `${min.ramGb}GB`, recommended: `${rec.ramGb}GB+` },
  { icon: HardDrive, spec: "Storage", minimum: `${tb(min.storageGb)} NVMe SSD`, recommended: `${tb(rec.storageGb)} NVMe Gen4` },
  { icon: Sparkles, spec: "GPU VRAM", minimum: `${min.vramGb}GB (${DEFAULT_MODEL})`, recommended: `${rec.vramGb}GB+ (RTX 4090 / A100)` },
  { icon: Gauge, spec: "Network", minimum: `${min.mbps} Mbps`, recommended: `${rec.mbps} Mbps` },
];

/** Minimum vs recommended worker hardware, mirroring the LightChain run-node page
 *  but driven by our HARDWARE config so it never drifts from the assessment. */
export function HardwareRequirements() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
          <Image
            src="/images/hardware-requirements-icon.webp"
            alt="Worker hardware"
            width={132}
            height={96}
            className="w-24 drop-shadow-[0_16px_40px_rgba(112,100,233,0.4)]"
          />
        </div>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-content-primary md:text-3xl">
          Hardware requirements
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-content-soft">
          Confirm your hardware clears the minimum spec, or matches the recommended spec for headroom, before you start
          onboarding.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-bdr-soft bg-card/60">
        <div className="grid grid-cols-3 border-b border-bdr-soft bg-surface-base-subtle px-5 py-3 text-xs font-medium uppercase tracking-wide text-content-soft">
          <span>Specification</span>
          <span>Minimum</span>
          <span className="text-primary">Recommended</span>
        </div>
        {ROWS.map((r) => (
          <div key={r.spec} className="grid grid-cols-3 items-center border-b border-bdr-light px-5 py-3.5 text-sm last:border-b-0">
            <span className="flex items-center gap-2 font-medium text-content-primary">
              <r.icon className="size-4 text-content-soft" /> {r.spec}
            </span>
            <span className="text-content-default">{r.minimum}</span>
            <span className="font-medium text-content-primary">{r.recommended}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
