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
const INSTALLER_REV = "2026-05-26.9";

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

/**
 * Keep-online watchdog (macOS + Linux), installed automatically by the worker
 * setup. A worker only earns while its Docker container runs, and the container
 * (--restart always) only runs while the Docker engine is up - but Docker
 * Desktop is an app, so a reboot, logout, or long sleep stops it and the worker
 * goes offline (lost earnings; a crash mid-job risks a slash). This watchdog
 * runs every ~10 min via launchd (macOS) / cron (Linux) and:
 *   1. starts the Docker engine if it is down (so it also auto-starts on login),
 *   2. starts the worker container if it is stopped.
 * It writes the script + registers the scheduler idempotently, and never aborts
 * the install (wrapped in set +e by the caller).
 */
const KEEP_ONLINE_UNIX = `echo "▶ installing keep-online watchdog (auto-start Docker + worker)"
cat > "$HOME/.lightnode/keep-online.sh" <<'KEEPEOF'
#!/usr/bin/env bash
# LightNode keep-online watchdog - ensure Docker + the worker are running.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
log(){ echo "$(date -u +%FT%TZ) $*"; }
# Respect an intentional Stop/Deregister: while this marker exists, leave the
# worker alone (Install or Restart clears it to re-arm).
[ -f "$HOME/.lightnode/keep-online.paused" ] && { log "paused by user - leaving worker as-is"; exit 0; }
if ! docker info >/dev/null 2>&1; then
  log "docker down - starting"
  if [ "$(uname -s)" = "Darwin" ]; then open -a Docker 2>/dev/null || true; else systemctl --user start docker-desktop 2>/dev/null || sudo systemctl start docker 2>/dev/null || true; fi
  for _ in $(seq 1 45); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
docker info >/dev/null 2>&1 || { log "docker still down - retry next tick"; exit 0; }
if docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then
  docker ps --format '{{.Names}}' | grep -q '^lightchain-worker$' || { log "worker stopped - starting"; docker start lightchain-worker >/dev/null 2>&1 && log "worker started"; }
fi
KEEPEOF
chmod +x "$HOME/.lightnode/keep-online.sh"
if [ "$(uname -s)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.lightchain.worker-watchdog</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME/.lightnode/keep-online.sh</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.lightnode/keep-online.log</string>
  <key>StandardErrorPath</key><string>$HOME/.lightnode/keep-online.log</string>
</dict></plist>
PLISTEOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST" 2>/dev/null && echo "✓ keep-online watchdog active (launchd, every 10 min)" || true
else
  ( crontab -l 2>/dev/null | grep -v 'lightnode/keep-online.sh'; echo "*/10 * * * * /bin/bash $HOME/.lightnode/keep-online.sh >> $HOME/.lightnode/keep-online.log 2>&1" ) | crontab - 2>/dev/null && echo "✓ keep-online watchdog active (cron, every 10 min)" || true
  command -v systemctl >/dev/null 2>&1 && sudo systemctl enable docker >/dev/null 2>&1 || true
fi`;

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
docker info >/dev/null 2>&1 || { echo "⛔ Docker engine didn't come up automatically - open Docker Desktop once, then re-run"; exit 1; }
echo "✓ Docker engine ready"

if have ollama; then echo "✓ Ollama already installed"; else
  echo "▶ installing Ollama"
  if [ "$OS" = "Darwin" ]; then brew install ollama; else curl -fsSL https://ollama.com/install.sh | sh; fi
fi
if ! curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "▶ starting the Ollama server"
  if [ "$OS" = "Darwin" ]; then open -a Ollama 2>/dev/null || brew services start ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &)
  else sudo systemctl start ollama 2>/dev/null || systemctl --user start ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &); fi
