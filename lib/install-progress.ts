/**
 * Turns the streamed (already cleaned) installer log into a small, friendly view
 * model: a short list of human milestones with status, plus the live download
 * percentage. The raw terminal log stays available behind a disclosure - this is
 * what the operator actually watches, so it reads like an app, not a console.
 *
 * Pure + deterministic so it's unit-tested: feed it the cleaned log lines and the
 * run phase, get back the milestones to render.
 */
import { lookupModel } from "./model-catalog";

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
    doneRe: /model .* present|downloaded|aliased|pre-?warming|phase 0[1-9]|phase 1\d|funding worker|register/i,
  },
  {
    // Phases 01-03 (resolve addresses, prepare ollama, pull image). This is the
    // first thing that touches the network, so a connectivity/cast failure lands
    // here - NOT on "Staking", which would wrongly imply funds were at risk.
    id: "resolve",
    label: "Connecting to the network",
    doneRe: /ai_config_address\s*=|saved to .*resolved|phase 0[4-8]|import-key|generate-ecdh|register|worker online|already registered/i,
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
  if (active.id === "model" && download != null) return `Downloading the AI model - ${download}%`;
  return `${active.label}…`;
}

/** Pull the funded worker address out of the cleaned log so failure messages
 *  can point straight at the right explorer page. Limited to the "funding worker"
 *  line so an unrelated contract address can't be picked up by mistake. */
export function extractWorkerAddress(cleaned: string[]): string | null {
  for (const line of cleaned) {
    if (!/funding worker|send to/i.test(line)) continue;
    const m = line.match(/(0x[0-9a-fA-F]{40})/);
    if (m) return m[1];
  }
  return null;
}

/** Pick the install's network out of the banner so the explorer link is right. */
export function extractNetwork(cleaned: string[]): "mainnet" | "testnet" | null {
  for (const line of cleaned) {
    if (!/installer rev|lightnode installer/i.test(line)) continue;
    const m = line.match(/\b(mainnet|testnet)\b/i);
    if (m) return m[1].toLowerCase() as "mainnet" | "testnet";
  }
  for (const line of cleaned) {
    const m = line.match(/\b(mainnet|testnet)\b/i);
    if (m) return m[1].toLowerCase() as "mainnet" | "testnet";
  }
  return null;
}

function explorerFor(net: "mainnet" | "testnet" | null): string {
  return `https://${net === "testnet" ? "testnet" : "mainnet"}.lightscan.app`;
}

// Root/privilege refusals from the prerequisite stage. The installer shells out to
// the vendor install scripts (get.docker.com, ollama.com/install.sh) and both
// elevate with sudo - but the app runs them with no controlling terminal, so sudo
// can't prompt and dies printing one of its own `sudo: …` lines. The remaining
// alternatives are those scripts' and pkexec's own refusals. Anchored deliberately:
// a bare /sudo/ would also match the advice text the installer itself prints
// ("run once in a terminal: sudo mkdir -p …"), which is not a failure.
const PRIVILEGE_FAIL_RE =
  /\bsudo:|superuser permissions|please re-run as root|a password is required|no tty present|a terminal is required to read the password|ability to run commands as root|\bpkexec\b/i;

/**
 * Turn a known install failure into one plain-English, actionable sentence (shown
 * above the technical log on failure). Reacts to the actual on-chain error text -
 * no model is hard-coded as "bad", so it stays correct if the chain changes.
 * Returns null when we don't recognize the failure (the raw log is enough).
 */
