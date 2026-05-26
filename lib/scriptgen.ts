/**
 * Generates a tailored worker setup, wrapping the official
 * `lightchain-worker-toolkit` (idempotent 9-phase scripts). The browser can't
 * install anything itself - this produces the exact, personalized commands the
 * operator runs locally, with the production gotchas already handled.
 */
import { NETWORKS, DEFAULT_MODEL, type NetworkId } from "./network";

export type OS = "macos" | "linux" | "windows";

const TOOLKIT = "https://github.com/lightchain-protocol/lightchain-worker-toolkit";

// Bump on every install-script change so the log shows which version actually ran.
const INSTALLER_REV = "2026-05-26.2";

export interface ScriptBundle {
  os: OS;
  network: NetworkId;
  model: string;
  prereqs: { label: string; cmd: string }[];
  oneLiner: string; // single paste-and-run bootstrap (clone → all phases → run)
  setup: string; // the explicit step-by-step (advanced)
  verify: string;
  watchdog: string;
  ops: { label: string; cmd: string }[];
}

const PHASES =
  "00-generate-key 01-resolve-addresses 02-prepare-ollama 03-pull-image 04-import-key 05-generate-ecdh 06-fund-worker 07-register 08-run-worker";

// Desktop one-click provides the worker key itself and funds it directly from the
// user's wallet, so it skips 00 (generate-key) and 06 (funder→worker transfer).
const DESKTOP_PHASES =
  "01-resolve-addresses 02-prepare-ollama 03-pull-image 04-import-key 05-generate-ecdh 07-register 08-run-worker";

/** One command: clone, set the password, run all 9 phases (06 prompts for the funder key). */
function bootstrap(os: OS, network: NetworkId, model: string): string {
  if (os === "windows") {
    return `git clone ${TOOLKIT}.git; cd lightchain-worker-toolkit\\scripts\\powershell; Copy-Item -ErrorAction Ignore secrets.example.ps1 secrets.ps1; ` +
      `$p=Read-Host -AsSecureString "Set a worker keystore password"; ` +
      `$env:WORKER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p)); ` +
      `$env:NETWORK="${network}"; $env:SUPPORTED_MODELS="${model}"; ` +
      `'${PHASES}'.Split(' ') | ForEach-Object { & ".\\$_.ps1"; if ($LASTEXITCODE -ne 0){ Write-Host "stopped at $_"; break } }`;
  }
  return (
    `git clone ${TOOLKIT}.git && cd lightchain-worker-toolkit/scripts/bash && cp -n secrets.example.sh secrets.env && \\\n` +
    `read -rs -p "Set a worker keystore password: " WP; echo && \\\n` +
    `sed -i.bak "s|WORKER_PASSWORD=.*|WORKER_PASSWORD=\\"$WP\\"|" secrets.env && rm -f secrets.env.bak && \\\n` +
    `export NETWORK=${network} SUPPORTED_MODELS=${model} && \\\n` +
    `for p in ${PHASES}; do bash "$p.sh" || { echo "⛔ stopped at $p"; break; }; done`
  );
}