fi
echo "… waiting for Ollama on 127.0.0.1:11434"
for _ in $(seq 1 30); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || { echo "⛔ Ollama isn't responding on 127.0.0.1:11434 - open the Ollama app (or run 'ollama serve'), then re-run."; exit 1; }
echo "✓ Ollama server running"

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
have cast || { echo "⛔ Foundry installed but 'cast' isn't on PATH yet - fully quit and reopen LightNode, then run again."; exit 1; }
echo "✓ Foundry (cast) ready"`;

/** Smart, idempotent install for macOS + Linux (bash). The app passes the
 *  WORKER key + password via env; we fund the worker directly from the user's
 *  wallet, so there's no separate funder and no phase 00/06. */
function unixInstall(network: NetworkId, model: string): string {
  const thr = NETWORKS[network].minStakeLcai + 1; // toolkit's pre-flight guard, per network
  return [
    "set -e",
    "exec 2>&1", // surface stderr (git clone, cast, etc.) in the streamed log
    `echo "▶ LightNode installer rev ${INSTALLER_REV} (${network})"`,
    SMART_PREREQS,
    // The app's working dir may be "/" (non-writable). Work in a real home dir.
    'mkdir -p "$HOME/.lightnode" && cd "$HOME/.lightnode" && echo "✓ workdir: $HOME/.lightnode"',
    // Installing means the user wants the worker running - clear any pause set by
    // a previous Stop/Deregister so the watchdog resumes guarding it.
    'rm -f "$HOME/.lightnode/keep-online.paused" 2>/dev/null || true',
    // Arm the keep-online watchdog on every run (best-effort, never aborts the
    // install) so it's refreshed even when the worker is already running.
    "set +e",
    KEEP_ONLINE_UNIX,
    'cd "$HOME/.lightnode"',
    "set -e",
    `if ollama list 2>/dev/null | grep -qi "^${model}"; then echo "✓ model ${model} already pulled"; fi`,
    `if [ -d lightchain-worker-toolkit ]; then echo "✓ toolkit present - updating"; (cd lightchain-worker-toolkit && git pull --ff-only || true); else git clone ${TOOLKIT}.git; fi`,
    "cd lightchain-worker-toolkit/scripts/bash",
    "[ -f secrets.env ] || cp secrets.example.sh secrets.env",
    // Pass secrets via the environment (the app already exported WORKER_PASSWORD +
    // WORKER_PRIVKEY) - strip any file-set copies so they can't override, and add
    // the derived address. Avoids sed-escaping pitfalls with special chars.
    "grep -vE '^[[:space:]]*export (WORKER_PASSWORD|WORKER_ADDR|WORKER_PRIVKEY|FUNDER_PRIVKEY)=' secrets.env > secrets.env.tmp || true; mv secrets.env.tmp secrets.env",
    'export WORKER_ADDR="$(cast wallet address --private-key "$WORKER_PRIVKEY")"',
    `export NETWORK=${network} SUPPORTED_MODELS=${model}`,
    // The toolkit hardcodes a 50,001 LCAI pre-flight guard; correct it to this network's minimum.
    `sed -i.bak "s/50001/${thr}/g; s/50,001/${thr}/g" 07-register.sh && rm -f 07-register.sh.bak`,
    `echo "▶ funding worker: send to $WORKER_ADDR"`,
    `if docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -qE '^lightchain-worker Up'; then echo "✓ worker already running - nothing to reinstall"; echo "✅ worker online"; exit 0; fi`,
    // A keystore may already exist (our key on a re-run, or a stale key from a
    // prior worker). Skip the import if it's already ours; otherwise back up the
    // old one (never delete) so our key can be imported.
    'KS="${KEYS_DIR:-$HOME/lightchain-worker/keys}/eth-keystore"',
    'WADDR="$(printf "%s" "$WORKER_ADDR" | sed "s/^0x//" | tr "A-Z" "a-z")"',
    'SKIP_IMPORT=0',
    'if [ -d "$KS" ] && [ -n "$(ls -A "$KS" 2>/dev/null)" ]; then if ls "$KS" | grep -qi "$WADDR"; then echo "✓ worker key already imported - skipping import"; SKIP_IMPORT=1; else echo "▶ backing up a previous worker keystore (not deleting)"; mv "$KS" "${KS}.bak-$(date +%s)"; fi; fi',
    // The ECDH key (worker-encryption.key) is encrypted with the worker password.
    // A leftover from a different worker can't be decrypted with this password, so
    // back it up (via a marker recording which worker owns this keys dir) and let
    // phase 05 regenerate it for the current worker.
    'ENCKEY="$(dirname "$KS")/worker-encryption.key"; SESS="$(dirname "$KS")/session-keys.enc"; MARKER="$(dirname "$KS")/.lightnode-worker"',
    // Different worker → back up ALL its password-encrypted state (ECDH + session store).
    'if [ "$(cat "$MARKER" 2>/dev/null)" != "$WADDR" ]; then for f in "$ENCKEY" "$SESS"; do [ -f "$f" ] && { echo "▶ backing up old worker state: $(basename "$f")"; mv "$f" "${f}.bak-$(date +%s)"; }; done; fi',
    // Even if the marker matches, a session store older than the ECDH key is stale
    // (it predates this setup) and was encrypted with a different password.
    'if [ -f "$SESS" ] && [ -f "$ENCKEY" ] && [ "$SESS" -ot "$ENCKEY" ]; then echo "▶ stale session store (older than ECDH key) - backing it up"; mv "$SESS" "${SESS}.bak-$(date +%s)"; fi',
    'mkdir -p "$(dirname "$MARKER")"; echo "$WADDR" > "$MARKER"',
    // The toolkit uses bash 4+ syntax (e.g. ${var,,}); macOS ships bash 3.2. Run
    // the phases with a modern bash (install via brew if the system one is old).
    'if bash -c "declare -A _t" 2>/dev/null; then RUNBASH=bash; else echo "▶ system bash is too old for the toolkit - installing bash 4+ via brew"; brew install bash >/dev/null 2>&1 || true; RUNBASH="$(brew --prefix 2>/dev/null)/bin/bash"; fi',
    '"$RUNBASH" -c "declare -A _t" 2>/dev/null || { echo "⛔ The toolkit needs bash 4+. Run: brew install bash, then retry."; exit 1; }',
    'echo "✓ phase shell: $("$RUNBASH" --version | head -1)"',
    `for p in ${DESKTOP_PHASES}; do if [ "$p" = "04-import-key" ] && [ "$SKIP_IMPORT" = "1" ]; then echo "▶ phase 04-import-key (skipped - key already present)"; continue; fi; echo "▶ phase $p"; FORCE=1 "$RUNBASH" "$p.sh" || { echo "⛔ stopped at $p"; exit 1; }; done`,
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
if (-not (DockerUp)) { Write-Host "⛔ Docker engine didn't come up automatically - open Docker Desktop once, then re-run"; exit 1 }
Write-Host "✓ Docker engine ready"

if (Have ollama) { Write-Host "✓ Ollama already installed" } else { Write-Host "▶ installing Ollama"; winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements }
if (Have cast) { Write-Host "✓ Foundry already installed" } else { Write-Host "▶ installing Foundry"; Invoke-RestMethod https://foundry.paradigm.xyz | Invoke-Expression; foundryup }

# The app's working dir may not be writable; work in a real home dir.
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.lightnode" | Out-Null
Set-Location "$env:USERPROFILE\\.lightnode"
# Installing means the worker should run - clear any pause from a prior Stop/Deregister.
Remove-Item (Join-Path $env:USERPROFILE ".lightnode\\keep-online.paused") -ErrorAction SilentlyContinue
# Keep-online watchdog: auto-start Docker + the worker on a schedule (survives reboot).
try {
  $ko = Join-Path $env:USERPROFILE ".lightnode\\keep-online.ps1"
@'
if (Test-Path (Join-Path $env:USERPROFILE ".lightnode\keep-online.paused")) { exit 0 }
docker info *> $null
if (-not $?) { Start-Process "Docker Desktop" -ErrorAction SilentlyContinue; for ($i=0;$i -lt 45;$i++){ docker info *> $null; if($?){break}; Start-Sleep 2 } }
docker info *> $null; if (-not $?) { exit 0 }
if ((docker ps -a --format "{{.Names}}") -match "^lightchain-worker$") { if (-not ((docker ps --format "{{.Names}}") -match "^lightchain-worker$")) { docker start lightchain-worker | Out-Null } }
'@ | Set-Content -Path $ko -Encoding ASCII
  schtasks /Create /TN "LightChainWorkerWatchdog" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$ko\`"" /SC MINUTE /MO 10 /F | Out-Null
  Write-Host "✓ keep-online watchdog active (Scheduled Task, every 10 min)"
} catch { Write-Host "(keep-online watchdog skipped)" }
if (Test-Path lightchain-worker-toolkit) { Write-Host "✓ toolkit present - updating"; Push-Location lightchain-worker-toolkit; git pull --ff-only; Pop-Location } else { git clone ${TOOLKIT}.git }
Set-Location lightchain-worker-toolkit\\scripts\\powershell
if (-not (Test-Path secrets.ps1)) { Copy-Item secrets.example.ps1 secrets.ps1 }
# Worker key + password come from the app via process env; derive the address.
$env:WORKER_ADDR = (cast wallet address --private-key $env:WORKER_PRIVKEY)
$env:NETWORK = "${network}"; $env:SUPPORTED_MODELS = "${model}"
# Correct the toolkit's hardcoded 50,001 stake guard to this network's minimum.
if (Test-Path 07-register.ps1) { (Get-Content 07-register.ps1) -replace '50001', '${thr}' -replace '50,001', '${thr}' | Set-Content 07-register.ps1 }
Write-Host "▶ funding worker: send to $env:WORKER_ADDR"

if ((docker ps --format "{{.Names}} {{.Status}}") -match "^lightchain-worker Up") { Write-Host "✓ worker already running - nothing to reinstall"; Write-Host "✅ worker online"; exit 0 }
# Handle a pre-existing keystore: skip if it's already ours, else back up (never delete).
$ks = Join-Path $env:USERPROFILE "lightchain-worker\\keys\\eth-keystore"
$skipImport = $false
if ((Test-Path $ks) -and (Get-ChildItem $ks -ErrorAction SilentlyContinue)) {
  $waddr = ($env:WORKER_ADDR -replace '^0x','').ToLower()
  if (Get-ChildItem $ks | Where-Object { $_.Name.ToLower().Contains($waddr) }) { Write-Host "✓ worker key already imported - skipping import"; $skipImport = $true }
  else { Write-Host "▶ backing up a previous worker keystore (not deleting)"; Move-Item $ks "$ks.bak-$((Get-Date).Ticks)" }
}
# Stale ECDH key (different worker / old password) → back up so phase 05 regenerates.
$keysDir = Join-Path $env:USERPROFILE "lightchain-worker\\keys"
$enc = Join-Path $keysDir "worker-encryption.key"
$sess = Join-Path $keysDir "session-keys.enc"
$marker = Join-Path $keysDir ".lightnode-worker"
$waddr = ($env:WORKER_ADDR -replace '^0x','').ToLower()
if ((Get-Content $marker -ErrorAction SilentlyContinue) -ne $waddr) { foreach ($f in @($enc, $sess)) { if (Test-Path $f) { Write-Host "▶ backing up old worker state: $(Split-Path $f -Leaf)"; Move-Item $f "$f.bak-$((Get-Date).Ticks)" } } }
if ((Test-Path $sess) -and (Test-Path $enc) -and ((Get-Item $sess).LastWriteTime -lt (Get-Item $enc).LastWriteTime)) { Write-Host "▶ stale session store - backing it up"; Move-Item $sess "$sess.bak-$((Get-Date).Ticks)" }
New-Item -ItemType Directory -Force -Path $keysDir | Out-Null
Set-Content -Path $marker -Value $waddr
$env:FORCE = "1"
foreach ($p in @('${phases}')) { if (($p -like '*04-import-key*') -and $skipImport) { Write-Host "▶ phase 04-import-key (skipped - key present)"; continue }; Write-Host "▶ phase $p"; & $p; if ($LASTEXITCODE -ne 0) { Write-Host "⛔ stopped at $p"; exit 1 } }
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

/** Run a toolkit script natively from the app: find the toolkit (the install
 *  clones it to ~/.lightnode), use bash 4+ (macOS ships 3.2), surface stderr. */
export function toolkitOpCommand(script: string, confirm?: string): string {
  const run = confirm ? `echo ${confirm} | FORCE=1 "$RB" ${script}` : `FORCE=1 "$RB" ${script}`;
  return [
    "exec 2>&1",
    'TK="$HOME/.lightnode/lightchain-worker-toolkit/scripts/bash"; [ -d "$TK" ] || TK="$HOME/lightchain-worker-toolkit/scripts/bash"',
    'cd "$TK" 2>/dev/null || { echo "⛔ toolkit not found - install the worker first."; exit 1; }',
    'if bash -c "declare -A _t" 2>/dev/null; then RB=bash; else RB="$(brew --prefix 2>/dev/null)/bin/bash"; fi',
    run,
  ].join("\n");
}

/**
 * Stop the worker on purpose. Writes the pause marker FIRST (so the keep-online
 * watchdog won't restart it), then stops the container best-effort. The marker
 * write happens even if Docker is down, so the intent always sticks.
 */
export function stopWorkerCommand(os: OS): string {
  if (os === "windows") {
    return [
      'New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.lightnode" | Out-Null',
      'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      'Write-Host "worker paused - the watchdog will leave it stopped until you Install or Restart"',
      "docker stop lightchain-worker 2>$null",
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'mkdir -p "$HOME/.lightnode" && touch "$HOME/.lightnode/keep-online.paused"',
    'echo "✓ worker paused - the keep-online watchdog will leave it stopped until you Install or Restart"',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"',
    '(docker stop lightchain-worker >/dev/null 2>&1 && echo "✓ worker stopped") || echo "(worker was not running)"',
  ].join("\n");
}

/**
 * Deregister + withdraw stake, then tear down the keep-online watchdog (the
 * worker is leaving the network, so it must not be auto-restarted). Pauses
 * first, runs the toolkit deregister, then removes the launchd/cron schedule.
 */
export function deregisterCommand(os: OS): string {
  if (os === "windows") {
    return [
      'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      'schtasks /Delete /TN "LightChainWorkerWatchdog" /F *> $null',
      // The toolkit's powershell deregister (best-effort path).
      'Set-Location "$env:USERPROFILE\\.lightnode\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null',
      'if (Test-Path .\\deregister.ps1) { $env:FORCE="1"; .\\deregister.ps1 } else { Write-Host "toolkit not found - install first" }',
    ].join("\n");
  }
  return [
    toolkitOpCommand("deregister.sh", "deregister"),
    // teardown (runs after the deregister script returns)
    'touch "$HOME/.lightnode/keep-online.paused"',
    'launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true',
    'rm -f "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true',
    `( crontab -l 2>/dev/null | grep -v 'lightnode/keep-online.sh' ) | crontab - 2>/dev/null || true`,
    'echo "✓ keep-online watchdog removed - worker will stay offline"',
  ].join("\n");
}

/**
 * Shell preamble (unix) that guarantees Docker is reachable from the launched
 * `.app`. The app runs as a login shell but Docker can still be unreachable for
 * two reasons we fix here:
 *   1. wrong/missing socket - the app's environment may resolve the Docker
 *      context to a socket path it can't connect to ("no such file or
 *      directory"). We probe the known sockets and pin DOCKER_HOST to the first
 *      one that actually answers.
 *   2. Docker not running - the app can be opened before (or after quitting)
 *      Docker Desktop. We start it and wait, exactly like the installer does.
 */
function dockerEnvPreambleUnix(): string {
  return [
    "exec 2>&1",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"',
    'if ! docker info >/dev/null 2>&1; then for s in "$HOME/.docker/run/docker.sock" "/var/run/docker.sock" "$HOME/.colima/default/docker.sock" "$HOME/.rd/docker.sock"; do if [ -S "$s" ] && DOCKER_HOST="unix://$s" docker info >/dev/null 2>&1; then export DOCKER_HOST="unix://$s"; break; fi; done; fi',
    'if ! docker info >/dev/null 2>&1; then echo "▶ Docker is not running - starting Docker Desktop..."; open -a Docker 2>/dev/null || true; for _ in $(seq 1 45); do docker info >/dev/null 2>&1 && break; sleep 2; done; fi',
    'docker info >/dev/null 2>&1 || { echo "⛔ Cannot reach Docker. Open Docker Desktop once, then try again."; exit 1; }',
  ].join("\n");
}

/**
 * Wrap a Docker-based operations command so it runs reliably from the desktop
 * app (PATH + reachable socket + auto-start). Pass the raw `docker ...` command;
 * returns it prefixed with the environment preamble for the given OS.
 */
export function dockerOpCommand(inner: string, os: OS): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'docker info *> $null; if (-not $?) { Write-Host "> starting Docker Desktop..."; Start-Process "Docker Desktop" -ErrorAction SilentlyContinue; for ($i=0; $i -lt 45; $i++) { docker info *> $null; if ($?) { break }; Start-Sleep 2 } }',
      'docker info *> $null; if (-not $?) { Write-Host "Cannot reach Docker. Open Docker Desktop once, then try again."; exit 1 }',
      inner,
    ].join("\n");
  }
  return [dockerEnvPreambleUnix(), inner].join("\n");
}

/**
 * Repair an already-installed worker without the UI needing its key: stop the
 * (possibly crash-looping) container, clear a stale session store, restart it.
 * The container keeps its baked-in keystore + password, so no re-stake.
 */
export function repairWorkerCommand(os: OS): string {
  if (os === "windows") {
    return `$ErrorActionPreference = "Stop"