export function diagnoseFailure(cleaned: string[]): string | null {
  const text = cleaned.join("\n");
  // Hoisted because several recognisers below have to be honest about the operator's
  // money: every step up to 07-register is local setup, so "nothing was staked" is
  // only a true thing to say while this is false. `online` guards the fallbacks.
  const inRegisterPath = /phase\s*\.?\\?\/?0?7[- ]register|worker:latest\s+(?:status|register)|stopped at .*07-register/i.test(text);
  const online = /worker online|✅\s*worker/i.test(text);
  // Prerequisite stage, and by far the most likely Linux failure: the vendor install
  // scripts need root. `set -e` aborts the whole run here, before a single on-chain
  // call is made, so the reassurance is unconditionally true. Docker is installed
  // before Ollama, so an "installing Ollama" marker means Docker's own install
  // already succeeded - test that one first to attribute the failure correctly.
  if (PRIVILEGE_FAIL_RE.test(text)) {
    if (/installing Ollama/i.test(text)) {
      return (
        "Installing Ollama needs administrator rights and it has no terminal here to ask for your password. " +
        "Open a terminal and run: curl -fsSL https://ollama.com/install.sh | sh - then run install again and " +
        "LightNode will skip straight past this step. Nothing was staked."
      );
    }
    if (/installing Docker/i.test(text)) {
      return (
        "Installing Docker needs administrator rights and it has no terminal here to ask for your password. " +
        "Open a terminal and run: curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER - then " +
        "log out and back in (that is what lets LightNode drive Docker without root) and run install again. " +
        "Nothing was staked."
      );
    }
  }
  if (/AddSupportedModel\b.*\brevert/i.test(text)) {
    return (
      "Your worker staked and registered on-chain (your stake is locked, not lost), but adding the model " +
      "during setup failed - the one-shot install tries to add the model the instant after staking, and that " +
      "step reverts before it confirms. Finish from the dashboard instead: open “Models this worker serves” and " +
      "add your model there. That uses a separate step that works on an already-registered worker - no re-stake " +
      "or reinstall needed. (If it still won’t take, llama3-8b is the safe fallback.)"
    );
  }
  // Our OWN gas-corrected addSupportedModel failed - "model add failed even with
  // estimated gas" (bash) / "stopped at …07-register.ps1 - model add failed" (ps1).
  // The install only calls it once 07-register has succeeded, so reaching this line
  // proves the stake landed. Say that plainly here, or the generic register fallback
  // further down would tell an already-staked operator to top up and re-run.
  if (/model add failed/i.test(text)) {
    return (
      "Your worker is staked and registered on-chain - the only thing that didn’t land is attaching the model to it " +
      "(your stake is locked, not lost). This attempt already sent proper gas, so gas isn’t the cause; the usual " +
      "reason is that this network’s registry doesn’t list that exact model. Finish from the dashboard: open " +
      "“Models this worker serves” and add it there - that works on an already-registered worker, so there’s no " +
      "re-stake and no reinstall. (llama3-8b is listed on every network if you need a safe fallback.)"
    );
  }
  // The dashboard's add-model-on-chain run, not an install: "⛔ failed to add <model>"
  // / "one or more models failed to add". That script only ever runs against a worker
  // that is ALREADY registered and it never stakes, so the honest framing is "nothing
  // changed". Gated on the register path being absent so daemon output during a real
  // install can't borrow this message and wrongly promise no stake was placed.
  if (/failed to add\b/i.test(text) && !inRegisterPath) {
    return (
      "Adding the model on-chain didn’t go through, so this worker still serves exactly the set it served before - " +
      "nothing was staked and its registration is untouched. Two things cause this: the worker wallet has no LCAI " +
      "left for gas (the add is a transaction the worker signs and pays for itself), or this network’s registry " +
      "doesn’t list that exact model. Send the worker a little LCAI and try again; if it still fails, pick a model " +
      "the network lists (llama3-8b is on every network)."
    );
  }
  if (/stopped at 07-register/i.test(text) && /less than|insufficient|balance/i.test(text)) {
    return "Registration needs a little more LCAI for the stake plus gas. Top up the worker address shown above, then run install again.";
  }
  if (/Docker engine didn.?t come up|Docker.*not.*running/i.test(text)) {
    return "Docker did not start in time. Open Docker Desktop once so it is running, then run install again.";
  }
  // Phase 01 resolves the on-chain contract addresses via `cast` over RPC. A
  // failure here means cast couldn't read the WorkerRegistry - almost always
  // because cast isn't reachable or the RPC didn't answer (transient network /
  // proxy / TLS), not a problem with your worker or wallet. The contracts are a
  // genesis predeploy, so nothing on-chain needs changing - just retry.
  if (/stopped at .*01-resolve-addresses|Failed to read (aiConfig|jobRegistry)/i.test(text)) {
    const explorer = explorerFor(extractNetwork(cleaned));
    return (
      "Couldn't read the network's contract addresses to start setup. This is a connection issue, not a problem " +
      "with your worker or wallet (no stake was touched). Check your internet/VPN, confirm " +
      `${explorer} loads, then run install again. If it keeps failing, fully quit and reopen LightNode so Foundry's ` +
      "cast tool is freshly on PATH."
    );
  }
  // Install-time keystore-password mismatch sentinel emitted by both Windows + bash
  // runners when a previous attempt left an encrypted key on disk and the password
  // entered this session doesn't decrypt it. The runner has already tried every
  // saved slot at this point; the only fix is the user's original password or
  // generating a fresh worker via Recover a replaced key.
  if (/keystore-password-mismatch/i.test(text)) {
    return (
      "An existing worker key for this address is on this device, but the password set this session doesn't match the one used when it was first created. " +
      "Re-enter the original password to continue with the same worker, or open Recover a replaced key on the dashboard to switch to a different worker."
    );
  }
  // Funding-gate sentinel from the pre-register balance check (~90s wait). When it
  // fires the worker wallet really is empty after the grace period; nothing on
  // disk needs to change, just send the LCAI and re-run.
  if (/funding-gate timeout/i.test(text)) {
    const addr = extractWorkerAddress(cleaned);
    const explorer = explorerFor(extractNetwork(cleaned));
    const linkBit = addr
      ? `Open ${explorer}/address/${addr} to confirm the funding tx, then run install again - your existing setup is reused.`
      : "Confirm the funding tx on the explorer, then run install again - your existing setup is reused.";
    return `The worker wallet was still empty after the wait. ${linkBit}`;
  }
  // Generic register-failure fallback: we got far enough to attempt register (or
  // the register wrapper's status check ran) but the worker never came online and
  // no specific revert pattern matched. The far-and-away most common real cause
  // is the worker wallet holding too little LCAI for stake + gas; LCAI IS the
  // network's native gas token, so funding exactly the minimum stake leaves
  // nothing left to pay for the register tx. Surface the worker address so the
  // operator can check + top up directly instead of guessing.
  //
  // If the pre-register funding gate already CONFIRMED the wallet held enough
  // LCAI ("✓ worker wallet funded (… LCAI)"), a later register failure is NOT a
  // balance problem. Telling a funded operator to "top up" wastes their money and
  // sends them down the wrong path (seen in the field: a 55,000-LCAI worker, stake
  // is 50,000, told to add more). Point at the worker binary's real error instead.
  const fundingConfirmed = /worker wallet funded/i.test(text);
  if (inRegisterPath && !online && fundingConfirmed) {
    const addr = extractWorkerAddress(cleaned);
    const explorer = explorerFor(extractNetwork(cleaned));
    const linkBit = addr
      ? `The worker wallet at ${addr} already holds enough LCAI (confirm at ${explorer}/address/${addr}) - do NOT send more.`
      : "The worker wallet already holds enough LCAI - do NOT send more.";
    return (
      "The worker was funded and reached the register step, but the on-chain registration didn't go through. " +
      "This is not a funding problem. " + linkBit + " The exact reason is in the technical log below (the " +
      "'register' output, just under the status line) - that line is what to act on. Common non-funding causes: " +
      "the worker container couldn't reach the network, or the registration was rejected on-chain."
    );
  }
  if (inRegisterPath && !online) {
    const addr = extractWorkerAddress(cleaned);
    const explorer = explorerFor(extractNetwork(cleaned));
    const linkBit = addr
      ? `Open ${explorer}/address/${addr} to check the worker wallet's LCAI balance.`
      : `Check the worker wallet's LCAI balance on ${explorer}.`;
    return (
      "Registering on-chain didn't complete. The most common cause is the worker " +
      "wallet running short on LCAI for stake plus gas - LCAI is the network's gas " +
      "token, so sending exactly the minimum stake leaves nothing for the register tx. " +
      linkBit + " Top up a little over the minimum stake (a fraction of an LCAI covers " +
      "gas) and run install again - your existing worker key is reused, no reset needed."
    );
  }
  // A failed `ollama pull` reaches the log ONLY as the installer's own
  // "⚠ <model> download exited <rc> (continuing)" line - the pull runs detached with
  // its output in a temp file that is then deleted, so the underlying reason (nearly
  // always no free disk, sometimes a dropped connection) never gets here. We name the
  // size from the catalog instead, since "you need 65.4 GB free" is the actionable
  // part. Deliberately last: the install carries on after this line, so a download
  // failure is usually the cause of a LATER stop, and whatever actually stopped the
  // run should speak first. Reaching here means nothing on-chain was attempted.
  const pullFail = text.match(/(\S+)[ \t]+download exited\b/i);
  if (pullFail && !inRegisterPath && !online) {
    const entry = lookupModel(pullFail[1]);
    const sizeBit = entry
      ? ` ${entry.tag} is a ${entry.downloadGb} GB download, so you need at least that much free on top of what Docker and the worker image take.`
      : "";
    // The installer prints this itself when the disk is under 15 GB free; if it did,
    // we already know the answer rather than listing space as one of two guesses.
    const lowDisk = /Only ~?\s*\d+\s*GB free/i.test(text)
      ? " The installer already flagged this machine as low on disk, so that is almost certainly why."
      : "";
    return (
      "The AI model didn’t finish downloading, so there was nothing for the worker to serve." +
      sizeBit +
      lowDisk +
      " Free up disk space - or go back and pick a smaller model - then run install again; Ollama resumes from " +
      "where it stopped, so a retry doesn’t re-download what you already have. Nothing was staked."
    );
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