/** Idempotent prerequisite checks: install a tool only when it's missing. */
const SMART_PREREQS = `have(){ command -v "$1" >/dev/null 2>&1; }
OS="$(uname -s)"
if [ "$OS" = "Darwin" ] && ! have brew; then echo "⛔ Install Homebrew first: https://brew.sh"; exit 1; fi

if have docker; then echo "✓ Docker already installed"; else
  echo "▶ installing Docker"
  if [ "$OS" = "Darwin" ]; then brew install --cask docker; else curl -fsSL https://get.docker.com | sh; fi
fi
if ! docker info >/dev/null 2>&1; then
  echo "▶ starting the Docker engine"
  if [ "$OS" = "Darwin" ]; then open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true;
  else sudo systemctl start docker 2>/dev/null || systemctl --user start docker-desktop 2>/dev/null || true; fi
fi
echo "… waiting for the Docker engine to be ready (this can take a minute on first launch)"
for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null 2>&1 || { echo "⛔ Docker engine didn't come up automatically — open Docker Desktop once, then re-run"; exit 1; }
echo "✓ Docker engine ready"

if have ollama; then echo "✓ Ollama already installed"; else
  echo "▶ installing Ollama"
  if [ "$OS" = "Darwin" ]; then brew install ollama; else curl -fsSL https://ollama.com/install.sh | sh; fi
fi

if have cast; then echo "✓ Foundry already installed"; else
  echo "▶ installing Foundry"
  # foundryup installs the binaries fine but can return non-zero (e.g. libusb
  # warning); tolerate its exit code and verify 'cast' afterward instead.
  curl -L https://foundry.paradigm.xyz | bash || true
  export PATH="$HOME/.foundry/bin:$PATH"
  foundryup || true
fi
export PATH="$HOME/.foundry/bin:$PATH"
hash -r 2>/dev/null || true
have cast || { echo "⛔ Foundry installed but 'cast' isn't on PATH yet — fully quit and reopen LightNode, then run again."; exit 1; }
echo "✓ Foundry (cast) ready"`;

/** Smart, idempotent install for macOS + Linux (bash). The app passes the
 *  WORKER key + password via env; we fund the worker directly from the user's
 *  wallet, so there's no separate funder and no phase 00/06. */
function unixInstall(network: NetworkId, model: string): string {
  const thr = NETWORKS[network].minStakeLcai + 1; // toolkit's pre-flight guard, per network
  return [
    "set -e",
    `echo "▶ LightNode installer rev ${INSTALLER_REV} (${network})"`,
    SMART_PREREQS,
    `if ollama list 2>/dev/null | grep -qi "^${model}"; then echo "✓ model ${model} already pulled"; fi`,
    `if [ -d lightchain-worker-toolkit ]; then echo "✓ toolkit present — updating"; (cd lightchain-worker-toolkit && git pull --ff-only || true); else git clone ${TOOLKIT}.git; fi`,
    "cd lightchain-worker-toolkit/scripts/bash",
    "[ -f secrets.env ] || cp secrets.example.sh secrets.env",
    // Pass secrets via the environment (the app already exported WORKER_PASSWORD +
    // WORKER_PRIVKEY) — strip any file-set copies so they can't override, and add
    // the derived address. Avoids sed-escaping pitfalls with special chars.
    "grep -vE '^[[:space:]]*export (WORKER_PASSWORD|WORKER_ADDR|WORKER_PRIVKEY|FUNDER_PRIVKEY)=' secrets.env > secrets.env.tmp || true; mv secrets.env.tmp secrets.env",
    'export WORKER_ADDR="$(cast wallet address --private-key "$WORKER_PRIVKEY")"',
    `export NETWORK=${network} SUPPORTED_MODELS=${model}`,
    // The toolkit hardcodes a 50,001 LCAI pre-flight guard; correct it to this network's minimum.
    `sed -i.bak "s/50001/${thr}/g; s/50,001/${thr}/g" 07-register.sh && rm -f 07-register.sh.bak`,
    `echo "▶ funding worker: send to $WORKER_ADDR"`,
    `if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^lightchain-worker$'; then echo "✓ worker already running — nothing to reinstall"; echo "✅ worker online"; exit 0; fi`,
    `for p in ${DESKTOP_PHASES}; do echo "▶ phase $p"; FORCE=1 bash "$p.sh" || { echo "⛔ stopped at $p"; exit 1; }; done`,
    'echo "✅ worker online"',
  ].join("\n");
}

/** Smart, idempotent install for Windows (PowerShell). Auto-starts Docker
 *  Desktop, installs missing tools via winget, and runs the toolkit's ps1 phases. */
