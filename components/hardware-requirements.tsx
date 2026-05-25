import Image from "next/image";
import { Cpu, MemoryStick, HardDrive, Sparkles } from "lucide-react";
import { HARDWARE, DEFAULT_MODEL } from "@/lib/network";

const { min, rec } = HARDWARE;

function tb(gb: number): string {
  return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`;
}

// Spec rows derived from the network HARDWARE config (single source of truth).
const ROWS = [
  { icon: Cpu, spec: "CPU", minimum: `${min.cores} Cores (x86_64)`, recommended: `${rec.cores} Cores (AMD/Intel)` },
  { icon: MemoryStick, spec: "RAM", minimum: `${min.ramGb}GB DDR4`, recommended: `${rec.ramGb}GB+ DDR5` },
  { icon: HardDrive, spec: "Storage", minimum: `${tb(min.storageGb)} NVMe SSD`, recommended: `${tb(rec.storageGb)} NVMe Gen4` },
  { icon: Sparkles, spec: "GPU", minimum: `${min.vramGb}GB VRAM (${DEFAULT_MODEL})`, recommended: `${rec.vramGb}GB+ VRAM (RTX 4090/A100)` },
];

const COLS = "grid grid-cols-[1.3fr_1fr_1.1fr] items-center gap-4";

/** Minimum vs recommended worker hardware, mirroring the LightChain run-node page
 *  (raised Recommended card) but driven by our HARDWARE config. */
export function HardwareRequirements() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-14">
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-52 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
          <Image
            src="/images/hardware-requirements-icon.webp"
            alt="Worker hardware"
            width={220}
            height={160}
            className="w-36 drop-shadow-[0_22px_50px_rgba(112,100,233,0.45)] md:w-40"
          />
        </div>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight text-content-primary md:text-4xl">
          Hardware Requirements
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-content-soft">
          Confirm your hardware clears the minimum spec, or matches the recommended spec for headroom, before you start
          onboarding.
        </p>
      </div>

      <div className="relative mt-12">
        {/* raised, highlighted Recommended column */}
        <div className="pointer-events-none absolute -top-4 bottom-0 right-0 w-[33%] rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/20 via-primary/[0.05] to-transparent shadow-[0_24px_70px_-24px_rgba(112,100,233,0.55)]" />

        <div className="relative overflow-hidden rounded-2xl border border-bdr-soft bg-card/40 backdrop-blur-sm">
          <div className={`${COLS} border-b border-bdr-soft px-6 py-4 text-xs font-semibold uppercase tracking-wider text-content-soft`}>
            <span>Specification</span>
            <span>Minimum</span>
            <span className="text-primary">Recommended</span>
          </div>
          {ROWS.map((r) => (
            <div key={r.spec} className={`${COLS} border-b border-bdr-light px-6 py-5 text-sm last:border-b-0`}>
              <span className="flex items-center gap-2.5 font-medium text-content-primary">
                <r.icon className="size-4 shrink-0 text-content-soft" /> {r.spec}
              </span>
              <span className="text-content-soft">{r.minimum}</span>
              <span className="font-semibold text-content-primary">{r.recommended}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
