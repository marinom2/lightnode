import Image from "next/image";
import { Cpu, MemoryStick, HardDrive, Sparkles, Gauge, type LucideIcon } from "lucide-react";
import { HARDWARE, DEFAULT_MODEL } from "@/lib/network";

const { min, rec } = HARDWARE;

function tb(gb: number): string {
  return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`;
}

function net(mbps: number): string {
  return mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`;
}

interface Row {
  icon: LucideIcon;
  spec: string;
  minimum: string;
  recommended: string;
}

// Spec rows derived from the network HARDWARE config (single source of truth).
const ROWS: Row[] = [
  { icon: Cpu, spec: "CPU", minimum: `${min.cores} Cores (x86_64)`, recommended: `${rec.cores} Cores (AMD/Intel)` },
  { icon: MemoryStick, spec: "RAM", minimum: `${min.ramGb}GB DDR4`, recommended: `${rec.ramGb}GB+ DDR5` },
  { icon: HardDrive, spec: "Storage", minimum: `${tb(min.storageGb)} NVMe SSD`, recommended: `${tb(rec.storageGb)} NVMe Gen4` },
  { icon: Sparkles, spec: "GPU", minimum: `${min.vramGb}GB VRAM (${DEFAULT_MODEL})`, recommended: `${rec.vramGb}GB+ VRAM (RTX 4090/A100)` },
  { icon: Gauge, spec: "Internet", minimum: `${net(min.mbps)} Up/Down`, recommended: `${net(rec.mbps)} Symmetric` },
];

const HEAD = "flex h-14 items-center px-6 text-xs font-semibold uppercase tracking-wider";
const CELL = "flex h-16 items-center px-6 text-sm border-b border-bdr-light last:border-b-0";

/** Minimum vs recommended worker hardware, mirroring the LightChain run-node page:
 *  the Recommended column is an elevated, purple-topped card. Driven by HARDWARE config. */
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

      <div className="mt-12 overflow-x-auto pb-6 pt-4">
        <div className="mx-auto flex min-w-[620px] max-w-4xl">
          {/* base panel: Specification + Minimum */}
          <div className="flex flex-[2.2] overflow-hidden rounded-2xl border border-bdr-soft bg-card/40">
            <div className="flex-[1.3]">
              <div className={`${HEAD} border-b border-bdr-soft text-content-soft`}>Specification</div>
              {ROWS.map((r) => (
                <div key={r.spec} className={`${CELL} gap-2.5 font-medium text-content-primary`}>
                  <r.icon className="size-4 shrink-0 text-content-soft" /> {r.spec}
                </div>
              ))}
            </div>
            <div className="flex-1">
              <div className={`${HEAD} border-b border-bdr-soft text-content-soft`}>Minimum</div>
              {ROWS.map((r) => (
                <div key={r.spec} className={`${CELL} text-content-soft`}>
                  {r.minimum}
                </div>
              ))}
            </div>
          </div>

          {/* elevated Recommended card (lifted above the base panel) */}
          <div className="-my-3 flex-[1.15] rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.18] via-card/85 to-card/70 shadow-[0_30px_80px_-28px_rgba(112,100,233,0.6)] backdrop-blur-sm">
            <div className={`${HEAD} h-[68px] pt-3 text-primary`}>Recommended</div>
            {ROWS.map((r) => (
              <div key={r.spec} className={`${CELL} border-white/5 font-semibold text-content-primary`}>
                {r.recommended}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