function windowsInstall(network: NetworkId, model: string): string {
  const thr = NETWORKS[network].minStakeLcai + 1;
  const phases = DESKTOP_PHASES.split(" ").map((p) => `.\\${p}.ps1`).join("','");
  return `$ErrorActionPreference = "Stop"
Write-Host "▶ LightNode installer rev ${INSTALLER_REV} (${network})"
function Have($c){ $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }
function DockerUp { docker info *> $null; return ($LASTEXITCODE -eq 0) }

if (Have docker) { Write-Host "✓ Docker already installed" } else { Write-Host "▶ installing Docker"; winget install --id Docker.DockerDesktop -e --silent --accept-package-agreements --accept-source-agreements }
if (-not (DockerUp)) {
  Write-Host "▶ starting the Docker engine"
  $dd = Join-Path $env:ProgramFiles "Docker\\Docker\\Docker Desktop.exe"
  if (Test-Path $dd) { Start-Process $dd }
}
Write-Host "… waiting for the Docker engine to be ready (this can take a minute on first launch)"
for ($i=0; $i -lt 90; $i++){ if (DockerUp) { break }; Start-Sleep 2 }
if (-not (DockerUp)) { Write-Host "⛔ Docker engine didn't come up automatically — open Docker Desktop once, then re-run"; exit 1 }
Write-Host "✓ Docker engine ready"

if (Have ollama) { Write-Host "✓ Ollama already installed" } else { Write-Host "▶ installing Ollama"; winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements }
if (Have cast) { Write-Host "✓ Foundry already installed" } else { Write-Host "▶ installing Foundry"; Invoke-RestMethod https://foundry.paradigm.xyz | Invoke-Expression; foundryup }

if (Test-Path lightchain-worker-toolkit) { Write-Host "✓ toolkit present — updating"; Push-Location lightchain-worker-toolkit; git pull --ff-only; Pop-Location } else { git clone ${TOOLKIT}.git }
Set-Location lightchain-worker-toolkit\\scripts\\powershell
if (-not (Test-Path secrets.ps1)) { Copy-Item secrets.example.ps1 secrets.ps1 }
# Worker key + password come from the app via process env; derive the address.
$env:WORKER_ADDR = (cast wallet address --private-key $env:WORKER_PRIVKEY)
$env:NETWORK = "${network}"; $env:SUPPORTED_MODELS = "${model}"
# Correct the toolkit's hardcoded 50,001 stake guard to this network's minimum.
if (Test-Path 07-register.ps1) { (Get-Content 07-register.ps1) -replace '50001', '${thr}' -replace '50,001', '${thr}' | Set-Content 07-register.ps1 }
Write-Host "▶ funding worker: send to $env:WORKER_ADDR"

if ((docker ps --format "{{.Names}}") -match "^lightchain-worker$") { Write-Host "✓ worker already running — nothing to reinstall"; Write-Host "✅ worker online"; exit 0 }
$env:FORCE = "1"
foreach ($p in @('${phases}')) { Write-Host "▶ phase $p"; & $p; if ($LASTEXITCODE -ne 0) { Write-Host "⛔ stopped at $p"; exit 1 } }
Write-Host "✅ worker online"`;
}

/**
 * Smart, idempotent install command for the desktop shell, per OS. Installs only
 * missing prerequisites (auto-starting Docker), skips the model pull if present,
 * and short-circuits if the worker is already running. Reads WORKER_PASSWORD and
 * WORKER_PRIVKEY from the process env (passed securely by the app, never here);
 * the worker is funded directly from the user's wallet, so there's no funder key.
 */
export function desktopInstallCommand(os: OS, network: NetworkId, model: string = DEFAULT_MODEL): string {
  return os === "windows" ? windowsInstall(network, model) : unixInstall(network, model);
}

