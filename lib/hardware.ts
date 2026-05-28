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
  unified?: boolean; // Apple Silicon: GPU + CPU share one memory pool
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

  // On Apple Silicon the GPU and CPU share ONE unified memory pool, so "RAM" and
  // "VRAM" are the same bytes - the discrete-PC "16GB RAM + 8GB VRAM" split does
  // not apply. The browser's navigator.deviceMemory also caps at 8GB and badly
  // under-reports these machines. So for unified memory we gate on the single
  // pool (the larger of the two readings), not a separate system-RAM figure.
  const effectiveRamGb = m.unified ? Math.max(m.ramGb, m.vramGb) : m.ramGb;

  // sub-scores (each 0-1)
  const vramScore = clamp((m.vramGb / HARDWARE.rec.vramGb) * 100) / 100; // 24GB = full
  const ramScore = clamp((effectiveRamGb / HARDWARE.rec.ramGb) * 100) / 100;
  const coreScore = clamp((m.cores / HARDWARE.rec.cores) * 100) / 100;
  const storageScore = m.storageGb >= HARDWARE.min.storageGb ? 1 : m.storageGb / HARDWARE.min.storageGb;

  // VRAM-weighted (60/20/15/5)
  const raw = vramScore * 0.6 + ramScore * 0.2 + coreScore * 0.15 + storageScore * 0.05;
  const score = Math.round(clamp(raw * 100));

  const vramOk = m.vramGb >= HARDWARE.min.vramGb;
  const cpuFallback = !vramOk && effectiveRamGb >= HARDWARE.min.ramGb;

  let tier: Tier;
  let tierLabel: string;
  if (m.vramGb >= HARDWARE.rec.vramGb) {
    tier = "premium";
    tierLabel = "Premium - headroom for larger models";
  } else if (!m.unified && m.vramGb >= 12) {
    // A DISCRETE GPU with 12GB+ has real compute headroom for an 8B model.
    tier = "strong";
    tierLabel = "Strong - comfortably serves llama3-8b";
  } else if (vramOk) {
    tier = "eligible";
    // On unified memory, enough memory only proves the model FITS - GPU compute
    // (and so speed) varies a lot by chip, so we don't claim "comfortably".
    tierLabel = m.unified
      ? "Eligible - llama3-8b fits; real speed depends on your chip"
      : "Eligible - meets the 8GB minimum";
  } else {
    tier = "below";
    tierLabel = cpuFallback ? "Below GPU minimum - CPU fallback only (slow)" : "Below minimum spec";
  }

  if (!vramOk && cpuFallback)
    notes.push("No 8GB+ GPU detected. You can still run on CPU, but inference will be slow and may risk completion timeouts.");
  // Unified-memory Macs are gated on the single pool above, so don't raise the
  // PC-style "RAM below 16GB" flag (the reading is the shared pool, not a
  // separate system-RAM stick that's missing).
  if (!m.unified && m.ramGb < HARDWARE.min.ramGb) notes.push(`RAM is below the ${HARDWARE.min.ramGb}GB minimum.`);
  if (m.storageGb < HARDWARE.min.storageGb) notes.push(`Storage is below the ${HARDWARE.min.storageGb}GB minimum.`);
  // Apple Silicon below the "premium" pool: the model fits, but compute (speed)
  // is the real question, and only a live benchmark answers it honestly.
  if (m.unified && vramOk && m.vramGb < HARDWARE.rec.vramGb)
    notes.push(
      "On Apple Silicon the model fits in your unified memory, but inference speed depends on your chip (base vs Pro/Max). After install, run the Speed test to confirm you beat the job deadline.",
    );
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

export type ModelTier = "light" | "standard" | "large" | "server";

export interface ModelRequirement {
  paramsB: number; // estimated parameter count in billions (0 = unknown)
  vramGb: number; // rough resident memory needed to serve it
  tier: ModelTier;
  tierLabel: string;
}

/**
 * Rough hardware requirement for a model, inferred from its name (the param
 * count, e.g. the "8" in "llama3-8b" or the "2" in "gemma4:e2b"). Used only to
 * label models and flag a fit vs the operator's machine - the network never
 * gates on this. Unknown names fall back to a standard 8GB assumption.
 */
export function modelRequirement(name: string): ModelRequirement {
  const m = /(\d+(?:\.\d+)?)\s*b\b/i.exec(name);
  const paramsB = m ? parseFloat(m[1]) : 0;
  if (paramsB > 0 && paramsB <= 4) return { paramsB, vramGb: 4, tier: "light", tierLabel: "Light - runs on most machines" };
  if (paramsB <= 9) return { paramsB, vramGb: 8, tier: "standard", tierLabel: "Standard - needs an 8GB GPU / 16GB unified" };
  if (paramsB <= 15) return { paramsB, vramGb: 12, tier: "standard", tierLabel: "Standard+ - needs a 12GB GPU" };
  if (paramsB <= 34) return { paramsB, vramGb: 24, tier: "large", tierLabel: "Large - needs a 24GB GPU" };
  return { paramsB, vramGb: 48, tier: "server", tierLabel: "Server-class - needs a 48GB+ GPU" };
}

/** Total resident memory (GB) needed to keep a set of models warm at once. */
export function modelsMemoryGb(names: string[]): number {
  return names.reduce((sum, n) => sum + modelRequirement(n).vramGb, 0);
}

/** Whether a machine with `availGb` (discrete VRAM, or the unified pool on Apple
 *  Silicon) can keep the whole set resident at once. */
export function modelsFit(names: string[], availGb: number): boolean {
  return availGb > 0 && names.length > 0 && modelsMemoryGb(names) <= availGb;
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
          input.unified = true;
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