Write-Host "▶ repairing lightchain-worker"
if (-not ((docker ps -a --format "{{.Names}}") -match "^lightchain-worker$")) { Write-Host "⛔ No lightchain-worker container found - install one first."; exit 1 }
docker stop lightchain-worker *> $null
$sess = Join-Path $env:USERPROFILE "lightchain-worker\\keys\\session-keys.enc"
if (Test-Path $sess) { Move-Item $sess "$sess.bak-$((Get-Date).Ticks)"; Write-Host "✓ cleared stale session store" }
docker start lightchain-worker
Write-Host "✓ worker restarted - give it ~1 min, then check the dashboard"
docker logs --tail 20 lightchain-worker`;
  }
  return [
    "exec 2>&1",
    'echo "▶ repairing lightchain-worker"',
    // Restart = the user wants it running, so lift any pause from a prior Stop.
    'rm -f "$HOME/.lightnode/keep-online.paused" 2>/dev/null || true',
    `if ! docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then echo "⛔ No lightchain-worker container found - install one first."; exit 1; fi`,
    "docker stop lightchain-worker >/dev/null 2>&1 || true",
    'SESS="$HOME/lightchain-worker/keys/session-keys.enc"',
    '[ -f "$SESS" ] && mv "$SESS" "${SESS}.bak-$(date +%s)" && echo "✓ cleared stale session store"',
    "docker start lightchain-worker",
    'echo "✓ worker restarted - watching for connection (up to ~60s)"',
    'for _ in $(seq 1 30); do if docker logs --since 20s lightchain-worker 2>&1 | grep -qiE "websocket connected|gateway auth"; then echo "✅ worker connected - should go Live on the dashboard"; break; fi; sleep 2; done',
    "docker logs --tail 15 lightchain-worker 2>&1",
  ].join("\n");
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