export function generateSetup(os: OS, network: NetworkId, model: string = DEFAULT_MODEL): ScriptBundle {
  const net = NETWORKS[network];
  const fund = net.fundLcai;

  const prereqs: { label: string; cmd: string }[] =
    os === "windows"
      ? [
          { label: "Docker Desktop", cmd: "winget install --id Docker.DockerDesktop -e --silent" },
          { label: "Ollama", cmd: "winget install --id Ollama.Ollama -e --silent" },
          { label: "Foundry (cast)", cmd: "powershell -c \"irm https://foundry.paradigm.xyz | iex\"; foundryup" },
        ]
      : os === "macos"
        ? [
            { label: "Docker Desktop", cmd: "brew install --cask docker   # then launch it once" },
            { label: "Ollama", cmd: "brew install ollama" },
            { label: "Foundry (cast)", cmd: "curl -L https://foundry.paradigm.xyz | bash && foundryup" },
          ]
        : [
            { label: "Docker", cmd: "curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER && newgrp docker" },
            { label: "Ollama", cmd: "curl -fsSL https://ollama.com/install.sh | sh" },
            { label: "Foundry (cast)", cmd: "curl -L https://foundry.paradigm.xyz | bash && foundryup" },
          ];

  const ext = os === "windows" ? "ps1" : "sh";
  const dir = os === "windows" ? "scripts\\powershell" : "scripts/bash";
  const run = os === "windows" ? "" : "bash ";
  const isDefault = model === DEFAULT_MODEL;

  // Phase-02 note. llama3-8b is what the toolkit's 02 script aliases out of the
  // box; for any other whitelisted model the operator pulls it explicitly and
  // the local Ollama name MUST byte-match the on-chain registry name.
  const ollamaNote = isDefault
    ? `${run}02-prepare-ollama.${ext}      # installs + aliases the model to "${model}" exactly`
    : `${run}02-prepare-ollama.${ext}      # base Ollama setup
ollama pull ${model}              # ⚠ this exact name must match the on-chain model "${model}"`;

  const setup =
    os === "windows"
      ? winSetup(network, fund, model)
      : `# 1. Get the toolkit (idempotent scripts for every phase)
git clone ${TOOLKIT}.git
cd lightchain-worker-toolkit/${dir}

# 2. Configure - NETWORK, the model to serve, + your funder wallet (NEVER your worker key)
cp secrets.example.${ext} secrets.${ext}
$EDITOR secrets.${ext}     # set FUNDER_PRIVKEY (holds ${fund}+ LCAI) and a KEYSTORE_PASSWORD
export NETWORK=${network}
export SUPPORTED_MODELS=${model}

# 3. Run the 9 phases (each is safe to re-run)
${run}00-generate-key.${ext}        # fresh worker key (kept separate from funder)
${run}01-resolve-addresses.${ext}   # reads AIConfig + JobRegistry from chain
${ollamaNote}
${run}03-pull-image.${ext}          # pulls the worker container
${run}04-import-key.${ext}          # encrypts the worker key into a keystore
${run}05-generate-ecdh.${ext}       # registers the worker's encryption key
${run}06-fund-worker.${ext}         # sends ${fund} LCAI from your funder → worker
${run}07-register.${ext}            # stakes 50,000 LCAI + registers on-chain
${run}08-run-worker.${ext}          # starts the container with --restart always`;

  const verify =
    os === "windows"
      ? `# Confirm it's online (look for: registration validated, worker-gateway auth, websocket connected)
.\\status.ps1
docker logs --tail 40 lightchain-worker`
      : `# Confirm it's online (look for: registration validated, worker-gateway auth, websocket connected)
${run}status.${ext}
docker logs --tail 40 lightchain-worker

# The #1 silent failure: the Ollama name must match SUPPORTED_MODELS byte-for-byte.
ollama list | grep -E '^${model}\\b' || echo "MODEL MISSING → re-run the Ollama step above"
curl -s http://localhost:11434/api/generate -d '{"model":"${model}","prompt":"ok","stream":false}' >/dev/null \\
  && echo "✅ local inference OK" || echo "❌ model not callable as ${model}"`;

  const watchdog =
    os === "windows"
      ? `# Liveness watchdog (Task Scheduler, every 10 min): restart if the heartbeat goes stale.
# Prevents the "ack-then-silent" failure that triggers a 15% slash.
# Full PowerShell script: docs/operations.md in the toolkit.`
      : `# Liveness watchdog - restart the worker if its heartbeat goes stale (>20m).
# Stops the "ack-then-silent" failure that triggers a 15% slash.
# Save as ~/lc-watchdog.sh, set WORKER, 'chmod +x', then add to 'crontab -e':
#   */10 * * * * ~/lc-watchdog.sh
#!/usr/bin/env bash
WORKER=0xYOUR_WORKER_ADDRESS
SEEN=$(curl -s -X POST -H 'content-type: application/json' \\
  --data "{\\"query\\":\\"{ worker(id:\\\\\\"$WORKER\\\\\\"){ last_seen_at } }\\"}" \\
  ${net.subgraph} | grep -oE '"last_seen_at":[0-9]+' | grep -oE '[0-9]+')
[ -n "$SEEN" ] && [ $(( $(date -u +%s) - SEEN )) -gt 1200 ] && docker restart lightchain-worker`;

  const ops: { label: string; cmd: string }[] =
    os === "windows"
      ? [
          { label: "Check status", cmd: ".\\status.ps1" },
          { label: "Tail jobs", cmd: 'docker logs -f --tail=0 lightchain-worker | Select-String "ws_job_received|job completed|job failed"' },
          { label: "Sweep rewards to your wallet", cmd: ".\\sweep-rewards.ps1" },
          { label: "Stop", cmd: ".\\stop.ps1" },
          { label: "Deregister + withdraw stake", cmd: ".\\deregister.ps1" },
        ]
      : [
          { label: "Check status", cmd: `${run}status.${ext}` },
          { label: "Tail jobs", cmd: 'docker logs -f --tail=0 lightchain-worker | grep -E "ws_job_received|job completed|job failed"' },
          { label: "Sweep rewards to your wallet", cmd: `${run}sweep-rewards.${ext}` },
          { label: "Stop", cmd: `${run}stop.${ext}` },
          { label: "Deregister + withdraw stake", cmd: `${run}deregister.${ext}` },
        ];

  return { os, network, model, prereqs, oneLiner: bootstrap(os, network, model), setup, verify, watchdog, ops };
}

