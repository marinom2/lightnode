/**
 * Machine scoring + role recommendation for the onboarding flow.
 *
 * The score is a transparent, capacity-oriented heuristic - VRAM dominates
 * because that's what gates serving llama3-8b through Ollama. We never pretend
 * the score is the barrier to entry: the real gate is the 50,000 LCAI stake,
 * which we surface explicitly in the UI.
 */
import { HARDWARE } from "./network";

export interface MachineInput {
  cores: number;
  ramGb: number;
  vramGb: number; // 0 = CPU-only / no dedicated GPU
  storageGb: number;
  os: "macos" | "linux" | "windows";
  gpuName?: string;
}

export type Tier = "below" | "eligible" | "strong" | "premium";

export interface MachineAssessment {
  score: number; // 0-100
  tier: Tier;
  tierLabel: string;
  vramOk: boolean;
  workerEligible: boolean; // can serve (GPU ≥8GB, or CPU fallback)
  cpuFallback: boolean; // no/low GPU but could still run slowly on CPU
  notes: string[];
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function assessMachine(m: MachineInput): MachineAssessment {
  const notes: string[] = [];

  // sub-scores (each 0-1)
  const vramScore = clamp((m.vramGb / HARDWARE.rec.vramGb) * 100) / 100; // 24GB = full
  const ramScore = clamp((m.ramGb / HARDWARE.rec.ramGb) * 100) / 100;
  const coreScore = clamp((m.cores / HARDWARE.rec.cores) * 100) / 100;
  const storageScore = m.storageGb >= HARDWARE.min.storageGb ? 1 : m.storageGb / HARDWARE.min.storageGb;

  // VRAM-weighted (60/20/15/5)
  const raw = vramScore * 0.6 + ramScore * 0.2 + coreScore * 0.15 + storageScore * 0.05;
  const score = Math.round(clamp(raw * 100));

  const vramOk = m.vramGb >= HARDWARE.min.vramGb;
  const cpuFallback = !vramOk && m.ramGb >= HARDWARE.min.ramGb;

  let tier: Tier;
  let tierLabel: string;
  if (m.vramGb >= HARDWARE.rec.vramGb) {
    tier = "premium";
    tierLabel = "Premium - headroom for larger models";
  } else if (m.vramGb >= 12) {
    tier = "strong";
    tierLabel = "Strong - comfortably serves llama3-8b";
  } else if (vramOk) {
    tier = "eligible";
    tierLabel = "Eligible - meets the 8GB minimum";
  } else {
    tier = "below";
    tierLabel = cpuFallback ? "Below GPU minimum - CPU fallback only (slow)" : "Below minimum spec";
  }

  if (!vramOk && cpuFallback)
    notes.push("No 8GB+ GPU detected. You can still run on CPU, but inference will be slow and may risk completion timeouts.");
  if (m.ramGb < HARDWARE.min.ramGb) notes.push(`RAM is below the ${HARDWARE.min.ramGb}GB minimum.`);
  if (m.storageGb < HARDWARE.min.storageGb) notes.push(`Storage is below the ${HARDWARE.min.storageGb}GB minimum.`);
  if (m.vramGb >= HARDWARE.rec.vramGb)
    notes.push("Enough VRAM to be a candidate for future premium models (e.g. 70B-class) if they're whitelisted.");

  return {
    score,
    tier,
    tierLabel,
    vramOk,
    workerEligible: vramOk || cpuFallback,
    cpuFallback,
    notes,
  };
}

/**
 * Best-effort VRAM inference from a WebGL renderer string. Returns the likely
 * VRAM in GB for known discrete GPUs, or `{ unified: true }` for Apple Silicon
 * (where the GPU shares system memory). Heuristic - the user can override.
 */
export function inferGpu(renderer: string): { vramGb?: number; unified?: boolean; clean: string } {
  const r = renderer.toLowerCase();
  const clean =
    renderer
      .replace(/^angle\s*\(/i, "")
      .replace(/\bdirect3d\d+.*$/i, "")
      .replace(/\bvs_\d.*$/i, "")
      .replace(/[(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || renderer;

  if (/apple\s*m\d/.test(r)) return { unified: true, clean };

  const table: [RegExp, number][] = [
    [/h100|h200|a100|a800/, 80],
    [/l40|a6000|a40/, 48],
    [/rtx\s*5090/, 32],
    [/rtx\s*(4090|3090)|a10\b|l4\b|rtx\s*a5000/, 24],
    [/rtx\s*(4080|5080|5060\s*ti)|t4\b|v100/, 16],
    [/rtx\s*(4070|3080|5070|3060(?!\s*ti))/, 12],
    [/rtx\s*(3070|4060|5060|2080|2070|3060\s*ti)/, 8],
  ];
  for (const [re, v] of table) if (re.test(r)) return { vramGb: v, clean };
  return { clean };
}

export interface Detected {
  input: Partial<MachineInput>;
  vramInferred: boolean;
  unified: boolean;
  gpuLabel?: string;
}

/** Browser best-effort autodetect - fills cores, OS, GPU, and *infers* VRAM. */
export function autodetect(): Detected {
  if (typeof navigator === "undefined") return { input: {}, vramInferred: false, unified: false };
  const input: Partial<MachineInput> = {};
  let vramInferred = false;
  let unified = false;
  let gpuLabel: string | undefined;

  const cores = navigator.hardwareConcurrency;
  if (cores) input.cores = cores;
  const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (dm) input.ramGb = dm; // coarse (capped at 8) - treat as a floor

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) input.os = "macos";
  else if (ua.includes("win")) input.os = "windows";
  else if (ua.includes("linux") || ua.includes("x11")) input.os = "linux";

  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && dbg) {
      const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
      if (renderer) {
        const g = inferGpu(renderer);
        input.gpuName = g.clean;
        gpuLabel = g.clean;
        if (g.vramGb) {
          input.vramGb = g.vramGb;
          vramInferred = true;
        }
        if (g.unified) {
          unified = true;
          // Apple Silicon shares memory; assume the GPU can use the system RAM.
          input.vramGb = Math.max(input.ramGb ?? 16, 16);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { input, vramInferred, unified, gpuLabel };
}

const WORKER_FEE_LCAI = 0.02;
const WORKER_SHARE = 0.8; // 80% of the fee goes to the worker

/** Per-job take-home for the worker at the current fee. */
export const workerSharePerJob = WORKER_FEE_LCAI * WORKER_SHARE; // 0.016 LCAI

export interface RewardEstimate {
  perJobLcai: number;
  jobsPerDay: number;
  dailyLcai: number;
  monthlyLcai: number;
}

/**
 * Demand-based estimate. `jobsPerDay` should come from observed network
 * throughput per live worker (caller derives it); we keep the math explicit and
 * honest - rewards are demand-driven, not guaranteed.
 */
/** Rough energy cost per day for a worker drawing `watts` at `pricePerKwh`. */
export function energyCostPerDay(watts: number, pricePerKwh: number): number {
  if (watts <= 0 || pricePerKwh <= 0) return 0;
  return (watts / 1000) * 24 * pricePerKwh;
}

export function estimateRewards(jobsPerDay: number): RewardEstimate {
  const dailyLcai = jobsPerDay * workerSharePerJob;
  return {
    perJobLcai: workerSharePerJob,
    jobsPerDay,
    dailyLcai,
    monthlyLcai: dailyLcai * 30,
  };
}
