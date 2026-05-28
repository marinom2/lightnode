/**
 * Turns the streamed (already cleaned) installer log into a small, friendly view
 * model: a short list of human milestones with status, plus the live download
 * percentage. The raw terminal log stays available behind a disclosure - this is
 * what the operator actually watches, so it reads like an app, not a console.
 *
 * Pure + deterministic so it's unit-tested: feed it the cleaned log lines and the
 * run phase, get back the milestones to render.
 */

export type StepStatus = "pending" | "active" | "done" | "error";
export type RunPhase = "running" | "done" | "failed";

export interface InstallMilestone {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface InstallView {
  milestones: InstallMilestone[];
  /** 0..100 while the model is downloading, else null. */
  download: number | null;
  /** One-line, human status for the big headline. */
  headline: string;
}

interface MilestoneDef {
  id: string;
  label: string;
  // Seeing any of these in the log means this milestone is complete.
  doneRe: RegExp;
}

// Ordered milestones. Markers are the `✓`/`▶`/`✅` lines the installer already
// prints (we control scriptgen), so detection is stable. A later milestone going
// "done" implies the earlier ones are done too (logs can skip a marker when a
// step is a no-op, e.g. a model that's already present).
const MILESTONES: MilestoneDef[] = [
  {
    id: "prepare",
    label: "Setting up your machine",
    doneRe: /workdir:|toolkit present|cloning into|phase 0[1-9]|phase 1\d/i,
  },
  {
    id: "model",
    label: "Getting the AI model ready",
    doneRe: /model .* present|downloaded|aliased|pre-?warming|phase 0[4-9]|phase 1\d|funding worker|register/i,
  },
  {
    id: "register",
    label: "Staking & registering on-chain",
    doneRe: /worker online|pre-?warming|phase 08|already registered/i,
  },
  {
    id: "live",
    label: "Bringing your worker online",
    doneRe: /worker online/i,
  },
];

/** Latest model-download percentage from the cleaned log (scans from the end for
 *  a `NN%` in a pull/download context). Null when nothing is downloading. */
export function latestDownloadPercent(cleaned: string[]): number | null {
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const line = cleaned[i];
    if (!/pull|download/i.test(line)) continue;
    const m = line.match(/(\d{1,3})\s*%/);
    if (!m) continue;
    const p = Number(m[1]);
    if (p >= 0 && p <= 100) return p;
  }
  return null;
}

function headlineFor(active: InstallMilestone | undefined, phase: RunPhase, download: number | null): string {
  if (phase === "done") return "Your worker is online";
  if (phase === "failed") return "Something needs your attention";
  if (!active) return "Starting up…";
  if (active.id === "model" && download != null) return `Downloading the AI model — ${download}%`;
  return `${active.label}…`;
}

/**
 * Turn a known install failure into one plain-English, actionable sentence (shown
 * above the technical log on failure). Reacts to the actual on-chain error text -
 * no model is hard-coded as "bad", so it stays correct if the chain changes.
 * Returns null when we don't recognize the failure (the raw log is enough).
 */
export function diagnoseFailure(cleaned: string[]): string | null {
  const text = cleaned.join("\n");
  if (/AddSupportedModel\b.*\brevert/i.test(text)) {
    return (
      "The network rejected this model during registration (the on-chain AddSupportedModel step reverted). " +
      "Your stake is locked on-chain - the worker registered, so it is not lost. " +
      "llama3-8b is the reliable testnet model: open the dashboard and add it from “Models this worker serves” " +
      "(no re-stake needed), or deregister this worker and reinstall picking llama3-8b."
    );
  }
  if (/stopped at 07-register/i.test(text) && /less than|insufficient|balance/i.test(text)) {
    return "Registration needs a little more LCAI for the stake plus gas. Top up the worker address shown above, then run install again.";
  }
  if (/Docker engine didn.?t come up|Docker.*not.*running/i.test(text)) {
    return "Docker did not start in time. Open Docker Desktop once so it is running, then run install again.";
  }
  return null;
}

/** Build the friendly view from the cleaned log lines + the current run phase. */
export function deriveInstallView(cleaned: string[], phase: RunPhase): InstallView {
  const text = cleaned.join("\n");
  const ms: InstallMilestone[] = MILESTONES.map((d) => ({
    id: d.id,
    label: d.label,
    status: d.doneRe.test(text) ? "done" : "pending",
  }));
  // A later "done" implies earlier ones are done.
  for (let i = ms.length - 2; i >= 0; i--) {
    if (ms[i + 1].status === "done") ms[i].status = "done";
  }

  const download = latestDownloadPercent(cleaned);
  const firstPending = ms.findIndex((m) => m.status === "pending");

  if (phase === "done") {
    ms.forEach((m) => (m.status = "done"));
  } else if (phase === "failed") {
    if (firstPending >= 0) ms[firstPending].status = "error";
  } else if (firstPending >= 0) {
    ms[firstPending].status = "active";
  }

  const active = ms.find((m) => m.status === "active");
  if (active && active.id === "model" && download != null) {
    active.detail = `${download}%`;
  }

  return { milestones: ms, download: active?.id === "model" ? download : null, headline: headlineFor(active, phase, download) };
}