function winSetup(network: NetworkId, fund: number, model: string): string {
  const pull =
    model === DEFAULT_MODEL
      ? `.\\02-prepare-ollama.ps1       # installs + aliases the model to "${model}" exactly`
      : `.\\02-prepare-ollama.ps1       # base Ollama setup
ollama pull ${model}           # this exact name must match the on-chain model "${model}"`;
  return `# 1. Get the toolkit (idempotent scripts for every phase)
git clone ${TOOLKIT}.git
cd lightchain-worker-toolkit\\scripts\\powershell

# 2. Configure - NETWORK, the model to serve, + your funder wallet (NEVER your worker key)
Copy-Item secrets.example.ps1 secrets.ps1
notepad secrets.ps1        # set FUNDER_PRIVKEY (holds ${fund}+ LCAI) and a KEYSTORE_PASSWORD
$env:NETWORK = "${network}"
$env:SUPPORTED_MODELS = "${model}"

# 3. Run the 9 phases (each is safe to re-run)
.\\00-generate-key.ps1         # fresh worker key (kept separate from funder)
.\\01-resolve-addresses.ps1    # reads AIConfig + JobRegistry from chain
${pull}
.\\03-pull-image.ps1           # pulls the worker container
.\\04-import-key.ps1           # encrypts the worker key into a keystore
.\\05-generate-ecdh.ps1        # registers the worker's encryption key
.\\06-fund-worker.ps1          # sends ${fund} LCAI from your funder → worker
.\\07-register.ps1             # stakes 50,000 LCAI + registers on-chain
.\\08-run-worker.ps1           # starts the container with --restart always`;
}
