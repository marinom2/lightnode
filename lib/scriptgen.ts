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
export const INSTALLER_REV = "2026-06-07.1";

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
# Optional alerting: if ~/.lightnode/alerts.webhook holds a URL, post a message to
# it on STATE CHANGES only (no spam) - worker down / Docker down / recovered.
# Discord-compatible JSON body; a plain webhook receives the same {"content":...}.
alert_state(){ local W; W="$(cat "$HOME/.lightnode/alerts.webhook" 2>/dev/null)"; [ -z "$W" ] && return 0; local C="$1"; local L; L="$(cat "$HOME/.lightnode/alerts.last" 2>/dev/null)"; [ "$C" = "$L" ] && return 0; printf '%s' "$C" > "$HOME/.lightnode/alerts.last"; local HN; HN="$(hostname 2>/dev/null || echo worker)"; local M=""; case "$C" in down) M="LightChain worker is DOWN on $HN and could not be restarted.";; docker_down) M="LightChain worker host $HN: Docker is not running.";; stale) M="LightChain worker on $HN is running but not connected to the gateway (stale) - it is not taking jobs.";; ok) case "$L" in down|docker_down|stale) M="LightChain worker is back online on $HN.";; esac;; esac; [ -n "$M" ] && curl -s -m 8 -H "content-type: application/json" -d "{\\"content\\":\\"$M\\"}" "$W" >/dev/null 2>&1; return 0; }
# Economic alerts (stuck jobs / settle-now / out-of-gas) - the on-chain conditions
# the operator must NOT miss, posted even when the desktop app is closed. Each
# category dedups via its own marker (alert_key) so it pings once per change. The
# worker address + deployed base URL come from ~/.lightnode/alerts.conf (written by
# the app's Downtime alerts card); the heavy lifting runs server-side in the public
# /api/worker-alert (the same checks the dashboard shows), so the watchdog only
# curls + greps - no cast / subgraph parsing in bash.
alert_key(){ local W; W="$(cat "$HOME/.lightnode/alerts.webhook" 2>/dev/null)"; [ -z "$W" ] && return 0; local LF="$HOME/.lightnode/alerts.$1"; local P; P="$(cat "$LF" 2>/dev/null)"; [ "$2" = "$P" ] && return 0; printf '%s' "$2" > "$LF"; [ -n "$2" ] && curl -s -m 8 -H "content-type: application/json" -d "{\\"content\\":\\"$2\\"}" "$W" >/dev/null 2>&1; return 0; }
econ_alerts(){
  [ -s "$HOME/.lightnode/alerts.webhook" ] || return 0
  [ -s "$HOME/.lightnode/alerts.conf" ] || return 0
  local A N B; A="$(sed -nE 's/^WORKER_ADDR=//p' "$HOME/.lightnode/alerts.conf" | head -1)"; N="$(sed -nE 's/^NET=//p' "$HOME/.lightnode/alerts.conf" | head -1)"; B="$(sed -nE 's/^BASE=//p' "$HOME/.lightnode/alerts.conf" | head -1)"
  [ -z "$A" ] && return 0; [ -z "$B" ] && return 0; [ -z "$N" ] && N="mainnet"
  local J; J="$(curl -s -m 12 "$B/api/worker-alert?net=$N&address=$A" 2>/dev/null)"
  printf '%s' "$J" | grep -q '"ok":true' || return 0
  local HN; HN="$(hostname 2>/dev/null || echo worker)"
  if printf '%s' "$J" | grep -q '"outOfGas":true'; then alert_key gas "LightChain worker on $HN is OUT OF GAS - its wallet ($A) cannot pay to acknowledge jobs, settle, or claim. Send it a little LCAI."; else alert_key gas ""; fi
  local S; S="$(printf '%s' "$J" | sed -nE 's/.*"stuck":[[:space:]]*([0-9]+).*/\\1/p')"
  if [ -n "$S" ] && [ "$S" -gt 0 ] 2>/dev/null; then alert_key stuck "LightChain worker on $HN has $S job(s) past their deadline (stuck) - clear them in the app to avoid a timeout slash."; else alert_key stuck ""; fi
  local R; R="$(printf '%s' "$J" | sed -nE 's/.*"settleNow":[[:space:]]*([0-9]+).*/\\1/p')"
  if [ -n "$R" ] && [ "$R" -gt 0 ] 2>/dev/null; then alert_key settle "LightChain worker on $HN has $R completed job(s) ready to settle - open the app and Settle to collect your earnings."; else alert_key settle ""; fi
  local C; C="$(printf '%s' "$J" | sed -nE 's/.*"claimableLcai":[[:space:]]*([0-9.]+).*/\\1/p')"
  if [ -n "$C" ] && awk -v c="$C" 'BEGIN{exit !(c+0 >= 0.01)}' 2>/dev/null; then alert_key claimable "LightChain worker on $HN has ~$C LCAI of earnings claimable - open the app and Withdraw to collect them."; else alert_key claimable ""; fi
}
# Respect an intentional Stop/Deregister: while this marker exists, leave the
# worker alone (Install or Restart clears it to re-arm).
AWAKE="$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist"
if [ -f "$HOME/.lightnode/keep-online.paused" ]; then
  log "paused by user - leaving worker as-is, allowing the machine to sleep"
  [ "$(uname -s)" = "Darwin" ] && launchctl unload "$AWAKE" 2>/dev/null || true
  alert_state paused
  exit 0
fi
# Keep the machine awake while the worker should be online - a sleep mid-job
# drops it (acked-then-asleep = timeout = slash). macOS: a KeepAlive caffeinate
# launchd agent; Linux: a systemd-inhibit holder.
if [ "$(uname -s)" = "Darwin" ]; then
  launchctl list ai.lightchain.worker-awake >/dev/null 2>&1 || launchctl load -w "$AWAKE" 2>/dev/null || true
elif command -v systemd-inhibit >/dev/null 2>&1; then
  pgrep -f "systemd-inhibit.*lightnode-awake" >/dev/null 2>&1 || ( nohup systemd-inhibit --what=idle:sleep --who=lightnode-awake --why="worker running" sleep infinity >/dev/null 2>&1 & )
fi
if ! docker info >/dev/null 2>&1; then
  log "docker down - starting"
  if [ "$(uname -s)" = "Darwin" ]; then open -a Docker 2>/dev/null || true; else systemctl --user start docker-desktop 2>/dev/null || sudo systemctl start docker 2>/dev/null || true; fi
  for _ in $(seq 1 45); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
docker info >/dev/null 2>&1 || { log "docker still down - retry next tick"; alert_state docker_down; exit 0; }
if docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then
  docker ps --format '{{.Names}}' | grep -q '^lightchain-worker$' || { log "worker stopped - starting"; docker start lightchain-worker >/dev/null 2>&1 && log "worker started"; }
fi
# Alert on the final run-state (after any restart attempt), once per transition.
# Running-but-not-connected counts as stale: the worker re-auths with the gateway
# about hourly, so no auth/connect log in 70 min while up means it has dropped off.
if docker ps --format '{{.Names}}' | grep -q '^lightchain-worker$'; then
  if docker logs --since 70m lightchain-worker 2>&1 | grep -qiE "authenticated with worker-gateway|websocket connected"; then alert_state ok; else alert_state stale; fi
else
  alert_state down
fi
# On-chain economic alerts (best-effort), regardless of the local run-state.
econ_alerts
# Keep every served model pinned in Ollama (keep_alive:-1) so none cold-loads
# mid-job. Reads the set from a file (one per line) so a model change is picked up.
while IFS= read -r M; do [ -n "$M" ] && curl -s -m 5 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$M\\",\\"prompt\\":\\"ok\\",\\"keep_alive\\":-1,\\"stream\\":false}" >/dev/null 2>&1 & done < "$HOME/.lightnode/model" 2>/dev/null || true
KEEPEOF
chmod +x "$HOME/.lightnode/keep-online.sh"
if [ "$(uname -s)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  # Sleep-prevention agent: a KeepAlive caffeinate holds the system awake while
  # loaded (unloaded by Stop/Free up/Deregister, and by the watchdog when paused).
  AWAKE="$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist"
  cat > "$AWAKE" <<AWAKEEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.lightchain.worker-awake</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>-s</string></array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>
AWAKEEOF
  launchctl unload "$AWAKE" 2>/dev/null || true
  launchctl load -w "$AWAKE" 2>/dev/null && echo "✓ sleep prevention active (machine stays awake while the worker runs)" || true
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

// Sleep-prevention toggles (unix). ON = load the caffeinate agent (macOS) /
// start a systemd-inhibit holder (Linux). OFF = the reverse, so the machine can
// sleep again once the worker is intentionally down.
const AWAKE_ON_UNIX =
  'if [ "$(uname -s)" = "Darwin" ]; then launchctl load -w "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; elif command -v systemd-inhibit >/dev/null 2>&1; then pgrep -f "systemd-inhibit.*lightnode-awake" >/dev/null 2>&1 || ( nohup systemd-inhibit --what=idle:sleep --who=lightnode-awake --why="worker running" sleep infinity >/dev/null 2>&1 & ); fi';
const AWAKE_OFF_UNIX =
  'if [ "$(uname -s)" = "Darwin" ]; then launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; fi; pkill -f "systemd-inhibit.*lightnode-awake" 2>/dev/null || true; echo "✓ sleep prevention off - the machine can sleep again"';

// Robustly start Docker Desktop on Windows. The install knows the exact path, but
// the watchdog/ops historically used `Start-Process "Docker Desktop"` by NAME,
// which often fails to resolve - so after a reboot the engine never came up and
// the worker (and the keep-online restart) stayed down: jobs sat "Submitted".
// Prefer the real exe under %ProgramFiles%, fall back to the name.
const WIN_START_DOCKER =
  '$dd = Join-Path $env:ProgramFiles "Docker\\Docker\\Docker Desktop.exe"; if (Test-Path $dd) { Start-Process $dd } else { Start-Process "Docker Desktop" -ErrorAction SilentlyContinue }';

// AppImage library-pollution guard (unix). An AppImage exports LD_LIBRARY_PATH
// (and friends) pointing at its OWN bundled libs; the system curl/git/docker we
// shell out to then load those mismatched libs and crash - e.g. the system curl
// picks up the bundle's newer libcurl against the host's older libnghttp2:
// "undefined symbol: nghttp2_option_set_no_rfc9113_...". Strip the bundle-prefixed
// entries (keeping any the user set) so host tools use host libraries. No-op
// unless launched from an AppImage (APPDIR set) - so .deb/.dmg/.exe are untouched.
// Ships web-side, so it fixes even users still on an older AppImage binary.
const APPIMAGE_ENV_GUARD_UNIX =
  `if [ -n "\${APPDIR:-}" ]; then for V in LD_LIBRARY_PATH LD_PRELOAD GIO_MODULE_DIR GTK_PATH GST_PLUGIN_SYSTEM_PATH_1_0 PYTHONPATH PYTHONHOME PERLLIB; do APPV="\${!V}"; [ -z "$APPV" ] && continue; APPNEW="$(printf '%s' "$APPV" | tr ':' '\\n' | grep -vF "$APPDIR" | paste -sd: -)"; if [ -z "$APPNEW" ]; then unset "$V"; else export "$V=$APPNEW"; fi; done; fi`;

// Fallback when the guard above didn't (or couldn't) repair a broken system curl:
// say plainly it's the AppImage build and point at the .deb, instead of the
// misleading "RPC unreachable / check your connection" the curl failure produces.
const APPIMAGE_CURL_HINT_UNIX =
  'if command -v curl >/dev/null 2>&1 && ! curl --version >/dev/null 2>&1; then echo "⛔ your system curl is crashing on startup (a broken library link - common with the AppImage build). That is why the network checks fail, NOT your connection. Install the .deb instead: download it from lightnode.app, or run: sudo apt install ./LightNode_*.deb - it has no bundled libraries. (Updating to the latest AppImage also fixes it.)"; OK=0; fi';

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
# Put tool dirs on PATH up front so an already-installed Foundry / Docker / Ollama
# is detected and we SKIP re-running their installers (foundryup is a network call
# that otherwise ran on every install even when cast was already present).
export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
OS="$(uname -s)"
if [ "$OS" = "Darwin" ] && ! have brew; then echo "⛔ Install Homebrew first: https://brew.sh"; exit 1; fi

# 0) Disk guard. A near-full startup disk makes Docker Desktop's backend crash while
# writing its lock files, into an unrecoverable state ("no space left on device").
# Fail fast with a clear message BEFORE we ever start Docker. (df -k is portable;
# col 4 = available KB; /1048576 = GiB.)
FREE_G="$(df -k / 2>/dev/null | awk 'NR==2 {print int($4/1048576)}')"
if [ -n "$FREE_G" ] && [ "$FREE_G" -lt 5 ]; then
  echo "⛔ Only ~$FREE_G GB free on your startup disk. Docker needs headroom to start safely (a near-full disk crashes its backend into an unrecoverable state), and the AI model needs several GB more. Free up space, then run install again."
  exit 1
fi
[ -n "$FREE_G" ] && [ "$FREE_G" -lt 15 ] && echo "⚠ Only ~$FREE_G GB free - the model download alone needs several GB; you may run low."

# 1) Install only what's missing (idempotent; each is a no-op when present).
if have docker; then echo "✓ Docker already installed"; else
  echo "▶ installing Docker"
  if [ "$OS" = "Darwin" ]; then brew install --cask docker; else curl -fsSL https://get.docker.com | sh; fi
fi
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
hash -r 2>/dev/null || true

# 2) Start Docker AND Ollama TOGETHER so Ollama boots during Docker's (much slower)
# cold start instead of after it. Keep the model resident (no idle eviction) so it
# never cold-loads mid-job - set before starting the server so it's picked up.
export OLLAMA_KEEP_ALIVE=-1
[ "$OS" = "Darwin" ] && { launchctl setenv OLLAMA_KEEP_ALIVE -1 2>/dev/null || true; }
if ! curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "▶ starting the Ollama server"
  if [ "$OS" = "Darwin" ]; then open -a Ollama 2>/dev/null || brew services start ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &)
  else sudo systemctl start ollama 2>/dev/null || systemctl --user start ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 &); fi
fi
# Engine not on the default socket? Try the common alternates (Docker Desktop /
# Colima / Rancher) and pin DOCKER_HOST to whichever answers, before starting it.
if ! docker info >/dev/null 2>&1; then
  for s in "$HOME/.docker/run/docker.sock" "/var/run/docker.sock" "$HOME/.colima/default/docker.sock" "$HOME/.rd/docker.sock"; do
    if [ -S "$s" ] && DOCKER_HOST="unix://$s" docker info >/dev/null 2>&1; then export DOCKER_HOST="unix://$s"; break; fi
  done
fi
DOCKER_BACKEND_LOG="$HOME/Library/Containers/com.docker.docker/Data/log/host/com.docker.backend.log"
if ! docker info >/dev/null 2>&1; then
  if [ "$OS" = "Darwin" ]; then
    # A crashed session can leave com.docker.backend processes running while the
    # daemon is dead - a graceful quit won't clear them, and a new launch collides
    # with the zombies. If any are alive while docker is down, clear them first
    # (TERM, then KILL - the parent backend often survives SIGTERM).
    if pgrep -f com.docker.backend >/dev/null 2>&1; then
      echo "▶ Docker looks wedged (leftover backend from a crashed session) - clearing it first"
      osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
      pkill -f "Docker.app/Contents/MacOS/com.docker.backend" 2>/dev/null || true
      pkill -f "Docker Desktop.app" 2>/dev/null || true
      sleep 2
      BPIDS="$(pgrep -f com.docker.backend 2>/dev/null)"; [ -n "$BPIDS" ] && kill -9 $BPIDS 2>/dev/null; true
      sleep 2
    fi
    echo "▶ starting the Docker engine"
    open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  else
    echo "▶ starting the Docker engine"
    sudo systemctl start docker 2>/dev/null || systemctl --user start docker-desktop 2>/dev/null || true
  fi
fi

# 3) Wait for Docker (the slow one), then Ollama (which booted in parallel, so this
# is usually instant). One clean recovery at ~90s covers both the macOS half-state
# (GUI open, engine never started) and a wedged/zombie backend.
echo "… waiting for the Docker engine (a cold start - e.g. right after 'Free up memory' - can take 1-2 min; approve any Docker permission dialog if it appears)"
for i in $(seq 1 120); do
  docker info >/dev/null 2>&1 && break
  if [ "$OS" = "Darwin" ] && [ "$i" = "45" ] && ! docker info >/dev/null 2>&1; then
    echo "▶ Docker still not up - restarting it cleanly (clearing any stuck backend)..."
    osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true; sleep 2
    BPIDS="$(pgrep -f com.docker.backend 2>/dev/null)"; [ -n "$BPIDS" ] && kill -9 $BPIDS 2>/dev/null; true
    pkill -x "Docker Desktop" 2>/dev/null || true; sleep 3
    open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  fi
  [ $((i % 15)) -eq 0 ] && echo "… still waiting for Docker ($((i * 2))s elapsed)"
  sleep 2
done
if ! docker info >/dev/null 2>&1; then
  # Surface the REAL cause from Docker's own backend log, not a generic message.
  if [ "$OS" = "Darwin" ] && [ -f "$DOCKER_BACKEND_LOG" ] && tail -n 60 "$DOCKER_BACKEND_LOG" 2>/dev/null | grep -qiE "no space left|writing locks"; then
    echo "⛔ Docker can't start: your startup disk is full - its backend crashed writing lock files. Free up several GB, then run install again."
  elif [ "$OS" = "Darwin" ] && [ -f "$DOCKER_BACKEND_LOG" ] && tail -n 60 "$DOCKER_BACKEND_LOG" 2>/dev/null | grep -qi "backend crashed"; then
    echo "⛔ Docker's backend crashed on startup. Open Docker Desktop manually; if it offers 'Reset to factory defaults', use it, then run install again."
    echo "   last backend error:"; tail -n 2 "$DOCKER_BACKEND_LOG" 2>/dev/null | sed 's/^/   /'
  else
    echo "⛔ Docker engine didn't come up. Open Docker Desktop manually (approve any permission prompt), wait for the whale icon in the menu bar to settle, then run install again."
  fi
  exit 1
fi
echo "✓ Docker engine ready"
echo "… waiting for Ollama on 127.0.0.1:11434"
for _ in $(seq 1 30); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || { echo "⛔ Ollama isn't responding on 127.0.0.1:11434 - open the Ollama app (or run 'ollama serve'), then re-run."; exit 1; }
echo "✓ Ollama server running"
# Linux ONLY: the worker runs in Docker and reaches Ollama on the host via
# host.docker.internal -> the docker-bridge gateway (172.17.0.1). Ollama defaults
# to listening on 127.0.0.1 ONLY, so that connection is REFUSED ("dial tcp
# 172.17.0.1:11434: connect: connection refused") and EVERY job fails at the
# inference stage. (macOS/Windows are fine: Docker Desktop's VM proxies
# host.docker.internal to the host loopback - bare-metal Linux has no such proxy.)
# Bind Ollama to 0.0.0.0 so the bridge can reach it. Idempotent.
if [ "$OS" = "Linux" ]; then
  if systemctl show ollama 2>/dev/null | grep -q 'OLLAMA_HOST=0.0.0.0'; then
    echo "✓ Ollama is reachable from the worker container (0.0.0.0)"
  elif systemctl list-unit-files 2>/dev/null | grep -q '^ollama.service'; then
    echo "▶ allowing the worker container to reach Ollama (binding it to 0.0.0.0)"
    # Editing the system ollama.service needs root. Try, in order: passwordless
    # sudo (silent), pkexec (a GRAPHICAL admin prompt - works from the GUI app
    # where there is no terminal for sudo), then sudo (prompts on a real terminal).
    OLLPRIV='mkdir -p /etc/systemd/system/ollama.service.d && printf "[Service]\\nEnvironment=\\"OLLAMA_HOST=0.0.0.0:11434\\"\\nEnvironment=\\"OLLAMA_KEEP_ALIVE=-1\\"\\n" > /etc/systemd/system/ollama.service.d/lightnode.conf && systemctl daemon-reload && systemctl restart ollama'
    if sudo -n sh -c "$OLLPRIV" 2>/dev/null || { command -v pkexec >/dev/null 2>&1 && pkexec sh -c "$OLLPRIV" 2>/dev/null; } || sudo sh -c "$OLLPRIV" 2>/dev/null; then
      for _ in $(seq 1 30); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
      echo "✓ Ollama now listening on 0.0.0.0:11434 - the worker container can reach it"
    else
      echo "⚠ Ollama only listens on 127.0.0.1, so the Dockerized worker can't reach it and jobs will fail at inference. Approve the admin prompt if one appears, or run once in a terminal: sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment=\"OLLAMA_HOST=0.0.0.0:11434\"\\n' | sudo tee /etc/systemd/system/ollama.service.d/lightnode.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama"
    fi
  else
    echo "▶ restarting Ollama bound to 0.0.0.0 so the worker container can reach it"
    pkill -f 'ollama serve' 2>/dev/null || true; sleep 1
    OLLAMA_HOST=0.0.0.0:11434 OLLAMA_KEEP_ALIVE=-1 nohup ollama serve >/dev/null 2>&1 &
    for _ in $(seq 1 30); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
    echo "✓ Ollama listening on 0.0.0.0:11434"
  fi
fi

# 4) Foundry must be on PATH for the cast calls in the toolkit phases.
export PATH="$HOME/.foundry/bin:$PATH"
hash -r 2>/dev/null || true
have cast || { echo "⛔ Foundry installed but 'cast' isn't on PATH yet - fully quit and reopen LightNode, then run again."; exit 1; }
echo "✓ Foundry (cast) ready"`;

/** Smart, idempotent install for macOS + Linux (bash). The app passes the
 *  WORKER key + password via env; we fund the worker directly from the user's
 *  wallet, so there's no separate funder and no phase 00/06. */
function unixInstall(network: NetworkId, models: string[]): string {
  const chainId = NETWORKS[network].chainId;
  const minStake = NETWORKS[network].minStakeLcai; // build-time fallback only; real value read live from AIConfig
  const rpc = NETWORKS[network].rpc;
  const explorer = NETWORKS[network].explorer;
  const workerRegistry = NETWORKS[network].workerRegistry;
  // Threshold for the funding gate: min stake + 0.5 LCAI gas cushion, in wei.
  // BigInt because the value overflows JS Number for mainnet (50_000.5 * 1e18).
  const thrWei = (BigInt(minStake) * 10n ** 18n + 5n * 10n ** 17n).toString();
  const list = models.length ? models : [DEFAULT_MODEL];
  const supported = list.join(","); // SUPPORTED_MODELS the worker advertises
  const shellList = list.map((m) => `"${m}"`).join(" "); // for `for M in ...` loops
  return [
    "set -e",
    "exec 2>&1", // surface stderr (git clone, cast, etc.) in the streamed log
    APPIMAGE_ENV_GUARD_UNIX, // host libs for shelled-out curl/git/docker on AppImage
    `echo "▶ LightNode installer rev ${INSTALLER_REV} (${network})"`,
    SMART_PREREQS,
    // The app's working dir may be "/" (non-writable). Work in a real home dir.
    'mkdir -p "$HOME/.lightnode" && cd "$HOME/.lightnode" && echo "✓ workdir: $HOME/.lightnode"',
    // Changing the served set? Unload any previously-served model that is NOT in
    // the new set (each is pinned with keep_alive:-1 and never evicts on its own),
    // so its memory is freed instead of sitting resident.
    `NEWSET="${list.join(" ")}"`,
    'for OM in $(cat "$HOME/.lightnode/model" 2>/dev/null); do case " $NEWSET " in *" $OM "*) : ;; *) curl -s -m 10 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$OM\\",\\"keep_alive\\":0}" >/dev/null 2>&1; echo "✓ unloaded $OM (no longer served)";; esac; done',
    // Record the served set (one model per line) so the watchdog warms each.
    `printf '%s\\n' ${shellList} > "$HOME/.lightnode/model"`,
    // Installing means the user wants the worker running - clear any pause set by
    // a previous Stop/Deregister so the watchdog resumes guarding it.
    'rm -f "$HOME/.lightnode/keep-online.paused" 2>/dev/null || true',
    // Arm the keep-online watchdog on every run (best-effort, never aborts the
    // install) so it's refreshed even when the worker is already running.
    "set +e",
    KEEP_ONLINE_UNIX,
    'cd "$HOME/.lightnode"',
    "set -e",
    // Ensure EACH selected model is in Ollama under its exact on-chain name. The
    // toolkit's phase 02 only handles llama3-8b, so pull + alias any others here.
    // The pull tag is the on-chain name with the size turned back into a tag
    // (llama3-70b -> llama3:70b); already-present models are skipped.
    //
    // Pull with THROTTLED progress: ollama assumes a TTY and emits thousands of
    // escape-coded progress frames per download. Streamed verbatim that floods the
    // app's log channel (and on a multi-GB model can choke the install). Piping the
    // pull to a file makes ollama emit terse non-TTY output; we sample the percent
    // every couple of seconds, so the app sees a handful of clean lines.
    "pull_model() {",
    '  PM_NAME="$1"; PM_TAG="$2"; PM_LOG="$HOME/.lightnode/.pull.log"; : > "$PM_LOG"',
    '  echo "▶ downloading $PM_NAME - a multi-GB model can take several minutes"',
    '  ( ollama pull "$PM_TAG" > "$PM_LOG" 2>&1; echo "__PULLRC__:$?" >> "$PM_LOG" ) &',
    '  PM_PID=$!; PM_LAST=""',
    '  while kill -0 "$PM_PID" 2>/dev/null; do',
    "    PM_PCT=\"$(tr '\\r' '\\n' < \"$PM_LOG\" 2>/dev/null | grep -oE '[0-9]+%' | tail -1)\"",
    '    [ -n "$PM_PCT" ] && [ "$PM_PCT" != "$PM_LAST" ] && { echo "  downloading $PM_NAME $PM_PCT"; PM_LAST="$PM_PCT"; } || true',
    "    sleep 2",
    "  done",
    '  wait "$PM_PID" 2>/dev/null || true',
    "  PM_RC=\"$(grep -oE '__PULLRC__:[0-9]+' \"$PM_LOG\" | tail -1 | cut -d: -f2)\"; rm -f \"$PM_LOG\"",
    '  if [ "${PM_RC:-1}" = "0" ]; then echo "✓ downloaded $PM_NAME"; else echo "⚠ $PM_NAME download exited ${PM_RC:-?} (continuing)"; fi',
    "}",
    `for M in ${shellList}; do TAG="$(printf '%s' "$M" | sed -E 's/-([0-9.]+[bB])$/:\\1/')"; if ollama list 2>/dev/null | grep -qiE "(^|[[:space:]])$M(:latest)?([[:space:]]|$)"; then echo "✓ model $M present"; else pull_model "$M" "$TAG"; [ "$TAG" != "$M" ] && ollama cp "$TAG" "$M" >/dev/null 2>&1 && echo "✓ aliased $TAG -> $M" || true; fi; done`,
    `if [ -d lightchain-worker-toolkit ]; then echo "✓ toolkit present - updating"; (cd lightchain-worker-toolkit && git pull --ff-only || true); else git clone ${TOOLKIT}.git; fi`,
    "cd lightchain-worker-toolkit/scripts/bash",
    "[ -f secrets.env ] || cp secrets.example.sh secrets.env",
    // Pass secrets via the environment (the app already exported WORKER_PASSWORD +
    // WORKER_PRIVKEY) - strip any file-set copies so they can't override, and add
    // the derived address. Avoids sed-escaping pitfalls with special chars.
    "grep -vE '^[[:space:]]*export (WORKER_PASSWORD|WORKER_ADDR|WORKER_PRIVKEY|FUNDER_PRIVKEY)=' secrets.env > secrets.env.tmp || true; mv secrets.env.tmp secrets.env",
    // Prefer the address the app passed (public, always known). Only derive it
    // from the key when absent - a switch-back to an already-registered worker may
    // run without the raw key in the app (the on-disk keystore holds it).
    'export WORKER_ADDR="${WORKER_ADDR:-$(cast wallet address --private-key "$WORKER_PRIVKEY" 2>/dev/null)}"',
    '[ -n "$WORKER_ADDR" ] || { echo "⛔ no worker address or key available to install - generate/select a worker first."; exit 1; }',
    `export NETWORK=${network} SUPPORTED_MODELS=${supported}`,
    // Per-network keystore dir so installing one network never touches another's
    // keys (a mainnet operator can set up testnet without risking their mainnet
    // key). The legacy ~/lightchain-worker/keys is still read by key derivation.
    `export KEYS_DIR="$HOME/lightchain-worker/keys-${network}"`,
    // ── Derive the REAL minimum stake LIVE from chain. Never hardcode it. ──────
    // The WorkerRegistry predeploy points at AIConfig, which holds the canonical
    // getMinWorkerStake(). cast prints "<wei> [sci-notation]" so take field 1.
    // Falls back to the build-time NETWORKS value only if the read fails (network
    // hiccup) so a transient RPC blip can't brick the install.
    `MIN_FALLBACK_WEI="$(python3 -c 'print(${minStake} * 10**18)')"`,
    `AICFG_ADDR="$(cast call "${workerRegistry}" 'aiConfig()(address)' --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"`,
    `MIN_STAKE_WEI="$(cast call "$AICFG_ADDR" 'getMinWorkerStake()(uint256)' --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"`,
    'case "${MIN_STAKE_WEI:-}" in ""|*[!0-9]*) MIN_STAKE_WEI="$MIN_FALLBACK_WEI"; echo "⚠ could not read min stake from AIConfig; using fallback";; esac',
    // Whole-LCAI stake, the +1 guard threshold, and the funding threshold (stake +
    // 0.5 LCAI gas cushion), all computed from the LIVE wei value.
    `MIN_STAKE_LCAI="$(python3 -c 'import sys; print(int(sys.argv[1])//10**18)' "$MIN_STAKE_WEI")"`,
    `GUARD_LCAI="$(python3 -c 'import sys; print(int(sys.argv[1])//10**18 + 1)' "$MIN_STAKE_WEI")"`,
    `THR_WEI="$(python3 -c 'import sys; print(int(sys.argv[1]) + 5*10**17)' "$MIN_STAKE_WEI")"`,
    `echo "✓ min stake (live from AIConfig): $MIN_STAKE_LCAI LCAI"`,
    // The toolkit prints a hardcoded "STAKE 50,000 LCAI" line; say "the network
    // minimum" so it's honest on every network.
    `sed -i.bak "s/STAKE 50,000 LCAI/STAKE the network minimum/g" 07-register.sh && rm -f 07-register.sh.bak`,
    // The toolkit's 07-register pre-flight balance guard is hardcoded to the
    // MAINNET stake ("Worker has less than 50,001 LCAI", and a `b < 50001` /
    // `-lt 50001` test), so a correctly funded testnet worker wrongly fails it and
    // never reaches the real register tx. Rewrite the threshold to the LIVE
    // minimum + 1. Patch both literal forms (the "50,001" display string and the
    // bare 50001 used in the test); 50001 only ever appears as this threshold, so a
    // global replace is safe. No \\b word boundary (BSD sed lacks it).
    'sed -i.bak "s/50,001/$GUARD_LCAI/g; s/50001/$GUARD_LCAI/g" 07-register.sh && rm -f 07-register.sh.bak',
    'echo "✓ register pre-flight threshold set to the live minimum ($MIN_STAKE_LCAI LCAI + gas)"',
    `echo "▶ funding worker: send to $WORKER_ADDR"`,
    // This machine runs ONE worker container at a time. If a container for THIS
    // network is already running AND the worker is genuinely live on-chain
    // (registered + eligible for the selected model), there's nothing to do. If
    // it's for a DIFFERENT network, stop it and carry on (phase 08 recreates it).
    // CRITICAL: a running container does NOT mean a working worker - a prior
    // install can leave the container Up while the on-chain register/add-model
    // failed (e.g. the daemon's add-model OutOfGas bug), so the worker is staked
    // but serving nothing. We must verify on-chain before declaring "online",
    // otherwise we'd falsely report success and skip the re-register that fixes it.
    `MODEL_ID="$(cast keccak "$(printf '%s' "${supported}" | cut -d, -f1)" 2>/dev/null)"`,
    `if docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -qE '^lightchain-worker Up'; then RUNCHAIN="$(docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^CHAIN_ID=' | head -1 | cut -d= -f2)"; if [ -n "$RUNCHAIN" ] && [ "$RUNCHAIN" != "${chainId}" ]; then echo "▶ a worker for the other network (chain $RUNCHAIN) is running; this machine runs one at a time. Stopping it to install ${network} (chain ${chainId}). Its stake + keys stay intact - reinstall that network to bring it back."; docker stop lightchain-worker >/dev/null 2>&1 || true; else REG_OK="$(cast call "${workerRegistry}" 'isWorkerRegistered(address)(bool)' "$WORKER_ADDR" --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"; ELIG_OK="$( [ -n "$MODEL_ID" ] && cast call "${workerRegistry}" 'isEligible(address,bytes32)(bool)' "$WORKER_ADDR" "$MODEL_ID" --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"; if [ "$REG_OK" = "true" ] && [ "$ELIG_OK" = "true" ]; then echo "✓ worker already running on ${network} and live on-chain - nothing to reinstall"; echo "✅ worker online"; exit 0; else echo "▶ a worker container is running but it is not live on-chain (registered=$REG_OK, serving-selected-model=$ELIG_OK) - a prior setup left it staked-but-not-serving. Recreating it."; docker stop lightchain-worker >/dev/null 2>&1 || true; fi; fi; fi`,
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
    // ──────────────────────────────────────────────────────────────────────────
    // Pre-flight for phase 07-register, in two steps the toolkit can't do for us:
    //
    //   1. Multi-password keystore resolve. When a previous attempt left a key on
    //      disk (SKIP_IMPORT=1), the password the user types this session may not
    //      match the one used originally - in that case the toolkit signs with the
    //      wrong key and register silently fails. Mirror the settle/deregister/
    //      withdraw fix: try each saved slot against the keystore, lock onto the
    //      one that decrypts, and fail clearly (with a pointer to "Recover a
    //      replaced key") only when no slot works.
    //
    //   2. Funding gate. The toolkit's 07-register transfers the stake in LCAI
    //      and pays gas in LCAI. If the wallet is short (or a funding tx is still
    //      pending) it would otherwise fail with a generic on-chain revert. Wait
    //      up to ~90s so a just-funded retry just proceeds; fail clearly only when
    //      the wallet is genuinely empty after the wait.
    // ──────────────────────────────────────────────────────────────────────────
    [
      "resolve_password() {",
      '  KSF="$(ls -1 "$KS" 2>/dev/null | head -1)"; [ -z "$KSF" ] && return 0',
      '  for PW in "${WORKER_PASSWORD:-}" "${WORKER_PASSWORD_ALT1:-}" "${WORKER_PASSWORD_ALT2:-}" "${WORKER_PASSWORD_ALT3:-}"; do',
      '    [ -z "$PW" ] && continue',
      '    if cast wallet decrypt-keystore "$KSF" --keystore-dir "$KS" --unsafe-password "$PW" >/dev/null 2>&1; then',
      '      export WORKER_PASSWORD="$PW"; echo "✓ existing worker keystore unlocked"; return 0',
      "    fi",
      "  done",
      "  return 1",
      "}",
    ].join("\n"),
    [
      "gate_funding() {",
      "  GATE_LCAI=0",
      "  for w in $(seq 1 18); do",
      `    BAL_HEX="$(curl -s -m 5 -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["'"$WORKER_ADDR"'","latest"],"id":1}' '${rpc}' | sed -nE 's/.*"result":"(0x[0-9a-fA-F]+)".*/\\1/p')"`,
      `    BAL_WEI="$(python3 -c 'import sys; print(int(sys.argv[1] or "0x0", 16))' "\${BAL_HEX:-0x0}" 2>/dev/null || echo 0)"`,
      `    GATE_LCAI="$(python3 -c 'import sys; print(round(int(sys.argv[1])/10**18,3))' "$BAL_WEI" 2>/dev/null || echo 0)"`,
      `    if python3 -c 'import sys; sys.exit(0 if int(sys.argv[1])>=int(sys.argv[2]) else 1)' "$BAL_WEI" "$THR_WEI"; then echo "✓ worker wallet funded ($GATE_LCAI LCAI)"; return 0; fi`,
      `    if [ "$w" = "1" ] || [ "$(($w % 6))" = "0" ]; then echo "▶ waiting for funding: worker wallet at $WORKER_ADDR has $GATE_LCAI LCAI, needs at least $MIN_STAKE_LCAI.5 LCAI (stake + a small gas cushion)"; fi`,
      "    sleep 5",
      "  done",
      `  echo "⛔ funding-gate timeout: worker wallet at $WORKER_ADDR still has only $GATE_LCAI LCAI. Send at least $MIN_STAKE_LCAI.5 LCAI to that address (see ${explorer}/address/$WORKER_ADDR) and run install again - your existing setup is reused."`,
      "  return 1",
      "}",
    ].join("\n"),
    'if [ "$SKIP_IMPORT" = "1" ]; then',
    "  if ! resolve_password; then",
    // The on-disk keystore was encrypted with a password none of the saved slots
    // match. If the app still holds this worker's raw key (WORKER_PRIVKEY), we
    // don't need the old password at all - back up the stale keystore + its
    // password-encrypted ECDH/session state and re-import the key under the
    // current password (phase 04 + 05 regenerate cleanly). The keystore is just
    // an encrypted container for the key; the on-chain identity is the ADDRESS,
    // so this changes nothing on-chain and never touches any stake. Only block
    // when we genuinely can't reconstruct the key (no privkey AND no password).
    '    if [ -n "${WORKER_PRIVKEY:-}" ]; then',
    '      echo "▶ the on-disk keystore uses a password the app no longer has - re-importing this worker\'s key under the current password (on-chain identity is unchanged; no stake is touched)"',
    '      mv "$KS" "${KS}.bak-$(date +%s)" 2>/dev/null || true',
    '      for f in "$ENCKEY" "$SESS"; do [ -f "$f" ] && mv "$f" "${f}.bak-$(date +%s)"; done',
    "      SKIP_IMPORT=0",
    "    else",
    `      echo "⛔ keystore-password-mismatch: an existing worker key for $WORKER_ADDR is on this device, but the password set this session does not decrypt it. Re-enter the original password you set when this worker was first created, or open Recover a replaced key on the dashboard to switch to a different worker."; exit 1`,
    "    fi",
    "  fi",
    "fi",
    // Gas-correct on-chain add of the selected model, to FINISH a worker that
    // staked but whose model-add failed inside the daemon's one-shot register (the
    // daemon under-sets the gas limit -> OutOfGas). We send addSupportedModel
    // ourselves with gas = estimate x1.5, which lands. No-op if already eligible.
    [
      "add_selected_model_onchain() {",
      '  [ -z "$MODEL_ID" ] && return 0',
      `  if cast call "${workerRegistry}" "isEligible(address,bytes32)(bool)" "$WORKER_ADDR" "$MODEL_ID" --rpc-url "${rpc}" 2>/dev/null | grep -qi true; then return 0; fi`,
      `  AM_EST="$(cast estimate --from "$WORKER_ADDR" "${workerRegistry}" "addSupportedModel(bytes32)" "$MODEL_ID" --rpc-url "${rpc}" 2>/dev/null)"`,
      `  case "\${AM_EST:-}" in ""|*[!0-9]*) AM_GAS=300000;; *) AM_GAS="$(python3 -c 'import sys; print(int(int(sys.argv[1])*3//2))' "$AM_EST")";; esac`,
      '  echo "▶ adding the selected model on-chain with proper gas (gas-limit $AM_GAS) - the daemon under-gasses this step"',
      `  if cast send "${workerRegistry}" "addSupportedModel(bytes32)" "$MODEL_ID" --private-key "$WORKER_PRIVKEY" --rpc-url "${rpc}" --gas-limit "$AM_GAS" >/dev/null 2>&1; then echo "✓ model added on-chain (worker now serving it)"; return 0; else echo "⛔ model add failed even with estimated gas"; return 1; fi`,
      "}",
    ].join("\n"),
    `for p in ${DESKTOP_PHASES}; do if [ "$p" = "04-import-key" ] && [ "$SKIP_IMPORT" = "1" ]; then echo "▶ phase 04-import-key (skipped - key already present)"; continue; fi; if [ "$p" = "07-register" ]; then REG_OK="$(cast call "${workerRegistry}" 'isWorkerRegistered(address)(bool)' "$WORKER_ADDR" --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"; ELIG_OK="$( [ -n "$MODEL_ID" ] && cast call "${workerRegistry}" 'isEligible(address,bytes32)(bool)' "$WORKER_ADDR" "$MODEL_ID" --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"; if [ "$REG_OK" = "true" ] && [ "$ELIG_OK" = "true" ]; then echo "▶ phase 07-register (skipped - already registered AND serving the selected model on-chain)"; continue; fi; if [ "$REG_OK" = "true" ] && [ "$ELIG_OK" != "true" ]; then echo "▶ phase 07-register (already staked from a prior attempt; finishing the model-add the daemon failed - no re-stake)"; add_selected_model_onchain || exit 1; continue; fi; gate_funding || exit 1; fi; if [ "$p" = "07-register" ]; then echo "▶ phase $p"; FORCE=1 "$RUNBASH" "$p.sh" 2>&1 || true; NOW_REG="$(cast call "${workerRegistry}" 'isWorkerRegistered(address)(bool)' "$WORKER_ADDR" --rpc-url "${rpc}" 2>/dev/null | awk '{print $1}')"; if [ "$NOW_REG" != "true" ]; then echo "⛔ stopped at 07-register (worker not registered on-chain after the attempt)"; exit 1; fi; add_selected_model_onchain || exit 1; else echo "▶ phase $p"; FORCE=1 "$RUNBASH" "$p.sh" 2>&1 || { echo "⛔ stopped at $p"; exit 1; }; fi; done`,
    // Pre-warm: load each served model and pin it (keep_alive:-1) so the first
    // real job doesn't pay a cold-load that could exceed the inference timeout.
    `echo "▶ pre-warming ${list.join(", ")} (kept resident to avoid cold-load timeouts)"`,
    `for M in ${shellList}; do curl -s -m 120 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$M\\",\\"prompt\\":\\"ok\\",\\"keep_alive\\":-1,\\"stream\\":false}" >/dev/null 2>&1 || true; done`,
    'echo "✅ worker online"',
  ].join("\n");
}

/** Smart, idempotent install for Windows (PowerShell). Auto-starts Docker
 *  Desktop, installs missing tools via winget, and runs the toolkit's ps1 phases. */
function windowsInstall(network: NetworkId, models: string[]): string {
  const chainId = NETWORKS[network].chainId;
  const minStake = NETWORKS[network].minStakeLcai; // build-time fallback only; real value read live from AIConfig
  const rpc = NETWORKS[network].rpc;
  const explorer = NETWORKS[network].explorer;
  const workerRegistry = NETWORKS[network].workerRegistry;
  const phases = DESKTOP_PHASES.split(" ").map((p) => `.\\${p}.ps1`).join("','");
  const list = models.length ? models : [DEFAULT_MODEL];
  const supported = list.join(",");
  const psList = "@(" + list.map((m) => `'${m}'`).join(",") + ")";
  return `$ErrorActionPreference = "Stop"
Write-Host "▶ LightNode installer rev ${INSTALLER_REV} (${network})"
# Let the toolkit's .ps1 phase scripts run regardless of the machine's execution
# policy. Windows client defaults to Restricted, which blocks running .ps1 FILES:
# this inline -Command install runs fine, but the first '& .\NN-*.ps1' phase is
# refused with "running scripts is disabled on this system" - the silent stop at
# 01-resolve-addresses. Process scope only; never touches the user/machine policy.
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}
Write-Host "✓ script execution enabled for this install"
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
# Keep the model resident (no idle eviction) so it never cold-loads mid-job.
setx OLLAMA_KEEP_ALIVE -1 *> $null; $env:OLLAMA_KEEP_ALIVE = "-1"
if (Have cast) { Write-Host "✓ Foundry already installed" } else { Write-Host "▶ installing Foundry"; Invoke-RestMethod https://foundry.paradigm.xyz | Invoke-Expression; foundryup }

# The app's working dir may not be writable; work in a real home dir.
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.lightnode" | Out-Null
Set-Location "$env:USERPROFILE\\.lightnode"
# Installing means the worker should run - clear any pause from a prior Stop/Deregister.
Remove-Item (Join-Path $env:USERPROFILE ".lightnode\\keep-online.paused") -ErrorAction SilentlyContinue
# Changing the served set? Unload any previously-served model not in the new set
# (each is pinned with keep_alive:-1) so its memory is freed.
$newSet = ${psList}
$old = (Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue)
foreach ($om in $old) { if ($om -and ($newSet -notcontains $om)) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 10 -Body "{\`"model\`":\`"$om\`",\`"keep_alive\`":0}" | Out-Null; Write-Host "unloaded $om (no longer served)" } catch {} } }
# Record the served set (one model per line) so the watchdog warms each.
Set-Content -Path (Join-Path $env:USERPROFILE ".lightnode\\model") -Value $newSet
# Sleep-prevention holder (mirrors macOS caffeinate / Linux systemd-inhibit). A
# worker that's acked a job and then sleeps times out = slash, and the Windows
# build previously had NO sleep guard at all, so a laptop nap dropped the worker
# and any jobs that arrived meanwhile sat "Submitted". This holds the system awake
# (SetThreadExecutionState) while the worker should run; a global mutex makes it a
# singleton, and it releases the moment the pause marker (Stop/Deregister) appears.
$ka = Join-Path $env:USERPROFILE ".lightnode\\keep-awake.ps1"
@'
$mtx = New-Object System.Threading.Mutex($false, "Global\\LightChainWorkerAwake")
if (-not $mtx.WaitOne(0)) { exit 0 }
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class LcPower{[DllImport("kernel32.dll")]public static extern uint SetThreadExecutionState(uint f);}'
$CONT = [uint32]2147483648; $SYS = [uint32]1   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
$pause = Join-Path $env:USERPROFILE ".lightnode\\keep-online.paused"
while (-not (Test-Path $pause)) { [LcPower]::SetThreadExecutionState($CONT -bor $SYS) | Out-Null; Start-Sleep -Seconds 50 }
[LcPower]::SetThreadExecutionState($CONT) | Out-Null
'@ | Set-Content -Path $ka -Encoding ASCII
# Keep-online watchdog: auto-start Docker + the worker on a schedule (survives reboot).
try {
  $ko = Join-Path $env:USERPROFILE ".lightnode\\keep-online.ps1"
@'
# Downtime + economic alerts (Windows parity with the unix watchdog, which the
# Windows build was missing entirely). Send-State posts run-state transitions
# (down/docker_down/stale/ok) via a single marker; Send-Alert posts each economic
# category (gas/stuck/settle) via its own marker so it pings once per change.
function Send-State($state){ $wf = Join-Path $env:USERPROFILE ".lightnode\\alerts.webhook"; if (-not (Test-Path $wf)) { return }; $W = (Get-Content $wf -ErrorAction SilentlyContinue | Select-Object -First 1); if (-not $W) { return }; $lf = Join-Path $env:USERPROFILE ".lightnode\\alerts.last"; $prev = ((Get-Content $lf -ErrorAction SilentlyContinue) -join "").Trim(); if ($state -eq $prev) { return }; Set-Content -Path $lf -Value $state; $hn = $env:COMPUTERNAME; $m = ""; switch ($state) { "down" { $m = "LightChain worker is DOWN on $hn and could not be restarted." } "docker_down" { $m = "LightChain worker host $hn: Docker is not running." } "stale" { $m = "LightChain worker on $hn is running but not connected to the gateway (stale) - it is not taking jobs." } "ok" { if ($prev -in @("down","docker_down","stale")) { $m = "LightChain worker is back online on $hn." } } }; if ($m) { try { Invoke-RestMethod -Uri $W -Method Post -ContentType 'application/json' -Body (@{content=$m} | ConvertTo-Json) -TimeoutSec 8 | Out-Null } catch {} } }
function Send-Alert($key,$msg){ $wf = Join-Path $env:USERPROFILE ".lightnode\\alerts.webhook"; if (-not (Test-Path $wf)) { return }; $W = (Get-Content $wf -ErrorAction SilentlyContinue | Select-Object -First 1); if (-not $W) { return }; $lf = Join-Path $env:USERPROFILE ".lightnode\\alerts.$key"; $prev = ((Get-Content $lf -ErrorAction SilentlyContinue) -join "").Trim(); $cur = ("" + $msg).Trim(); if ($cur -eq $prev) { return }; Set-Content -Path $lf -Value $cur; if ($cur) { try { Invoke-RestMethod -Uri $W -Method Post -ContentType 'application/json' -Body (@{content=$cur} | ConvertTo-Json) -TimeoutSec 8 | Out-Null } catch {} } }
if (Test-Path (Join-Path $env:USERPROFILE ".lightnode\\keep-online.paused")) { Send-State "paused"; exit 0 }
docker info *> $null
if (-not $?) { ${WIN_START_DOCKER}; for ($i=0;$i -lt 45;$i++){ docker info *> $null; if($?){break}; Start-Sleep 2 } }
docker info *> $null; if (-not $?) { Send-State "docker_down"; exit 0 }
$running = $false
if ((docker ps -a --format "{{.Names}}") -match "^lightchain-worker$") { if (-not ((docker ps --format "{{.Names}}") -match "^lightchain-worker$")) { docker start lightchain-worker | Out-Null; Start-Sleep 5 }; if ((docker ps --format "{{.Names}}") -match "^lightchain-worker$") { $running = $true } }
# Stale = running but no gateway-auth line in 70m. ALERT only, never auto-restart:
# a busy worker on a long job (or whose auth line scrolled past the window) would
# otherwise be killed mid-job (timeout = slash) every tick, in a restart loop.
# Matches the unix watchdog, which only alerts on stale. (The user Restarts.)
if ($running) { if ((docker logs --since 70m lightchain-worker 2>&1) -match "authenticated with worker-gateway|websocket connected") { Send-State "ok" } else { Send-State "stale" } } else { Send-State "down" }
# On-chain economic alerts via the public /api/worker-alert (same checks the dashboard runs).
$conf = Join-Path $env:USERPROFILE ".lightnode\\alerts.conf"
if ((Test-Path (Join-Path $env:USERPROFILE ".lightnode\\alerts.webhook")) -and (Test-Path $conf)) {
  $c = @{}; foreach ($ln in (Get-Content $conf -ErrorAction SilentlyContinue)) { if ($ln -match "^([^=]+)=(.*)$") { $c[$matches[1]] = $matches[2] } }
  if ($c.WORKER_ADDR -and $c.BASE) {
    $net = if ($c.NET) { $c.NET } else { "mainnet" }
    try {
      $r = Invoke-RestMethod -Uri ("{0}/api/worker-alert?net={1}&address={2}" -f $c.BASE, $net, $c.WORKER_ADDR) -TimeoutSec 12
      if ($r.ok) {
        $hn = $env:COMPUTERNAME
        if ($r.outOfGas) { Send-Alert gas "LightChain worker on $hn is OUT OF GAS - its wallet ($($c.WORKER_ADDR)) cannot pay to acknowledge jobs, settle, or claim. Send it a little LCAI." } else { Send-Alert gas "" }
        if ([int]$r.stuck -gt 0) { Send-Alert stuck "LightChain worker on $hn has $($r.stuck) job(s) past their deadline (stuck) - clear them in the app to avoid a timeout slash." } else { Send-Alert stuck "" }
        if ([int]$r.settleNow -gt 0) { Send-Alert settle "LightChain worker on $hn has $($r.settleNow) completed job(s) ready to settle - open the app and Settle to collect your earnings." } else { Send-Alert settle "" }
        if ([double]$r.claimableLcai -ge 0.01) { Send-Alert claimable "LightChain worker on $hn has ~$($r.claimableLcai) LCAI of earnings claimable - open the app and Withdraw to collect them." } else { Send-Alert claimable "" }
      }
    } catch {}
  }
}
Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",(Join-Path $env:USERPROFILE ".lightnode\\keep-awake.ps1")) -ErrorAction SilentlyContinue
$ms = Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue
foreach ($m in $ms) { if ($m) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 5 -Body "{\`"model\`":\`"$m\`",\`"prompt\`":\`"ok\`",\`"keep_alive\`":-1,\`"stream\`":false}" *> $null } catch {} } }
'@ | Set-Content -Path $ko -Encoding ASCII
  schtasks /Create /TN "LightChainWorkerWatchdog" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$ko\`"" /SC MINUTE /MO 10 /F | Out-Null
  # Run the awake holder at every logon, and start it now so it guards immediately.
  schtasks /Create /TN "LightChainWorkerAwake" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$ka\`"" /SC ONLOGON /F | Out-Null
  Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$ka) -ErrorAction SilentlyContinue
  Write-Host "✓ keep-online watchdog active (Scheduled Task, every 10 min)"
  Write-Host "✓ sleep prevention active (machine stays awake while the worker runs)"
} catch { Write-Host "(keep-online watchdog skipped)" }
if (Test-Path lightchain-worker-toolkit) { Write-Host "✓ toolkit present - updating"; Push-Location lightchain-worker-toolkit; git pull --ff-only; Pop-Location } else { git clone ${TOOLKIT}.git }
Set-Location lightchain-worker-toolkit\\scripts\\powershell
if (-not (Test-Path secrets.ps1)) { Copy-Item secrets.example.ps1 secrets.ps1 }
# Worker key + password come from the app via process env. Prefer the address the
# app passed (a switch-back may run without the raw key); else derive it.
if (-not $env:WORKER_ADDR -and $env:WORKER_PRIVKEY) { $env:WORKER_ADDR = (cast wallet address --private-key $env:WORKER_PRIVKEY) }
if (-not $env:WORKER_ADDR) { Write-Host "⛔ no worker address or key available to install - generate/select a worker first."; exit 1 }
$env:NETWORK = "${network}"; $env:SUPPORTED_MODELS = "${supported}"
# Ensure each selected model is in Ollama under its exact on-chain name (phase 02
# only handles llama3-8b). Pull tag = name with the size turned back into a tag.
# Throttled progress: ollama's raw progress is thousands of escape-coded frames
# that flood the app's log channel; redirect the pull to a file and sample the
# percent so the app gets a handful of clean lines instead.
function Pull-Model($name, $tag) {
  Write-Host "▶ downloading $name - a multi-GB model can take several minutes"
  $plog = Join-Path $env:USERPROFILE ".lightnode\\.pull.out"
  $perr = Join-Path $env:USERPROFILE ".lightnode\\.pull.err"
  $proc = Start-Process ollama -ArgumentList @("pull", $tag) -NoNewWindow -PassThru -RedirectStandardOutput $plog -RedirectStandardError $perr
  $last = ""
  while (-not $proc.HasExited) {
    $txt = ((Get-Content $plog -ErrorAction SilentlyContinue) + (Get-Content $perr -ErrorAction SilentlyContinue)) -join "\`n"
    $mm = [regex]::Matches($txt, '(\\d{1,3})%')
    if ($mm.Count -gt 0) { $p = $mm[$mm.Count - 1].Value; if ($p -ne $last) { Write-Host "  downloading $name $p"; $last = $p } }
    Start-Sleep -Seconds 2
  }
  Remove-Item $plog, $perr -ErrorAction SilentlyContinue
  if ($proc.ExitCode -eq 0) { Write-Host "✓ downloaded $name" } else { Write-Host "⚠ $name download exited $($proc.ExitCode) (continuing)" }
}
foreach ($m in ${psList}) {
  $tag = ($m -replace '-([0-9.]+[bB])$', ':$1')
  if (ollama list 2>$null | Select-String -SimpleMatch $m -Quiet) { Write-Host "✓ model $m present" }
  else { Pull-Model $m $tag; if ($tag -ne $m) { ollama cp $tag $m *> $null } }
}
# Per-network keystore dir so installing one network never touches another's keys
# (a mainnet operator can set up testnet without risking their mainnet key). The
# legacy keys dir is still read by key derivation.
$env:KEYS_DIR = "$env:USERPROFILE\\lightchain-worker\\keys-${network}"
# env.ps1 hardcodes NETWORK/KEYS_DIR/SUPPORTED_MODELS and is re-sourced by every
# phase, which would clobber the values the app sets. Patch it to the same
# "keep if already set" convention the bash env.sh uses. Guarded so a re-run
# (where env.ps1 is already patched) doesn't wrap the assignment twice.
if ((Test-Path env.ps1) -and -not (Select-String -Path env.ps1 -SimpleMatch 'if (-not $env:KEYS_DIR)' -Quiet)) {
  $c = Get-Content env.ps1 -Raw
  $c = $c.Replace('$env:NETWORK = "mainnet"', 'if (-not $env:NETWORK) { $env:NETWORK = "mainnet" }')
  $c = $c.Replace('$env:KEYS_DIR = "$env:USERPROFILE\\lightchain-worker\\keys"', 'if (-not $env:KEYS_DIR) { $env:KEYS_DIR = "$env:USERPROFILE\\lightchain-worker\\keys" }')
  $c = $c.Replace('$env:SUPPORTED_MODELS = "llama3-8b"', 'if (-not $env:SUPPORTED_MODELS) { $env:SUPPORTED_MODELS = "llama3-8b" }')
  Set-Content -Path env.ps1 -Value $c
}
# Derive the REAL minimum stake LIVE from chain (never hardcode it): WorkerRegistry
# -> aiConfig() -> getMinWorkerStake(). Fall back to the build-time value only if
# the read fails so a transient RPC blip can't brick the install.
$MinFallbackWei = [System.Numerics.BigInteger]::Parse('${minStake}') * [System.Numerics.BigInteger]::Pow(10, 18)
try {
  $aicfg = (cast call "${workerRegistry}" "aiConfig()(address)" --rpc-url "${rpc}" 2>$null).Trim().Split(" ")[0]
  $minRaw = (cast call $aicfg "getMinWorkerStake()(uint256)" --rpc-url "${rpc}" 2>$null).Trim().Split(" ")[0]
  $MinStakeWei = [System.Numerics.BigInteger]::Parse($minRaw)
} catch { $MinStakeWei = $MinFallbackWei }
if ($MinStakeWei -le 0) { $MinStakeWei = $MinFallbackWei; Write-Host "could not read min stake from AIConfig; using fallback" }
$MinStakeLcai = [int]([System.Numerics.BigInteger]::Divide($MinStakeWei, [System.Numerics.BigInteger]::Pow(10, 18)))
$GuardLcai    = $MinStakeLcai + 1
$ThrWei       = $MinStakeWei + [System.Numerics.BigInteger]::Parse('500000000000000000')  # +0.5 LCAI gas cushion
Write-Host "min stake (live from AIConfig): $MinStakeLcai LCAI"
# The toolkit prints a hardcoded "STAKE 50,000 LCAI" line; say "the network
# minimum". Its pre-flight balance guard is hardcoded to the MAINNET stake
# (-lt 50001 / "less than 50,001 LCAI"), which wrongly fails a correctly funded
# testnet worker. Rewrite the threshold to the LIVE minimum + 1.
if (Test-Path 07-register.ps1) {
  $rc = Get-Content 07-register.ps1 -Raw
  $rc = $rc -replace 'STAKE 50,000 LCAI', 'STAKE the network minimum'
  $rc = $rc -replace '50,001', "$GuardLcai" -replace '50001', "$GuardLcai"
  Set-Content -Path 07-register.ps1 -Value $rc
  Write-Host "register pre-flight threshold set to the live minimum ($MinStakeLcai LCAI + gas)"
}
Write-Host "▶ funding worker: send to $env:WORKER_ADDR"

if ((docker ps --format "{{.Names}} {{.Status}}") -match "^lightchain-worker Up") {
  $runChain = ((docker inspect lightchain-worker --format "{{range .Config.Env}}{{println .}}{{end}}" 2>$null | Select-String '^CHAIN_ID=(.+)$' | Select-Object -First 1).Matches.Groups[1].Value)
  if ($runChain -and $runChain -ne "${chainId}") {
    Write-Host "> a worker for the other network (chain $runChain) is running; this machine runs one at a time. Stopping it to install ${network} (chain ${chainId}). Its stake + keys stay intact - reinstall that network to bring it back."
    docker stop lightchain-worker *> $null
  } else {
    Write-Host "✓ worker already running on ${network} - nothing to reinstall"; Write-Host "✅ worker online"; exit 0
  }
}
# Handle a pre-existing keystore: skip if it's already ours, else back up (never delete).
$ks = Join-Path $env:USERPROFILE "lightchain-worker\\keys-${network}\\eth-keystore"
$skipImport = $false
if ((Test-Path $ks) -and (Get-ChildItem $ks -ErrorAction SilentlyContinue)) {
  $waddr = ($env:WORKER_ADDR -replace '^0x','').ToLower()
  if (Get-ChildItem $ks | Where-Object { $_.Name.ToLower().Contains($waddr) }) { Write-Host "✓ worker key already imported - skipping import"; $skipImport = $true }
  else { Write-Host "▶ backing up a previous worker keystore (not deleting)"; Move-Item $ks "$ks.bak-$((Get-Date).Ticks)" -ErrorAction SilentlyContinue }
}
# Stale ECDH key (different worker / old password) → back up so phase 05 regenerates.
$keysDir = Join-Path $env:USERPROFILE "lightchain-worker\\keys-${network}"
$enc = Join-Path $keysDir "worker-encryption.key"
$sess = Join-Path $keysDir "session-keys.enc"
$marker = Join-Path $keysDir ".lightnode-worker"
$waddr = ($env:WORKER_ADDR -replace '^0x','').ToLower()
if ((Get-Content $marker -ErrorAction SilentlyContinue) -ne $waddr) { foreach ($f in @($enc, $sess)) { if (Test-Path $f) { Write-Host "▶ backing up old worker state: $(Split-Path $f -Leaf)"; Move-Item $f "$f.bak-$((Get-Date).Ticks)" -ErrorAction SilentlyContinue } } }
if ((Test-Path $sess) -and (Test-Path $enc) -and ((Get-Item $sess).LastWriteTime -lt (Get-Item $enc).LastWriteTime)) { Write-Host "▶ stale session store - backing it up"; Move-Item $sess "$sess.bak-$((Get-Date).Ticks)" -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $keysDir | Out-Null
Set-Content -Path $marker -Value $waddr
$env:FORCE = "1"
# Multi-password keystore resolve: when a previous attempt left a key on disk, the
# password the user types this session may not match the one used originally - the
# toolkit would then sign with the wrong key and register would silently fail. Try
# each saved slot the app passed; lock onto the one that decrypts. Mirrors the
# settle/deregister/withdraw multi-slot fix.
function Resolve-WorkerPassword {
  # Trying a wrong password makes cast print "Error: Mac Mismatch" to stderr, which
  # under the install's ErrorActionPreference=Stop PowerShell promotes to a
  # terminating NativeCommandError - killing the install on an EXPECTED wrong-guess
  # (the exact failure that stranded the Windows tester). Tolerate native stderr
  # here (function-scoped, like the preflight already does) and judge by exit code.
  $ErrorActionPreference = 'Continue'
  $ksFile = Get-ChildItem $ks -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $ksFile) { return $true }
  foreach ($pw in @($env:WORKER_PASSWORD, $env:WORKER_PASSWORD_ALT1, $env:WORKER_PASSWORD_ALT2, $env:WORKER_PASSWORD_ALT3)) {
    if (-not $pw) { continue }
    & cast wallet decrypt-keystore $ksFile.Name --keystore-dir $ks --unsafe-password $pw *> $null
    if ($LASTEXITCODE -eq 0) { $env:WORKER_PASSWORD = $pw; Write-Host "✓ existing worker keystore unlocked"; return $true }
  }
  return $false
}
# Funding gate: phase 07 stakes the live minimum from the worker wallet and pays
# gas in LCAI. Threshold is $ThrWei (live min stake + 0.5 gas), derived above from
# AIConfig. Wait briefly so a just-funded retry proceeds; fail clearly only when
# the wallet is genuinely empty after the wait.
function Wait-Funding {
  $thr = $ThrWei
  $lcai = 0
  for ($w = 1; $w -le 18; $w++) {
    try {
      $body = '{"jsonrpc":"2.0","method":"eth_getBalance","params":["' + $env:WORKER_ADDR + '","latest"],"id":1}'
      $resp = Invoke-RestMethod -Uri '${rpc}' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5
      $hex = ($resp.result -replace '^0x','')
      if ($hex.Length -gt 0 -and -not $hex.StartsWith('0')) { $hex = '0' + $hex }
      $balWei = if ($hex) { [System.Numerics.BigInteger]::Parse($hex, [System.Globalization.NumberStyles]::HexNumber) } else { [System.Numerics.BigInteger]::Zero }
    } catch { $balWei = [System.Numerics.BigInteger]::Zero }
    $lcai = [Math]::Round([double]([System.Numerics.BigInteger]::Divide($balWei, [System.Numerics.BigInteger]::Pow(10, 15))) / 1000, 3)
    if ($balWei -ge $thr) { Write-Host "✓ worker wallet funded ($lcai LCAI)"; return $true }
    if ($w -eq 1 -or ($w % 6) -eq 0) { Write-Host "▶ waiting for funding: worker wallet at $($env:WORKER_ADDR) has $lcai LCAI, needs at least $MinStakeLcai.5 LCAI (stake + a small gas cushion)" }
    Start-Sleep -Seconds 5
  }
  Write-Host "⛔ funding-gate timeout: worker wallet at $($env:WORKER_ADDR) still has only $lcai LCAI. Send at least $MinStakeLcai.5 LCAI to that address (see ${explorer}/address/$($env:WORKER_ADDR)) and run install again - your existing setup is reused."
  return $false
}
if ($skipImport) {
  if (-not (Resolve-WorkerPassword)) {
    # The on-disk keystore was encrypted with a password none of the saved slots
    # match. If the app still holds this worker's raw key, we don't need the old
    # password - back up the stale keystore + its password-encrypted ECDH/session
    # state and re-import under the current password (phase 04 + 05 regenerate
    # cleanly). The keystore is just a container for the key; on-chain identity is
    # the ADDRESS, so nothing on-chain changes and no stake is touched.
    if ($env:WORKER_PRIVKEY) {
      Write-Host "▶ the on-disk keystore uses a password the app no longer has - re-importing this worker's key under the current password (on-chain identity is unchanged; no stake is touched)"
      Move-Item $ks "$ks.bak-$((Get-Date).Ticks)" -ErrorAction SilentlyContinue
      foreach ($f in @($enc, $sess)) { if (Test-Path $f) { Move-Item $f "$f.bak-$((Get-Date).Ticks)" -ErrorAction SilentlyContinue } }
      $skipImport = $false
    } else {
      Write-Host "⛔ keystore-password-mismatch: an existing worker key for $($env:WORKER_ADDR) is on this device, but the password set this session does not decrypt it. Re-enter the original password you set when this worker was first created, or open Recover a replaced key on the dashboard to switch to a different worker."
      exit 1
    }
  }
}
# Selected model's on-chain id, for the registered-AND-serving check below.
$ModelId = (cast keccak "$(("${supported}" -split ',')[0])" 2>$null)
# Gas-correct on-chain add of the selected model, to FINISH a worker that staked
# but whose model-add failed inside the daemon's one-shot register (the daemon
# under-sets the gas limit -> OutOfGas). gas = estimate x1.5. No-op if eligible.
function Add-SelectedModelOnchain {
  if (-not $ModelId) { return $true }
  $elig = (cast call "${workerRegistry}" "isEligible(address,bytes32)(bool)" $env:WORKER_ADDR $ModelId --rpc-url "${rpc}" 2>$null)
  if ($elig -match 'true') { return $true }
  $est = (cast estimate --from $env:WORKER_ADDR "${workerRegistry}" "addSupportedModel(bytes32)" $ModelId --rpc-url "${rpc}" 2>$null)
  $gas = if ($est -match '^[0-9]+$') { [int]([long]$est * 3 / 2) } else { 300000 }
  Write-Host "▶ adding the selected model on-chain with proper gas (gas-limit $gas) - the daemon under-gasses this step"
  cast send "${workerRegistry}" "addSupportedModel(bytes32)" $ModelId --private-key $env:WORKER_PRIVKEY --rpc-url "${rpc}" --gas-limit $gas *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "model added on-chain (worker now serving it)"; return $true } else { Write-Host "model add failed even with estimated gas"; return $false }
}
foreach ($p in @('${phases}')) { if (($p -like '*04-import-key*') -and $skipImport) { Write-Host "▶ phase 04-import-key (skipped - key present)"; continue }; if ($p -like '*07-register*') { $regOk = (cast call "${workerRegistry}" "isWorkerRegistered(address)(bool)" $env:WORKER_ADDR --rpc-url "${rpc}" 2>$null); $eligOk = if ($ModelId) { (cast call "${workerRegistry}" "isEligible(address,bytes32)(bool)" $env:WORKER_ADDR $ModelId --rpc-url "${rpc}" 2>$null) } else { "" }; if (($regOk -match 'true') -and ($eligOk -match 'true')) { Write-Host "▶ phase 07-register (skipped - already registered AND serving the selected model on-chain)"; continue }; if (($regOk -match 'true') -and ($eligOk -notmatch 'true')) { Write-Host "▶ phase 07-register (already staked from a prior attempt; finishing the model-add the daemon failed - no re-stake)"; if (-not (Add-SelectedModelOnchain)) { exit 1 }; continue }; if (-not (Wait-Funding)) { exit 1 } }; Write-Host "▶ phase $p"; $global:LASTEXITCODE = 0; $eapPrev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { if ($p -like '*07-register*') { & $p -Force 2>&1 | ForEach-Object { Write-Host $_ }; $nowReg = (cast call "${workerRegistry}" "isWorkerRegistered(address)(bool)" $env:WORKER_ADDR --rpc-url "${rpc}" 2>$null); if ($nowReg -notmatch 'true') { throw "worker not registered on-chain after the attempt" }; if (-not (Add-SelectedModelOnchain)) { throw "model add failed" } } else { & $p 2>&1 | ForEach-Object { Write-Host $_ }; if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" } } } catch { Write-Host "⛔ stopped at $p - $($_.Exception.Message)"; exit 1 } finally { $ErrorActionPreference = $eapPrev } }
# Pre-warm each served model and pin it so the first job doesn't pay a cold load.
Write-Host "▶ pre-warming ${supported} (kept resident to avoid cold-load timeouts)"
foreach ($m in ${psList}) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 120 -Body "{\`"model\`":\`"$m\`",\`"prompt\`":\`"ok\`",\`"keep_alive\`":-1,\`"stream\`":false}" *> $null } catch {} }
Write-Host "✅ worker online"`;
}

/**
 * Smart, idempotent install command for the desktop shell, per OS. Installs only
 * missing prerequisites (auto-starting Docker), skips the model pull if present,
 * and short-circuits if the worker is already running. Reads WORKER_PASSWORD and
 * WORKER_PRIVKEY from the process env (passed securely by the app, never here);
 * the worker is funded directly from the user's wallet, so there's no funder key.
 */
export function desktopInstallCommand(os: OS, network: NetworkId, models: string[] = [DEFAULT_MODEL]): string {
  const list = models.length ? models : [DEFAULT_MODEL];
  return os === "windows" ? windowsInstall(network, list) : unixInstall(network, list);
}

/** Run a toolkit script natively from the app: find the toolkit (the install
 *  clones it to ~/.lightnode), use bash 4+ (macOS ships 3.2), surface stderr. */
/**
 * Source WORKER_PRIVKEY + WORKER_ADDR from the on-disk keystore (where the
 * worker actually keeps its key, encrypted) using WORKER_PASSWORD - independent
 * of whatever the web app does or doesn't still hold. This is both the most
 * robust and the most private path: the app needs only the password; the raw
 * key is decrypted locally, on demand, from the keystore. (No-op if they're
 * already set in the env.)
 */
function keystoreDeriveUnix(): string[] {
  return [
    'export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
    // Find the keystore for the target worker. Installs now write per-network
    // dirs (keys-<network>); the legacy shared dir (keys) is still scanned so a
    // worker created before isolation stays recoverable (e.g. to deregister it).
    // When a WORKER_ADDR is targeted, pick the dir whose keystore filename matches
    // it - never sign one network's op with another worker's key.
    "WADDR_LC=\"$(printf '%s' \"${WORKER_ADDR:-}\" | sed 's/^0x//' | tr 'A-Z' 'a-z')\"",
    'CAND=""',
    '[ -n "${KEYS_DIR:-}" ] && CAND="$KEYS_DIR"',
    '[ -n "${NETWORK:-}" ] && CAND="$CAND $HOME/lightchain-worker/keys-$NETWORK"',
    'CAND="$CAND $HOME/lightchain-worker/keys-mainnet $HOME/lightchain-worker/keys-testnet $HOME/lightchain-worker/keys"',
    'KS_DIR=""; KS_NAME=""',
    'for d in $CAND; do',
    "  n=\"$(ls \"$d/eth-keystore\" 2>/dev/null | grep -iE '^UTC--' | head -1)\"",
    '  [ -z "$n" ] && continue',
    '  if [ -n "$WADDR_LC" ] && ! printf %s "$n" | tr A-Z a-z | grep -q "$WADDR_LC"; then continue; fi',
    '  KS_DIR="$d/eth-keystore"; KS_NAME="$n"; break',
    "done",
    // Point the toolkit (invoke_worker: deregister/sweep/add-models) at the SAME
    // per-network keystore dir we matched, so it never falls back to the legacy
    // `keys/` dir and signs with the wrong worker (e.g. deregistering a testnet
    // worker would otherwise mount the mainnet keystore and fail to decrypt).
    'if [ -n "$KS_DIR" ]; then export KEYS_DIR="$(dirname "$KS_DIR")"; fi',
    // Lock onto the password that actually decrypts the on-disk keystore. The
    // worker binary (deregister/sweep/add-models) always unlocks the keystore FILE
    // with this password, so it MUST be the right one even when the app already
    // handed us a private key - hence this runs whenever a keystore is found, not
    // only when the key is missing. A worker made before per-network keying stored
    // its password under the bare name, so the app passes several candidates.
    'if [ -n "$KS_NAME" ]; then',
    // Make sure Docker is reachable so we can read the container\'s keystore
    // password (one more candidate - only correct when the container hosts THIS
    // worker). Soft - never fatal.
    '  if ! docker info >/dev/null 2>&1; then for s in "$HOME/.docker/run/docker.sock" "/var/run/docker.sock" "$HOME/.colima/default/docker.sock" "$HOME/.rd/docker.sock"; do [ -S "$s" ] && DOCKER_HOST="unix://$s" docker info >/dev/null 2>&1 && { export DOCKER_HOST="unix://$s"; break; }; done; fi',
    '  if ! docker info >/dev/null 2>&1; then open -a Docker >/dev/null 2>&1 || true; for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done; fi',
    "  PW_CT=\"$(docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^WORKER_KEYSTORE_PASSWORD=' | head -1 | cut -d= -f2-)\"",
    // Try the container password (matches only when it hosts this worker), then the
    // app-supplied candidates (per-network, bare-legacy, other-network). Keep the
    // first that decrypts; derive the key from it only if we don't already have one.
    '  KS_PW=""',
    '  for PW in "$PW_CT" "${WORKER_PASSWORD:-}" "${WORKER_PASSWORD_ALT1:-}" "${WORKER_PASSWORD_ALT2:-}" "${WORKER_PASSWORD_ALT3:-}"; do',
    '    [ -z "$PW" ] && continue',
    "    K=\"$(cast wallet decrypt-keystore \"$KS_NAME\" --keystore-dir \"$KS_DIR\" --unsafe-password \"$PW\" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{64}' | head -1)\"",
    '    if [ -n "$K" ]; then KS_PW="$PW"; [ -z "${WORKER_PRIVKEY:-}" ] && export WORKER_PRIVKEY="$K"; break; fi',
    "  done",
    '  if [ -n "$KS_PW" ]; then export WORKER_PASSWORD="$KS_PW"; else echo "⚠ could not unlock the on-disk keystore for this worker with any saved password. If you set a custom keystore password at install, deregister/withdraw need that exact password."; fi',
    "fi",
    // The worker actually present on this machine (from the derived key, else
    // the keystore filename).
    "DISK_ADDR=\"\"; if [ -n \"${WORKER_PRIVKEY:-}\" ]; then DISK_ADDR=\"$(cast wallet address --private-key \"$WORKER_PRIVKEY\" 2>/dev/null)\"; elif [ -n \"$KS_NAME\" ]; then DISK_ADDR=\"0x$(printf '%s' \"$KS_NAME\" | sed -E 's/.*--([0-9a-fA-F]{40})$/\\1/')\"; fi",
    // If a specific worker was targeted, the on-disk worker MUST be it - never
    // sign one network\'s op with a different worker\'s key.
    'if [ -n "${WORKER_ADDR:-}" ] && [ -n "$DISK_ADDR" ] && [ "$(printf %s "$WORKER_ADDR" | tr A-Z a-z)" != "$(printf %s "$DISK_ADDR" | tr A-Z a-z)" ]; then echo "⛔ this machine hosts worker $DISK_ADDR, not the ${NETWORK:-target} worker $WORKER_ADDR. Switch the network toggle to the worker installed here, or run this where $WORKER_ADDR lives."; unset WORKER_PRIVKEY; fi',
    // Default the target to the on-disk worker when none was supplied.
    'if [ -z "${WORKER_ADDR:-}" ] && [ -n "$DISK_ADDR" ]; then export WORKER_ADDR="$DISK_ADDR"; fi',
  ];
}

export function toolkitOpCommand(script: string, confirm?: string): string {
  const run = confirm ? `echo ${confirm} | FORCE=1 "$RB" ${script}` : `FORCE=1 "$RB" ${script}`;
  return [
    "exec 2>&1",
    'export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    'TK="$HOME/.lightnode/lightchain-worker-toolkit/scripts/bash"; [ -d "$TK" ] || TK="$HOME/lightchain-worker-toolkit/scripts/bash"',
    'cd "$TK" 2>/dev/null || { echo "⛔ toolkit not found - install the worker first."; exit 1; }',
    'if bash -c "declare -A _t" 2>/dev/null; then RB=bash; else RB="$(brew --prefix 2>/dev/null)/bin/bash"; fi',
    // The toolkit scripts use `set -u` and need WORKER_PRIVKEY/WORKER_ADDR;
    // source them from the on-disk keystore + password so they're always present.
    ...keystoreDeriveUnix(),
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
      'Write-Host "worker paused - the watchdog will leave it stopped until you Restart"',
      "docker stop lightchain-worker 2>$null",
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'mkdir -p "$HOME/.lightnode" && touch "$HOME/.lightnode/keep-online.paused"',
    'echo "✓ worker paused - the keep-online watchdog will leave it stopped until you Restart"',
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"',
    '(docker stop lightchain-worker >/dev/null 2>&1 && echo "✓ worker stopped") || echo "(worker was not running)"',
    // Stop holding the machine awake - it can sleep again now the worker is down.
    AWAKE_OFF_UNIX,
  ].join("\n");
}

/** A representative judging prompt (no double quotes, so it embeds cleanly in
 *  the JSON body on both shells). Long enough to exercise prompt prefill the way
 *  a real challenge-evaluation job does, not just token decode. */
const BENCH_PROMPT =
  "You are verifying a fitness challenge submission. The athlete claims a 10km run in 48 minutes. Their GPS trace records 9.91km over 47m52s with a 12 second pause near kilometre six. Decide whether the claim is valid, explain your reasoning step by step, then output a JSON verdict with the fields valid, confidence and reason.";

/**
 * Real capacity test: run an ACTUAL inference through the local Ollama and
 * measure the three things that decide whether a job beats the deadline -
 * cold model-load time, prompt-prefill speed, and token-decode speed. It first
 * forces a cold start (unload the model) so the load figure is the true worst
 * case (a job arriving on an idle worker), then projects a worst-case job
 * (cold load + a 2048-token prompt + a 1024-token answer) against the real
 * on-chain deadline (`budgetSec`, read live from a recent job; defaults 120s).
 * Verdict: comfortable (< 70% of budget), tight (< budget), or over budget.
 */
export function benchmarkCommand(os: OS, budgetSec: number = 120): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      '$model = (Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue | Select-Object -First 1); if (-not $model) { $model = "llama3-8b" }',
      `$budget = ${budgetSec}`,
      'Write-Host "> benchmarking $model (real inference vs the ${budget}s job deadline)..."',
      'try { $null = Invoke-RestMethod -Uri http://127.0.0.1:11434/api/tags -TimeoutSec 5 } catch { Write-Host "Ollama not responding - install/start it first"; exit 1 }',
      'Write-Host "  forcing a cold start (worst case: a job hitting an idle worker)..."',
      'try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 30 -Body "{`"model`":`"$model`",`"keep_alive`":0}" | Out-Null } catch {}',
      'Start-Sleep -Seconds 1',
      'Write-Host "  running a representative judging prompt..."',
      `$prompt = "${BENCH_PROMPT}"`,
      '$body = "{`"model`":`"$model`",`"prompt`":`"$prompt`",`"stream`":false,`"keep_alive`":-1,`"options`":{`"num_predict`":256}}"',
      '$r = Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec ($budget+60) -Body $body',
      'if (-not $r.eval_count) { Write-Host "no usable response - the model may be too slow or out of memory"; exit 1 }',
      '$dec = $r.eval_count / ($r.eval_duration/1e9)',
      '$pre = if ($r.prompt_eval_count -and $r.prompt_eval_duration) { $r.prompt_eval_count / ($r.prompt_eval_duration/1e9) } else { $dec }',
      '$load = $r.load_duration/1e9',
      '$worst = $load + 2048/$pre + 1024/$dec',
      'Write-Host ("OK decode: {0:N1} tok/s | prefill: {1:N0} tok/s | cold load: {2:N1}s" -f $dec, $pre, $load)',
      'Write-Host ("  worst-case job (cold load + 2048-token prompt + 1024-token answer): ~{0:N0}s (deadline {1}s)" -f $worst, $budget)',
      'if ($worst -lt $budget*0.7) { Write-Host "OK - comfortably within the ${budget}s deadline (low slash risk)" } elseif ($worst -lt $budget) { Write-Host "WARNING - within the deadline but tight; a heavier prompt could time out. A faster GPU would help." } else { Write-Host "RISK - over the ${budget}s deadline; high risk of timed-out jobs (slash). Use a faster GPU or a lighter model." }',
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    'MODEL="$(head -1 "$HOME/.lightnode/model" 2>/dev/null || echo llama3-8b)"',
    `BUDGET=${budgetSec}`,
    'echo "▶ benchmarking $MODEL (real inference vs the ${BUDGET}s job deadline)..."',
    'curl -s -m 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || { echo "⛔ Ollama not responding - install/start it first"; exit 1; }',
    'echo "  forcing a cold start (worst case: a job hitting an idle worker)..."',
    `curl -s -m 30 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$MODEL\\",\\"keep_alive\\":0}" >/dev/null 2>&1`,
    "sleep 1",
    'echo "  running a representative judging prompt..."',
    `RESP="$(curl -s -m $((BUDGET+60)) http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$MODEL\\",\\"prompt\\":\\"${BENCH_PROMPT}\\",\\"stream\\":false,\\"keep_alive\\":-1,\\"options\\":{\\"num_predict\\":256}}")"`,
    `EC="$(printf '%s' "$RESP" | grep -oE '"eval_count":[0-9]+' | grep -oE '[0-9]+' | head -1)"`,
    `ED="$(printf '%s' "$RESP" | grep -oE '"eval_duration":[0-9]+' | grep -oE '[0-9]+' | head -1)"`,
    `PC="$(printf '%s' "$RESP" | grep -oE '"prompt_eval_count":[0-9]+' | grep -oE '[0-9]+' | head -1)"`,
    `PD="$(printf '%s' "$RESP" | grep -oE '"prompt_eval_duration":[0-9]+' | grep -oE '[0-9]+' | head -1)"`,
    `LD="$(printf '%s' "$RESP" | grep -oE '"load_duration":[0-9]+' | grep -oE '[0-9]+' | head -1)"`,
    '{ [ -z "$EC" ] || [ -z "$ED" ]; } && { echo "⛔ no usable response - the model may be too slow or out of memory on this machine"; exit 1; }',
    'TOKS="$(awk "BEGIN{printf \\"%.1f\\", $EC/($ED/1000000000)}")"',
    'PREFILL="$(awk "BEGIN{p=${PC:-0}; d=${PD:-0}; if(p>0&&d>0) printf \\"%.0f\\", p/(d/1000000000); else printf \\"%.0f\\", $EC/($ED/1000000000)}")"',
    'LOADS="$(awk "BEGIN{printf \\"%.1f\\", ${LD:-0}/1000000000}")"',
    'WORST="$(awk "BEGIN{load=${LD:-0}/1000000000; dec=$EC/($ED/1000000000); p=${PC:-0}; d=${PD:-0}; pre=(p>0&&d>0)?p/(d/1000000000):dec; printf \\"%.0f\\", load + 2048/pre + 1024/dec}")"',
    'echo "✓ decode: $TOKS tok/s, prefill: $PREFILL tok/s, cold load: ${LOADS}s"',
    'echo "  worst-case job (cold load + 2048-token prompt + 1024-token answer): ~${WORST}s  (deadline ${BUDGET}s)"',
    'if awk "BEGIN{exit !($WORST < $BUDGET*0.7)}"; then echo "✅ comfortably within the ${BUDGET}s deadline - low slash risk"; elif awk "BEGIN{exit !($WORST < $BUDGET)}"; then echo "⚠ within the deadline but tight - a heavier prompt could time out. A faster GPU would help."; else echo "⛔ over the ${BUDGET}s deadline - high risk of timed-out jobs (slash). Use a faster GPU or a lighter model."; fi',
  ].join("\n");
}

/** Windows equivalent of keystoreDeriveUnix: source WORKER_PRIVKEY + WORKER_ADDR
 *  from the on-disk keystore using WORKER_PASSWORD (cast), so the ops work
 *  without the raw key ever living in the web layer. */
function keystoreDeriveWin(): string[] {
  return [
    '$env:PATH = "$env:USERPROFILE\\.foundry\\bin;$env:PATH"',
    // Scan per-network keystore dirs (installs now write keys-<network>) plus the
    // legacy shared dir so a pre-isolation worker stays recoverable. When a
    // WORKER_ADDR is targeted, pick the dir whose keystore filename matches it.
    '$waddrLc = if ($env:WORKER_ADDR) { ($env:WORKER_ADDR -replace "^0x","").ToLower() } else { "" }',
    '$cands = @()',
    'if ($env:KEYS_DIR) { $cands += $env:KEYS_DIR }',
    'if ($env:NETWORK) { $cands += (Join-Path $env:USERPROFILE "lightchain-worker\\keys-$($env:NETWORK)") }',
    '$cands += (Join-Path $env:USERPROFILE "lightchain-worker\\keys-mainnet")',
    '$cands += (Join-Path $env:USERPROFILE "lightchain-worker\\keys-testnet")',
    '$cands += (Join-Path $env:USERPROFILE "lightchain-worker\\keys")',
    '$ksDir = $null; $ks = $null',
    'foreach ($d in $cands) {',
    '  $kd = Join-Path $d "eth-keystore"',
    "  $cand = Get-ChildItem $kd -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'UTC--*' } | Select-Object -First 1",
    '  if (-not $cand) { continue }',
    '  if ($waddrLc -and -not $cand.Name.ToLower().Contains($waddrLc)) { continue }',
    '  $ksDir = $kd; $ks = $cand; break',
    '}',
    // Point the toolkit (Invoke-Worker) at the same per-network keystore dir.
    'if ($ksDir) { $env:KEYS_DIR = (Split-Path $ksDir -Parent) }',
    // Lock onto the password that actually decrypts the on-disk keystore (the worker
    // binary always unlocks the keystore FILE with it), so this runs whenever a
    // keystore is found, not only when the key is missing. Candidates: the container
    // password, then the app-supplied per-network / bare-legacy / other-network ones.
    'if ($ks) {',
    "  $pwCt = (docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>$null | Select-String '^WORKER_KEYSTORE_PASSWORD=(.+)$' | Select-Object -First 1).Matches.Groups[1].Value",
    '  $ksPw = $null',
    '  foreach ($pw in @($pwCt, $env:WORKER_PASSWORD, $env:WORKER_PASSWORD_ALT1, $env:WORKER_PASSWORD_ALT2, $env:WORKER_PASSWORD_ALT3)) {',
    '    if (-not $pw) { continue }',
    "    $pk = ((cast wallet decrypt-keystore $ks.Name --keystore-dir $ksDir --unsafe-password $pw 2>$null) | Select-String -Pattern '0x[0-9a-fA-F]{64}' | Select-Object -First 1).Matches.Value",
    '    if ($pk) { $ksPw = $pw; if (-not $env:WORKER_PRIVKEY) { $env:WORKER_PRIVKEY = $pk }; break }',
    '  }',
    '  if ($ksPw) { $env:WORKER_PASSWORD = $ksPw } else { Write-Host "could not unlock the on-disk keystore for this worker with any saved password. If you set a custom keystore password at install, deregister/withdraw need that exact password." }',
    '}',
    '$diskAddr = ""',
    'if ($env:WORKER_PRIVKEY) { $diskAddr = (cast wallet address --private-key $env:WORKER_PRIVKEY 2>$null) } elseif ($ks -and ($ks.Name -match \'([0-9a-fA-F]{40})$\')) { $diskAddr = "0x$($Matches[1])" }',
    // Never sign one worker\'s op with another\'s key.
    'if ($env:WORKER_ADDR -and $diskAddr -and ($env:WORKER_ADDR.ToLower() -ne $diskAddr.ToLower())) { Write-Host "this machine hosts worker $diskAddr, not the target worker $($env:WORKER_ADDR). Switch the network toggle to the worker installed here."; $env:WORKER_PRIVKEY = $null }',
    'if (-not $env:WORKER_ADDR -and $diskAddr) { $env:WORKER_ADDR = $diskAddr }',
  ];
}

/**
 * Sweep the worker wallet's balance to `dest` (this is also how you withdraw -
 * it sends the spendable balance to the address you choose). OS-aware: bash on
 * macOS/Linux, PowerShell on Windows. The key is sourced from the keystore.
 */
// Gas buffer left behind on a full sweep. The toolkit defaults to 1 LCAI, which
// is huge next to LightChain's few-wei fee - leave just a tiny safety margin so
// almost everything is swept (the in-app viem path reserves the exact gas cost).
const SWEEP_GAS_BUFFER_LCAI = "0.001";

export function sweepCommand(os: OS, dest: string): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'Set-Location "$env:USERPROFILE\\.lightnode\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null',
      ...keystoreDeriveWin(),
      `$env:FORCE = "1"`,
      `if (Test-Path .\\sweep-rewards.ps1) { .\\sweep-rewards.ps1 -To "${dest}" -GasBuffer ${SWEEP_GAS_BUFFER_LCAI} } else { Write-Host "toolkit not found - install the worker first" }`,
    ].join("\n");
  }
  return toolkitOpCommand(`sweep-rewards.sh ${dest} ${SWEEP_GAS_BUFFER_LCAI}`, "sweep");
}

/**
 * Release (settle) completed jobs on-chain. A finished job sits in a release/
 * dispute window before it settles; once the window passes, `releaseJob` pays
 * the worker its share AND clears the job from the deregister gate. It's
 * permissionless after the window, so we attempt each and skip ones still
 * waiting. Sourcing the key from the keystore keeps it private.
 */
function releaseJobsUnix(network: NetworkId, jobIds: number[]): string[] {
  const net = NETWORKS[network];
  if (!jobIds.length) return ['echo "no completed jobs to settle"'];
  return [
    `RPC_URL="${net.rpc}"; JOBREG="${net.jobRegistry}"; SETTLED=0; WAITING=0; FAILED=0`,
    `for j in ${jobIds.join(" ")}; do`,
    // Readiness probe FIRST (eth_call, no state change) - the same signal the
    // dashboard uses. If it reverts, the job is genuinely still in its window.
    '  if ! cast call "$JOBREG" "releaseJob(uint256)" "$j" --rpc-url "$RPC_URL" >/dev/null 2>&1; then echo "  • job $j still in its release window (try again later)"; WAITING=$((WAITING+1)); continue; fi',
    // Ready - now send for real. Distinguish a real send failure (e.g. the
    // signing wallet has no gas) from a window-wait, so we never mislabel it.
    '  if [ -z "${WORKER_PRIVKEY:-}" ]; then echo "  ⛔ job $j is ready but there is no worker key to sign with"; FAILED=$((FAILED+1)); continue; fi',
    '  ERR="$(cast send "$JOBREG" "releaseJob(uint256)" "$j" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" 2>&1 >/dev/null)"',
    '  if [ $? -eq 0 ]; then echo "  ✓ settled job $j"; SETTLED=$((SETTLED+1)); else echo "  ⛔ job $j is ready but the release tx failed: $(printf %s "$ERR" | tr "\\n" " " | cut -c1-140)"; FAILED=$((FAILED+1)); fi',
    "done",
    'echo "✓ settled $SETTLED job(s)$( [ $WAITING -gt 0 ] && printf \', %s still in their release window\' "$WAITING" )$( [ $FAILED -gt 0 ] && printf \', %s ready but the send failed (see above)\' "$FAILED" )"',
  ];
}

function releaseJobsWin(network: NetworkId, jobIds: number[]): string[] {
  const net = NETWORKS[network];
  if (!jobIds.length) return ['Write-Host "no completed jobs to settle"'];
  // Judge cast by its EXIT CODE ($LASTEXITCODE), never by $?. On Windows
  // PowerShell 5.1, $? for a native command is driven by whether it wrote to
  // stderr, NOT by its exit code - and cast writes routinely to stderr. With the
  // `2>&1` capture below, a REVERTED release (non-zero exit, no real stderr) left
  // $? = $true, so the script printed "settled job X" while the tx had actually
  // failed for no gas and the job stayed Completed on-chain. $LASTEXITCODE is the
  // real exit code and is unaffected by stderr.
  return [
    `$RPC_URL = "${net.rpc}"; $JOBREG = "${net.jobRegistry}"`,
    `foreach ($j in @(${jobIds.join(",")})) {`,
    '  cast call $JOBREG "releaseJob(uint256)" $j --rpc-url $RPC_URL *> $null',
    '  if ($LASTEXITCODE -ne 0) { Write-Host "job $j still in its release window (try again later)"; continue }',
    '  if (-not $env:WORKER_PRIVKEY) { Write-Host "job $j is ready but there is no worker key to sign with"; continue }',
    '  $e = (cast send $JOBREG "releaseJob(uint256)" $j --private-key $env:WORKER_PRIVKEY --rpc-url $RPC_URL 2>&1)',
    // if/elseif/else MUST stay on one line - PowerShell rejects a newline before else/elseif.
    `  if ($LASTEXITCODE -eq 0) { Write-Host "settled job $j" } elseif ("$e" -match "insufficient funds|gas required") { Write-Host "job $j NOT settled: your worker wallet ($env:WORKER_ADDR) has no LCAI to pay gas. Send a little LCAI to it (see ${net.explorer}/address/$env:WORKER_ADDR), then settle again." } else { Write-Host "job $j is ready but the release tx failed: $e" }`,
    "}",
  ];
}

// Released jobs credit the worker's pay into an INTERNAL JobRegistry balance,
// not the worker wallet. `withdraw()` (selector 0x3ccfd60b) pulls that balance
// to the wallet; the claimable amount is read via getter 0x78904a35(address).
// So settling must release AND claim, or the rewards sit stranded in-contract.
function claimEarningsUnix(network: NetworkId): string[] {
  const net = NETWORKS[network];
  return [
    `JOBREG="${net.jobRegistry}"; RPC_URL="${net.rpc}"`,
    'if [ -n "${WORKER_ADDR:-}" ]; then EARNED="$(cast call "$JOBREG" "0x78904a35000000000000000000000000$(printf %s "${WORKER_ADDR#0x}" | tr A-Z a-z)" --rpc-url "$RPC_URL" 2>/dev/null)"; else EARNED=""; fi',
    'EARNED_DEC="$(cast to-dec "${EARNED:-0x0}" 2>/dev/null || echo 0)"',
    'if [ -n "$EARNED_DEC" ] && [ "$EARNED_DEC" != "0" ]; then',
    '  if [ -z "${WORKER_PRIVKEY:-}" ]; then echo "  ⛔ $(cast from-wei "$EARNED_DEC") LCAI of earnings are claimable but there is no worker key to sign with"; ',
    '  elif CLAIM_ERR="$(cast send "$JOBREG" "withdraw()" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" 2>&1 >/dev/null)"; then echo "  ✓ claimed $(cast from-wei "$EARNED_DEC") LCAI of earnings into your worker wallet"; ',
    // The most common claim failure is an empty gas tank in the worker wallet
    // (every settle/claim/deregister tx is paid from it). Say that plainly with
    // the address to fund, instead of an unhelpful "try again".
    `  elif printf %s "$CLAIM_ERR" | grep -qiE "insufficient funds|gas required"; then echo "  ⛔ $(cast from-wei "$EARNED_DEC") LCAI is claimable, but your worker wallet ($WORKER_ADDR) has no LCAI to pay the claim gas. Send a little LCAI to it (see ${net.explorer}/address/$WORKER_ADDR), then settle again."; `,
    '  else echo "  ⛔ earnings claim tx failed: $(printf %s "$CLAIM_ERR" | tr "\\n" " " | cut -c1-140)"; fi',
    'else echo "  • no unclaimed earnings sitting in the job registry"; fi',
  ];
}

function claimEarningsWin(network: NetworkId): string[] {
  const net = NETWORKS[network];
  return [
    `$JOBREG = "${net.jobRegistry}"; $RPC_URL = "${net.rpc}"`,
    'if ($env:WORKER_ADDR) {',
    '  $earned = (cast call $JOBREG ("0x78904a35000000000000000000000000" + $env:WORKER_ADDR.Substring(2).ToLower()) --rpc-url $RPC_URL 2>$null)',
    '  $earnedDec = (cast to-dec $earned 2>$null)',
    // Judge by $LASTEXITCODE, not $?/`-or $?`: on PowerShell 5.1 the old
    // `(cast send *> $null) -or $?` could not tell a real revert from cast's
    // stderr, so a failed withdraw read as "claimed" or an opaque "try again".
    // Capture the error and, on the common case (no gas), say exactly what to do.
    // The whole if/elseif/else stays on one line - PowerShell rejects a newline
    // before else/elseif.
    '  if (-not ($earnedDec -and $earnedDec -ne "0")) { Write-Host "no unclaimed earnings sitting in the job registry" } elseif (-not $env:WORKER_PRIVKEY) { Write-Host "earnings claimable but no worker key to sign with" } else {',
    '    $e = (cast send $JOBREG "withdraw()" --private-key $env:WORKER_PRIVKEY --rpc-url $RPC_URL 2>&1)',
    `    if ($LASTEXITCODE -eq 0) { Write-Host "claimed $(cast from-wei $earnedDec) LCAI of earnings into your worker wallet" } elseif ("$e" -match "insufficient funds|gas required") { Write-Host "$(cast from-wei $earnedDec) LCAI is claimable, but your worker wallet ($env:WORKER_ADDR) has no LCAI to pay the claim gas. Send a little LCAI to it (see ${net.explorer}/address/$env:WORKER_ADDR), then settle again." } else { Write-Host "earnings claim tx failed: $e" }`,
    '  }',
    '}',
  ];
}

/**
 * Settle the worker's completed jobs AND claim the resulting earnings into the
 * worker wallet. Releasing a job only credits an internal JobRegistry balance;
 * `withdraw()` moves it to the wallet - so we always do both. `jobIds` are the
 * worker's Completed (unreleased) jobs, looked up from the subgraph by the app.
 */
// Up-front gas check. Every settle / claim / deregister tx is signed by the
// worker key and paid from the worker WALLET (not the locked stake, not the
// claimable JobRegistry balance). An empty wallet is the most common reason these
// silently fail, so surface it before the per-job output rather than after. A
// warning, not a block - gas is tiny, so a borderline wallet may still go through.
function gasPreflightWin(network: NetworkId): string[] {
  const net = NETWORKS[network];
  return [
    `$pfBal = (cast balance $env:WORKER_ADDR --ether --rpc-url "${net.rpc}" 2>$null)`,
    `if ($pfBal -and ([double]$pfBal -lt 0.001)) { Write-Host "WARN - your worker wallet ($env:WORKER_ADDR) holds ~$pfBal LCAI, almost nothing for gas. Settle/claim/deregister are paid from it, so they may fail. If so, send a little LCAI to that address (see ${net.explorer}/address/$env:WORKER_ADDR) and try again." }`,
  ];
}
function gasPreflightUnix(network: NetworkId): string[] {
  const net = NETWORKS[network];
  return [
    `PF_BAL="$(cast balance "$WORKER_ADDR" --ether --rpc-url "${net.rpc}" 2>/dev/null || echo 0)"`,
    `if awk -v b="$PF_BAL" 'BEGIN{exit !(b+0 < 0.001)}'; then echo "⚠ your worker wallet ($WORKER_ADDR) holds ~$PF_BAL LCAI, almost nothing for gas. Settle/claim/deregister are paid from it, so they may fail. If so, send a little LCAI to that address (see ${net.explorer}/address/$WORKER_ADDR) and try again."; fi`,
  ];
}

export function settleJobsCommand(os: OS, network: NetworkId, jobIds: number[]): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      ...keystoreDeriveWin(),
      ...gasPreflightWin(network),
      'Write-Host "settling completed jobs + claiming your rewards"',
      ...releaseJobsWin(network, jobIds),
      ...claimEarningsWin(network),
    ].join("\n");
  }
  return [
    "exec 2>&1",
    ...keystoreDeriveUnix(),
    ...gasPreflightUnix(network),
    'echo "▶ settling completed jobs + claiming your rewards"',
    ...releaseJobsUnix(network, jobIds),
    ...claimEarningsUnix(network),
  ].join("\n");
}

/**
 * Clear STUCK jobs - ones the worker acknowledged but never completed and whose
 * deadline has passed. They sit `Acknowledged` forever and block deregister, and
 * the worker daemon/toolkit have no way to clear them. `claimTimeout` is
 * permissionless, so the operator self-clears them here.
 *
 * WARNING: each cleared job is finalized as TimedOut, which realizes the
 * completion-timeout slash on MAINNET (testnet has slashing disabled). It is the
 * deliberate price of unblocking an exit a stuck job would otherwise block
 * forever. The caller gates this behind an explicit confirm. `jobIds` are the
 * worker's Acknowledged jobs, looked up from the subgraph by the app.
 */
function clearStuckJobsUnix(network: NetworkId, jobIds: number[]): string[] {
  const net = NETWORKS[network];
  if (!jobIds.length) return ['echo "no acknowledged jobs to clear"'];
  return [
    `RPC_URL="${net.rpc}"; JOBREG="${net.jobRegistry}"; CLEARED=0; SKIPPED=0; FAILED=0`,
    `for j in ${jobIds.join(" ")}; do`,
    // Readiness probe FIRST (eth_call, no state change): claimTimeout only
    // succeeds once the job is genuinely past its deadline. If it reverts, the
    // job isn't eligible yet - skip it rather than waste a tx.
    '  if ! cast call "$JOBREG" "claimTimeout(uint256)" "$j" --rpc-url "$RPC_URL" >/dev/null 2>&1; then echo "  • job $j not yet past its deadline (skipping)"; SKIPPED=$((SKIPPED+1)); continue; fi',
    '  if [ -z "${WORKER_PRIVKEY:-}" ]; then echo "  ⛔ job $j is clearable but there is no worker key to sign with"; FAILED=$((FAILED+1)); continue; fi',
    '  ERR="$(cast send "$JOBREG" "claimTimeout(uint256)" "$j" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" 2>&1 >/dev/null)"',
    '  if [ $? -eq 0 ]; then echo "  ✓ cleared stuck job $j"; CLEARED=$((CLEARED+1)); else echo "  ⛔ job $j clear tx failed: $(printf %s "$ERR" | tr "\\n" " " | cut -c1-140)"; FAILED=$((FAILED+1)); fi',
    "done",
    'echo "✓ cleared $CLEARED stuck job(s)$( [ $SKIPPED -gt 0 ] && printf \', %s not yet eligible\' "$SKIPPED" )$( [ $FAILED -gt 0 ] && printf \', %s failed (see above)\' "$FAILED" )"',
  ];
}

function clearStuckJobsWin(network: NetworkId, jobIds: number[]): string[] {
  const net = NETWORKS[network];
  if (!jobIds.length) return ['Write-Host "no acknowledged jobs to clear"'];
  return [
    `$RPC_URL = "${net.rpc}"; $JOBREG = "${net.jobRegistry}"`,
    `foreach ($j in @(${jobIds.join(",")})) {`,
    '  cast call $JOBREG "claimTimeout(uint256)" $j --rpc-url $RPC_URL *> $null',
    '  if ($LASTEXITCODE -ne 0) { Write-Host "job $j not yet past its deadline (skipping)"; continue }',
    '  if (-not $env:WORKER_PRIVKEY) { Write-Host "job $j is clearable but there is no worker key to sign with"; continue }',
    '  $e = (cast send $JOBREG "claimTimeout(uint256)" $j --private-key $env:WORKER_PRIVKEY --rpc-url $RPC_URL 2>&1)',
    // $LASTEXITCODE, not $? (see releaseJobsWin); if/elseif/else on one line for PowerShell.
    `  if ($LASTEXITCODE -eq 0) { Write-Host "cleared stuck job $j" } elseif ("$e" -match "insufficient funds|gas required") { Write-Host "job $j NOT cleared: your worker wallet ($env:WORKER_ADDR) has no LCAI to pay gas. Send a little LCAI to it (see ${net.explorer}/address/$env:WORKER_ADDR), then try again." } else { Write-Host "job $j clear tx failed: $e" }`,
    "}",
  ];
}

/**
 * Clear the worker's stuck (acknowledged, past-deadline) jobs via claimTimeout so
 * deregister is unblocked. See clearStuckJobsUnix for the mainnet-slash warning.
 */
export function clearStuckJobsCommand(os: OS, network: NetworkId, jobIds: number[]): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      ...keystoreDeriveWin(),
      'Write-Host "clearing stuck (acknowledged, past-deadline) jobs"',
      ...clearStuckJobsWin(network, jobIds),
    ].join("\n");
  }
  return [
    "exec 2>&1",
    ...keystoreDeriveUnix(),
    'echo "▶ clearing stuck (acknowledged, past-deadline) jobs"',
    ...clearStuckJobsUnix(network, jobIds),
  ].join("\n");
}

/**
 * Deregister: return the worker's stake to its wallet. `deregisterWorker()` is a
 * single on-chain call signed by the worker key - it needs NO toolkit clone, NO
 * Docker, and NO running container (the old path shelled into the daemon
 * toolkit's deregister.sh, so it died with "toolkit not found" whenever the
 * clone was missing, and even when present the daemon under-set the gas so the
 * tx OutOfGas-reverted while the subgraph still flipped to "deregistered" -
 * exactly the "showed deregistered but stake never came back" failure). We send
 * it directly with gas = estimate x1.5 and verify the chain afterwards, so we
 * only claim success when the worker is truly deregistered. Settles + claims
 * releasable completed jobs first; if an in-flight (acknowledged) job blocks the
 * exit, it points at Clear stuck jobs rather than burning gas. Per-network.
 */
export function deregisterCommand(os: OS, network: NetworkId, jobIds: number[] = []): string {
  const net = NETWORKS[network];
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      ...keystoreDeriveWin(),
      'if (-not $env:WORKER_PRIVKEY) { Write-Host "could not unlock this worker key on this machine - deregister signs with the on-disk worker keystore. If you set a custom keystore password at install, it is required here."; exit 1 }',
      `$WREG = "${net.workerRegistry}"; $RPC = "${net.rpc}"`,
      // Already deregistered? Then the stake is already back in the wallet - say so.
      '$reg = (cast call $WREG "isWorkerRegistered(address)(bool)" $env:WORKER_ADDR --rpc-url $RPC 2>$null)',
      'if ($reg -notmatch "true") { Write-Host "worker $env:WORKER_ADDR is already deregistered on-chain - your stake is back in the worker wallet. Use Withdraw Funds to send it out."; exit 0 }',
      'Write-Host "settling completed jobs + claiming rewards before deregister..."',
      ...releaseJobsWin(network, jobIds),
      ...claimEarningsWin(network),
      // Preflight: simulate the exact call. A revert here is almost always
      // in-flight (acknowledged-but-unfinished) jobs - point at Clear stuck jobs.
      'cast call $WREG "deregisterWorker()" --from $env:WORKER_ADDR --rpc-url $RPC *> $null',
      // $LASTEXITCODE, not $? - on PowerShell 5.1 cast's stderr flips $? even on a
      // clean simulate, which would falsely report deregister as blocked.
      'if ($LASTEXITCODE -ne 0) { Write-Host "deregister is blocked - the worker still has in-flight (acknowledged) job(s) on-chain. Click `"Clear stuck jobs`" first (it times them out), then deregister. Your stake stays safe meanwhile."; exit 1 }',
      // Gas-correct send: estimate x1.5 (the daemon under-sets it and OutOfGas-reverts).
      '$est = (cast estimate --from $env:WORKER_ADDR $WREG "deregisterWorker()" --rpc-url $RPC 2>$null)',
      '$gas = if ($est -match "^[0-9]+$") { [int]([long]$est * 3 / 2) } else { 300000 }',
      'Write-Host "sending deregister (gas limit $gas)..."',
      '$dehReg = (cast send $WREG "deregisterWorker()" --private-key $env:WORKER_PRIVKEY --rpc-url $RPC --gas-limit $gas 2>&1)',
      // $LASTEXITCODE, not $? - else a clean send that wrote to stderr reads as failed.
      `if ($LASTEXITCODE -ne 0) { if ("$dehReg" -match "insufficient funds|gas required") { Write-Host "deregister NOT sent: your worker wallet ($env:WORKER_ADDR) has no LCAI to pay gas. Send a little LCAI to it (see ${net.explorer}/address/$env:WORKER_ADDR), then try again. Your stake is SAFE and the worker is still registered." } else { Write-Host "deregister tx failed to send. Your stake is SAFE and the worker is still registered. Try again in a minute." }; exit 1 }`,
      // Verify on-chain truth - never claim success off a tx that landed but reverted.
      'Start-Sleep -Seconds 2',
      '$reg2 = (cast call $WREG "isWorkerRegistered(address)(bool)" $env:WORKER_ADDR --rpc-url $RPC 2>$null)',
      'if ($reg2 -match "true") { Write-Host "the deregister tx landed but the chain still shows the worker registered (it likely reverted). Your stake is SAFE. Clear stuck jobs, then retry."; exit 1 }',
      'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      'schtasks /Delete /TN "LightChainWorkerWatchdog" /F *> $null',
      // Tear down sleep prevention too - the worker is gone, let the machine sleep
      // (the pause marker also makes any running holder release within ~50s).
      'schtasks /Delete /TN "LightChainWorkerAwake" /F *> $null',
      'docker stop lightchain-worker *> $null',
      'Write-Host "deregistered on-chain - your staked LCAI is back in the worker wallet ($env:WORKER_ADDR). Use Withdraw Funds to send it out; you can now install on another network directly."',
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
    // Derive the worker key from the on-disk keystore (no toolkit clone needed).
    ...keystoreDeriveUnix(),
    '[ -n "${WORKER_PRIVKEY:-}" ] || { echo "⛔ could not unlock this worker key on this machine - deregister signs with the on-disk worker keystore. If you set a custom keystore password at install, it is required here."; exit 1; }',
    `RPC_URL="${net.rpc}"; WREG="${net.workerRegistry}"`,
    // Already deregistered? Then the stake is already back in the wallet - say so
    // rather than sending a doomed tx (this is the state a stale "deregistered"
    // subgraph badge can leave the user confused about).
    'REG="$(cast call "$WREG" "isWorkerRegistered(address)(bool)" "$WORKER_ADDR" --rpc-url "$RPC_URL" 2>/dev/null | awk "{print \\$1}")"',
    'if [ "$REG" != "true" ]; then echo "✓ worker $WORKER_ADDR is already deregistered on-chain - your stake is back in the worker wallet. Use Withdraw Funds to send it out."; exit 0; fi',
    // Settle + claim releasable completed jobs first (strand nothing in-contract).
    'echo "▶ settling completed jobs + claiming rewards before deregister..."',
    ...releaseJobsUnix(network, jobIds),
    ...claimEarningsUnix(network),
    // Preflight: simulate the exact call (eth_call, no gas). A revert is almost
    // always in-flight (acknowledged-but-unfinished) jobs blocking the exit.
    'echo "▶ checking deregister is unblocked..."',
    'if ! cast call "$WREG" "deregisterWorker()" --from "$WORKER_ADDR" --rpc-url "$RPC_URL" >/dev/null 2>&1; then echo "⛔ deregister is blocked - the worker still has in-flight (acknowledged) job(s) on-chain. Click \\"Clear stuck jobs\\" first (it times them out), then deregister. Your stake stays safe meanwhile."; exit 1; fi',
    // Gas-correct send: estimate x1.5, generous fallback. The daemon under-sets
    // this write's gas and OutOfGas-reverts - the bug behind the silent failures.
    'GAS_EST="$(cast estimate --from "$WORKER_ADDR" "$WREG" "deregisterWorker()" --rpc-url "$RPC_URL" 2>/dev/null)"; case "${GAS_EST:-}" in ""|*[!0-9]*) GAS_LIMIT=300000;; *) GAS_LIMIT="$(python3 -c "import sys; print(int(int(sys.argv[1])*3//2))" "$GAS_EST" 2>/dev/null || echo 300000)";; esac',
    'echo "▶ sending deregister (gas limit $GAS_LIMIT)..."',
    'if ! cast send "$WREG" "deregisterWorker()" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" --gas-limit "$GAS_LIMIT" >/dev/null 2>&1; then echo "⛔ deregister tx failed to send. Your stake is SAFE and the worker is still registered. Try again in a minute."; exit 1; fi',
    // Verify on-chain - never claim success off a tx that landed but reverted.
    "sleep 2",
    'REG2="$(cast call "$WREG" "isWorkerRegistered(address)(bool)" "$WORKER_ADDR" --rpc-url "$RPC_URL" 2>/dev/null | awk "{print \\$1}")"',
    'if [ "$REG2" = "true" ]; then echo "⛔ the deregister tx landed but the chain still shows the worker registered (it likely reverted). Your stake is SAFE. Clear stuck jobs, then retry."; exit 1; fi',
    // Success: stake is back in the worker wallet. Tear down the watchdog + stop
    // any container best-effort (it may not even exist).
    'touch "$HOME/.lightnode/keep-online.paused" 2>/dev/null || true',
    'launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true',
    `( crontab -l 2>/dev/null | grep -v 'lightnode/keep-online.sh' ) | crontab - 2>/dev/null || true`,
    'launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; pkill -f "systemd-inhibit.*lightnode-awake" 2>/dev/null || true',
    'docker stop lightchain-worker >/dev/null 2>&1 || true',
    'echo "✅ deregistered on-chain - your staked LCAI is back in the worker wallet ($WORKER_ADDR). Use Withdraw Funds to send it out; you can now install on another network directly."',
  ].join("\n");
}

/**
 * ADD models to an EXISTING registered worker, on-chain, with no re-register or
 * re-stake. Uses the worker binary's `add-models` subcommand (which knows the real
 * registry contract + calldata - a raw cast to the predeploy doesn't work, its ABI
 * differs). `models` is the set to ADD; the binary signs from the on-disk keystore
 * using the recovered password. The caller then reinstalls so the worker restarts
 * advertising the full set and pulls/warms the new model. There is no live "remove"
 * (the network could still route a removed model's jobs) - drop a model by
 * deregistering + reinstalling with the smaller set.
 */
export function addModelsCommand(os: OS, network: NetworkId, modelsToAdd: string[]): string {
  const supported = modelsToAdd.join(",");
  const workerRegistry = NETWORKS[network].workerRegistry;
  const rpc = NETWORKS[network].rpc;
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'Set-Location "$env:USERPROFILE\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null; Set-Location "$env:USERPROFILE\\.lightnode\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null',
      ...keystoreDeriveWin(),
      'if (-not $env:WORKER_PASSWORD) { Write-Host "couldn\'t unlock the worker keystore (need its password) - reinstall and retry."; exit 1 }',
      // KEYS_DIR was set by the keystore derivation to the matched per-network dir.
      `$env:NETWORK = "${network}"; $env:SUPPORTED_MODELS = "${supported}"`,
      `Write-Host "adding model(s) on-chain: ${modelsToAdd.join(", ")} (no re-stake)..."`,
      // Direct WorkerRegistry.addSupportedModel(bytes32) with gas = estimate x1.5,
      // NOT the worker binary's add-models (which under-sets gas and OutOfGas-
      // reverts - the same daemon bug that breaks a one-shot install).
      `$WREG = "${workerRegistry}"; $RPC = "${rpc}"; $addFail = 0`,
      `foreach ($M in @(${modelsToAdd.map((m) => `'${m}'`).join(",")})) {`,
      `  $MID = (cast keccak "$M")`,
      `  $elig = (cast call $WREG "isEligible(address,bytes32)(bool)" $env:WORKER_ADDR $MID --rpc-url $RPC 2>$null)`,
      `  if ($elig -match 'true') { Write-Host "  - $M already served on-chain - skipping"; continue }`,
      `  $est = (cast estimate --from $env:WORKER_ADDR $WREG "addSupportedModel(bytes32)" $MID --rpc-url $RPC 2>$null)`,
      `  $gas = if ($est -match '^[0-9]+$') { [int]([long]$est * 3 / 2) } else { 300000 }`,
      `  cast send $WREG "addSupportedModel(bytes32)" $MID --private-key $env:WORKER_PRIVKEY --rpc-url $RPC --gas-limit $gas *> $null`,
      `  if ($LASTEXITCODE -eq 0) { Write-Host "  added $M (gas limit $gas)" } else { Write-Host "  failed to add $M"; $addFail = 1 }`,
      `}`,
      `if ($addFail -ne 0) { Write-Host "one or more models failed to add - see above"; exit 1 }`,
      // Stop the container so the follow-up reinstall recreates it with the new
      // model set (the install short-circuits on a same-network worker that's Up).
      'docker stop lightchain-worker *> $null; Write-Host "added on-chain - restarting the worker with the new set"',
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    'TK="$HOME/.lightnode/lightchain-worker-toolkit/scripts/bash"; [ -d "$TK" ] || TK="$HOME/lightchain-worker-toolkit/scripts/bash"',
    'cd "$TK" 2>/dev/null || { echo "⛔ toolkit not found - install the worker first."; exit 1; }',
    'if bash -c "declare -A _t" 2>/dev/null; then RB=bash; else RB="$(brew --prefix 2>/dev/null)/bin/bash"; fi',
    ...keystoreDeriveUnix(),
    '[ -n "${WORKER_PASSWORD:-}" ] || { echo "⛔ couldn\'t unlock the worker keystore (need its password) - reinstall and retry."; exit 1; }',
    // KEYS_DIR was set by keystoreDeriveUnix to the matched per-network dir.
    `export NETWORK=${network} SUPPORTED_MODELS=${supported} RPC_URL="${rpc}"`,
    `echo "▶ adding model(s) on-chain: ${modelsToAdd.join(", ")} (no re-stake)..."`,
    // Call WorkerRegistry.addSupportedModel(bytes32) DIRECTLY with a gas limit
    // derived from cast estimate x1.5 - NOT the worker binary's `add-models`
    // subcommand, which sends with an under-set fixed gas limit and OutOfGas-
    // reverts (the same daemon bug that breaks a one-shot gemma install). modelId
    // = keccak256(exact tag). Skip a model that's already eligible on-chain.
    `WREG="${workerRegistry}"`,
    `ADD_OK=0; ADD_FAIL=0`,
    `for M in ${modelsToAdd.map((m) => `"${m}"`).join(" ")}; do`,
    `  MID="$(cast keccak "$M")"`,
    `  if cast call "$WREG" "isEligible(address,bytes32)(bool)" "$WORKER_ADDR" "$MID" --rpc-url "$RPC_URL" 2>/dev/null | grep -qi true; then echo "  • $M already served on-chain - skipping"; continue; fi`,
    // estimate, then add a 50% buffer; fall back to a generous 300000 if estimate fails.
    `  GAS_EST="$(cast estimate --from "$WORKER_ADDR" "$WREG" "addSupportedModel(bytes32)" "$MID" --rpc-url "$RPC_URL" 2>/dev/null)"; case "\${GAS_EST:-}" in ''|*[!0-9]*) GAS_LIMIT=300000;; *) GAS_LIMIT="$(python3 -c 'import sys; print(int(int(sys.argv[1])*3//2))' "$GAS_EST")";; esac`,
    `  if cast send "$WREG" "addSupportedModel(bytes32)" "$MID" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" --gas-limit "$GAS_LIMIT" >/dev/null 2>&1; then echo "  ✓ added $M (gas limit $GAS_LIMIT)"; ADD_OK=$((ADD_OK+1)); else echo "  ⛔ failed to add $M"; ADD_FAIL=$((ADD_FAIL+1)); fi`,
    `done`,
    `[ "$ADD_FAIL" = "0" ] || { echo "⛔ one or more models failed to add - see above"; exit 1; }`,
    // Stop the container after a successful add so the follow-up reinstall actually
    // recreates it with the new model set (the install short-circuits on a
    // same-network worker that's still Up).
    `echo "✓ added on-chain - restarting the worker with the new set"; docker stop lightchain-worker >/dev/null 2>&1 || true`,
  ].join("\n");
}

/**
 * Free up the machine completely: stop the worker and reclaim the RAM it holds.
 * Deregistering only exits the chain - the model stays resident in Ollama (the
 * big chunk, ~5 GB) and Docker keeps its VM (~4 GB on macOS), so the machine
 * keeps lagging. This op writes the pause marker (so the keep-online watchdog
 * won't bring it back), unloads the model from Ollama, stops the worker
 * container, and on macOS quits Docker Desktop to release its VM. Stake and
 * registration are untouched - Restart brings the worker back.
 */
export function freeMemoryCommand(os: OS): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'Write-Host "> freeing up your machine (stopping the worker + reclaiming RAM)..."',
      'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      '$ms = (Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue); if (-not $ms) { $ms = @("llama3-8b") }',
      'foreach ($m in $ms) { if ($m) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 10 -Body "{`"model`":`"$m`",`"keep_alive`":0}" | Out-Null; Write-Host "OK - unloaded $m from memory" } catch {} } }',
      'try { docker stop lightchain-worker | Out-Null; Write-Host "OK - stopped the worker container" } catch {}',
      'Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Write-Host "OK - quit Docker Desktop (released its VM memory)"',
      'Start-Sleep -Seconds 1',
      'try { $ps = Invoke-RestMethod -Uri http://127.0.0.1:11434/api/ps -TimeoutSec 5; if ($ps.models -and $ps.models.Count -gt 0) { Write-Host "WARNING - Ollama still shows a model resident; give it a few seconds or quit the Ollama app" } else { Write-Host "OK - verified: no model resident in Ollama (RAM reclaimed)" } } catch { Write-Host "OK - verified: Ollama holds no model" }',
      'Write-Host "Done - memory freed. Your stake and registration are untouched; click Restart to come back online."',
    ].join("\n");
  }
  const isMac = os === "macos";
  const lines = [
    "exec 2>&1",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
    'echo "▶ freeing up your machine (stopping the worker + reclaiming RAM)..."',
    // Pause marker first: even if the worker is still registered, the watchdog
    // must not silently restart it (and reload the model) behind our backs.
    'mkdir -p "$HOME/.lightnode" 2>/dev/null; touch "$HOME/.lightnode/keep-online.paused"',
    'if curl -s -m 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then',
    '  while IFS= read -r M; do [ -n "$M" ] && curl -s -m 10 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$M\\",\\"keep_alive\\":0}" >/dev/null 2>&1 && echo "✓ unloaded $M from memory"; done < "$HOME/.lightnode/model" 2>/dev/null || true',
    "fi",
    'if [ -n "$(docker ps -q -f name=lightchain-worker 2>/dev/null)" ]; then docker stop lightchain-worker >/dev/null 2>&1 && echo "✓ stopped the worker container"; fi',
  ];
  if (isMac) {
    lines.push("osascript -e 'quit app \"Docker Desktop\"' >/dev/null 2>&1 || osascript -e 'quit app \"Docker\"' >/dev/null 2>&1 || true; echo \"✓ quit Docker Desktop (released its VM memory)\"");
  } else {
    lines.push('echo "  (Linux: the Docker engine runs without a VM, so there is nothing heavy to quit)"');
  }
  lines.push(AWAKE_OFF_UNIX);
  // Verify the big consumers are actually gone, so "freed" isn't just a claim.
  lines.push("sleep 1");
  lines.push(
    'RESIDENT="$(curl -s -m 5 http://127.0.0.1:11434/api/ps 2>/dev/null)"; if printf "%s" "$RESIDENT" | grep -q size; then echo "⚠ Ollama still shows a model resident - give it a few seconds, or quit the Ollama app to force it out"; else echo "✓ verified: no model resident in Ollama (the ~5 GB is reclaimed)"; fi',
  );
  if (isMac) {
    lines.push(
      'if docker info >/dev/null 2>&1; then echo "  (Docker engine is still stopping - it releases its VM within ~10s)"; else echo "✓ verified: Docker engine stopped (its VM RAM is reclaimed)"; fi',
    );
  }
  lines.push('echo "✅ memory freed. Your stake and registration are untouched - click Restart to come back online."');
  return lines.join("\n");
}

/**
 * Full teardown for someone who is done: removes the big disk/RAM users (worker
 * container, its Docker image, the served Ollama models), the toolkit clone, and
 * the keep-online watchdog. It deliberately KEEPS the tiny worker keystore so any
 * returned stake/funds stay reachable (delete ~/lightchain-worker by hand if truly
 * done). Safety: aborts if a DIFFERENT-network worker container is running here, so
 * it can never nuke the wrong worker.
 */
export function uninstallCommand(os: OS, network: NetworkId): string {
  const net = NETWORKS[network];
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'Write-Host "> removing the LightNode worker from this machine..."',
      `$running = (docker ps --format "{{.Names}} {{.Status}}" 2>$null | Select-String "^lightchain-worker Up")`,
      'if ($running) {',
      '  $runChain = ((docker inspect lightchain-worker --format "{{range .Config.Env}}{{println .}}{{end}}" 2>$null | Select-String "^CHAIN_ID=(.+)$" | Select-Object -First 1).Matches.Groups[1].Value)',
      `  if ($runChain -and $runChain -ne "${net.chainId}") { Write-Host "STOP - a worker for the other network (chain $runChain) is running here. Switch to that network to remove it. Nothing was removed."; exit 1 }`,
      '}',
      'New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      '$ms = (Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue)',
      'foreach ($m in $ms) { if ($m) { try { ollama rm $m *> $null; Write-Host "OK - removed Ollama model $m" } catch {} } }',
      'docker rm -f lightchain-worker *> $null; Write-Host "OK - removed the worker container"',
      `docker rmi "${net.workerImage}" *> $null; Write-Host "OK - removed the worker Docker image"`,
      'schtasks /Delete /TN "LightChainWorkerWatchdog" /F *> $null',
      'schtasks /Delete /TN "LightChainWorkerAwake" /F *> $null',
      'Remove-Item -Recurse -Force "$env:USERPROFILE\\.lightnode" -ErrorAction SilentlyContinue; Write-Host "OK - removed the watchdog + working files"',
      'Remove-Item -Recurse -Force "$env:USERPROFILE\\lightchain-worker-toolkit" -ErrorAction SilentlyContinue',
      'Write-Host "• kept your worker keys at ~/lightchain-worker (tiny; they control any returned stake/funds)"',
      'Write-Host "Done - the worker image, models, and container are gone. Reinstall any time from Become a worker."',
    ].join("\n");
  }
  const isMac = os === "macos";
  const lines = [
    "exec 2>&1",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
    'echo "▶ removing the LightNode worker from this machine..."',
    // Never nuke a worker that belongs to the OTHER network (one container, shared name).
    `if docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -qE '^lightchain-worker Up'; then RUNCHAIN="$(docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^CHAIN_ID=' | head -1 | cut -d= -f2)"; if [ -n "$RUNCHAIN" ] && [ "$RUNCHAIN" != "${net.chainId}" ]; then echo "⛔ a worker for the other network (chain $RUNCHAIN) is running here, and this machine runs one at a time. Switch the network toggle to that worker to remove it. Nothing was removed."; exit 1; fi; fi`,
    // Pause the watchdog so it can't resurrect anything mid-teardown.
    'mkdir -p "$HOME/.lightnode" 2>/dev/null; touch "$HOME/.lightnode/keep-online.paused"',
    // Remove the served models from Ollama - the biggest disk/RAM hog.
    'if curl -s -m 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then while IFS= read -r M; do [ -n "$M" ] && { curl -s -m 10 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$M\\",\\"keep_alive\\":0}" >/dev/null 2>&1; ollama rm "$M" >/dev/null 2>&1 && echo "✓ removed Ollama model $M"; }; done < "$HOME/.lightnode/model" 2>/dev/null || true; fi',
    // Container + image.
    'docker rm -f lightchain-worker >/dev/null 2>&1 && echo "✓ removed the worker container" || true',
    `docker rmi "${net.workerImage}" >/dev/null 2>&1 && echo "✓ removed the worker Docker image" || true`,
    // Keep-online watchdog + sleep-prevention.
    isMac
      ? 'for A in worker-watchdog worker-awake; do launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.$A.plist" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/ai.lightchain.$A.plist" 2>/dev/null || true; done; echo "✓ removed the keep-online watchdog"'
      : '( crontab -l 2>/dev/null | grep -v "lightnode/keep-online.sh" ) | crontab - 2>/dev/null || true; pkill -f "systemd-inhibit.*lightnode-awake" 2>/dev/null || true; echo "✓ removed the keep-online watchdog"',
    // Working dir (watchdog script, model list, toolkit clone, logs, config).
    'rm -rf "$HOME/.lightnode" 2>/dev/null && echo "✓ removed ~/.lightnode (watchdog, toolkit, config)" || true',
    'rm -rf "$HOME/lightchain-worker-toolkit" 2>/dev/null || true',
    // Keys are tiny and control any returned stake/funds - keep them.
    'echo "• kept your worker keys at ~/lightchain-worker (tiny; they control any returned stake/funds - delete that folder by hand only if you are certain)"',
  ];
  if (isMac) {
    lines.push("osascript -e 'quit app \"Docker Desktop\"' >/dev/null 2>&1 || osascript -e 'quit app \"Docker\"' >/dev/null 2>&1 || true; echo \"✓ quit Docker Desktop\"");
  }
  lines.push('echo "✅ removed. The big disk/RAM users (worker image, models, container) are gone. Reinstall any time from Become a worker."');
  return lines.join("\n");
}

/**
 * Pre-install checks: confirm the machine + network are ready BEFORE the user funds
 * and stakes (the only irreversible step). Verifies Docker, Ollama, free disk, and
 * live reachability of the RPC, gateway, and indexer for the target network.
 */
export function preflightCommand(os: OS, network: NetworkId): string {
  const net = NETWORKS[network];
  // Build-time fallback ONLY (used if the live AIConfig read fails). The real
  // threshold is derived live from chain below, same as the install gate.
  const fallbackThrWei = (BigInt(net.minStakeLcai) * 10n ** 18n + 5n * 10n ** 17n).toString();
  // eth_call selectors: aiConfig() = 0x85ff4862 (WorkerRegistry),
  // getMinWorkerStake() = 0xca22dfd1 (AIConfig). Used to derive the threshold
  // without baking a stake number in.
  const AICONFIG_SELECTOR = "0x85ff4862";
  const MINSTAKE_SELECTOR = "0xca22dfd1";
  // Preflight reports BLOCKS only for things install can't fix on its own (an
  // unreachable RPC). Docker + Ollama are downgraded to WARN: install auto-installs
  // and auto-starts them (winget on Windows, brew + open on macOS), so failing
  // preflight on them would falsely block users from clicking Install when Install
  // is exactly what would resolve the situation. The warning still tells the user
  // what install will do next.
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      `Write-Host "> preflight for the LightChain ${network} worker"`,
      '$ok = $true',
      'if (Get-Command docker -ErrorAction SilentlyContinue) { docker info *> $null; if ($?) { Write-Host "OK - Docker is running" } else { Write-Host "WARN - Docker is installed but not running; install will start Docker Desktop for you" } } else { Write-Host "WARN - Docker Desktop not installed; install will set it up via winget (allow the prompts)" }',
      'try { $null = Invoke-RestMethod -Uri http://127.0.0.1:11434/api/tags -TimeoutSec 5; Write-Host "OK - Ollama is responding" } catch { if (Get-Command ollama -ErrorAction SilentlyContinue) { Write-Host "WARN - Ollama is installed but not responding; install will start it" } else { Write-Host "WARN - Ollama not installed; install will set it up via winget" } }',
      '$free = [math]::Floor((Get-PSDrive C).Free / 1GB); if ($free -ge 15) { Write-Host "OK - disk: $free GB free" } else { Write-Host "WARN - only $free GB free (model + image need ~10 GB)" }',
      `try { $null = Invoke-RestMethod -Uri "${net.rpc}" -Method Post -TimeoutSec 8 -Body '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' -ContentType "application/json"; Write-Host "OK - RPC reachable" } catch { Write-Host "BLOCK - RPC unreachable (${net.rpc})"; $ok = $false }`,
      `try { $null = Invoke-RestMethod -Uri "${net.subgraph}" -Method Post -TimeoutSec 8 -Body '{"query":"{__typename}"}' -ContentType "application/json"; Write-Host "OK - indexer reachable" } catch { Write-Host "WARN - indexer probe failed (status display may lag)" }`,
      // Derive the funding threshold LIVE from chain (never hardcode the stake):
      // eth_call aiConfig() on the WorkerRegistry, then getMinWorkerStake() on it,
      // + 0.5 LCAI gas cushion. Falls back to the build-time value if the read fails.
      `$ThrWei = [System.Numerics.BigInteger]::Parse('${fallbackThrWei}')`,
      `try { $hexAddr = (Invoke-RestMethod -Uri "${net.rpc}" -Method Post -ContentType 'application/json' -TimeoutSec 6 -Body '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${net.workerRegistry}","data":"${AICONFIG_SELECTOR}"},"latest"]}').result; $aicfg = "0x" + $hexAddr.Substring($hexAddr.Length - 40); $hexMin = (Invoke-RestMethod -Uri "${net.rpc}" -Method Post -ContentType 'application/json' -TimeoutSec 6 -Body ('{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"' + $aicfg + '","data":"${MINSTAKE_SELECTOR}"},"latest"]}')).result; $minWei = [System.Numerics.BigInteger]::Parse('0' + $hexMin.Substring(2), [System.Globalization.NumberStyles]::HexNumber); if ($minWei -gt 0) { $ThrWei = $minWei + [System.Numerics.BigInteger]::Parse('500000000000000000') } } catch {}`,
      // Informational: read the chosen worker wallet's balance (the env-passed
      // WORKER_ADDR). Never a BLOCK - install itself waits up to 90s for a
      // still-pending funding tx before failing. Skipped if no address has been
      // picked yet (the user can run preflight before generating a worker).
      `if ($env:WORKER_ADDR) { try { $body = '{"jsonrpc":"2.0","method":"eth_getBalance","params":["' + $env:WORKER_ADDR + '","latest"],"id":1}'; $r = Invoke-RestMethod -Uri "${net.rpc}" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 5; $hex = ($r.result -replace '^0x',''); if ($hex.Length -gt 0 -and -not $hex.StartsWith('0')) { $hex = '0' + $hex }; $bal = if ($hex) { [System.Numerics.BigInteger]::Parse($hex, [System.Globalization.NumberStyles]::HexNumber) } else { [System.Numerics.BigInteger]::Zero }; $lcai = [Math]::Round([double]([System.Numerics.BigInteger]::Divide($bal, [System.Numerics.BigInteger]::Pow(10, 15))) / 1000, 3); if ($bal -ge $ThrWei) { Write-Host "OK - worker wallet funded ($lcai LCAI)" } else { Write-Host "WARN - worker wallet at $($env:WORKER_ADDR) has only $lcai LCAI; install will wait up to 90s for funding to confirm" } } catch { Write-Host "WARN - could not read worker wallet balance (RPC probe failed)" } }`,
      // Worker key / password sanity. If a keystore for THIS worker already exists
      // on disk (a retry, or a "use a previous worker" flow), confirm at least one
      // saved password slot decrypts it - so the install path's multi-password
      // resolve will succeed instead of failing at register. Only a BLOCK when a
      // keystore is on disk AND none of the saved passwords decrypt it.
      `if (Get-Command cast -ErrorAction SilentlyContinue) { $ks = "$env:USERPROFILE\\lightchain-worker\\keys-${network}\\eth-keystore"; if (Test-Path $ks) { $ksFile = Get-ChildItem $ks -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ksFile) { $okPw = $false; foreach ($pw in @($env:WORKER_PASSWORD, $env:WORKER_PASSWORD_ALT1, $env:WORKER_PASSWORD_ALT2, $env:WORKER_PASSWORD_ALT3)) { if (-not $pw) { continue }; & cast wallet decrypt-keystore $ksFile.Name --keystore-dir $ks --unsafe-password $pw *> $null; if ($LASTEXITCODE -eq 0) { $okPw = $true; break } }; if ($okPw) { Write-Host "OK - existing worker key decrypts with a saved password" } elseif ($env:WORKER_PRIVKEY) { Write-Host "OK - keystore password differs, but the app holds this worker's key; install will re-import it under the current password (no stake touched)" } else { Write-Host "BLOCK - a worker key for this network exists on disk, none of the saved passwords decrypts it, and the app does not hold the raw key. Re-enter the original password, or use Recover a replaced key on the dashboard."; $ok = $false } } } }`,
      // Optional: when a raw key was passed to the app (fresh install path),
      // confirm it derives to the WORKER_ADDR we are about to register. A
      // mismatch here would silently sign the register tx with the wrong key.
      `if (Get-Command cast -ErrorAction SilentlyContinue) { if ($env:WORKER_PRIVKEY -and $env:WORKER_ADDR) { try { $derived = (cast wallet address --private-key $env:WORKER_PRIVKEY 2>$null).Trim(); if ($derived -and ($derived.ToLower() -eq $env:WORKER_ADDR.ToLower())) { Write-Host "OK - worker key matches the target address" } else { Write-Host "BLOCK - the worker private key the app holds derives $derived, not $($env:WORKER_ADDR). Generate a new worker or recover the correct key before installing."; $ok = $false } } catch { } } }`,
      'if ($ok) { Write-Host "PASS - preflight passed, safe to install" } else { Write-Host "BLOCK - fix the items above before installing (your stake is only spent once install proceeds)" }',
    ].join("\n");
  }
  return [
    "exec 2>&1",
    'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"',
    APPIMAGE_ENV_GUARD_UNIX, // repair AppImage-broken curl before any probe runs
    `echo "▶ preflight for the LightChain ${network} worker"`,
    "OK=1",
    APPIMAGE_CURL_HINT_UNIX, // if curl is still broken, name the cause + the .deb fix

    'if command -v docker >/dev/null 2>&1; then if docker info >/dev/null 2>&1; then echo "✓ Docker is running"; else echo "⚠ Docker is installed but not running - install will start Docker Desktop for you"; fi; else echo "⚠ Docker Desktop not installed - install Docker Desktop manually (the installer needs it) then re-run install"; fi',
    'if curl -s -m 5 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then echo "✓ Ollama is responding (127.0.0.1:11434)"; elif command -v ollama >/dev/null 2>&1; then echo "⚠ Ollama is installed but not responding - install will start it"; else echo "⚠ Ollama not installed - install will set it up via brew"; fi',
    `FREE_G="$(df -k "$HOME" 2>/dev/null | awk 'NR==2 {print int($4/1048576)}')"; if [ "\${FREE_G:-0}" -ge 15 ]; then echo "✓ disk: $FREE_G GB free"; else echo "⚠ disk: only \${FREE_G:-?} GB free - the model + image need ~10 GB"; fi`,
    `if curl -s -m 8 -X POST "${net.rpc}" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -qE '"result"'; then echo "✓ RPC reachable (${net.rpc})"; else echo "⛔ RPC unreachable (${net.rpc}) - check your connection"; OK=0; fi`,
    `if curl -s -m 8 -o /dev/null "${net.workerGateway}/" 2>/dev/null; then echo "✓ gateway reachable"; else echo "⚠ gateway probe inconclusive (${net.workerGateway}) - it may still admit the worker"; fi`,
    `if curl -s -m 8 -X POST "${net.subgraph}" -H 'content-type: application/json' -d '{"query":"{__typename}"}' | grep -q __typename; then echo "✓ indexer (subgraph) reachable"; else echo "⚠ indexer probe failed - status display may lag"; fi`,
    // Derive the funding threshold LIVE from chain (never hardcode the stake):
    // WorkerRegistry.aiConfig() -> AIConfig.getMinWorkerStake() + 0.5 LCAI cushion.
    // cast is a preflight prerequisite; fall back to the build-time value if absent
    // or the read fails so the (informational) line still renders.
    `THR_WEI='${fallbackThrWei}'; if command -v cast >/dev/null 2>&1; then PF_AICFG="$(cast call "${net.workerRegistry}" 'aiConfig()(address)' --rpc-url '${net.rpc}' 2>/dev/null | awk '{print $1}')"; PF_MIN="$(cast call "$PF_AICFG" 'getMinWorkerStake()(uint256)' --rpc-url '${net.rpc}' 2>/dev/null | awk '{print $1}')"; case "\${PF_MIN:-}" in ''|*[!0-9]*) : ;; *) THR_WEI="$(python3 -c 'import sys; print(int(sys.argv[1]) + 5*10**17)' "$PF_MIN")";; esac; fi`,
    // Informational worker-wallet balance line (never a BLOCK - install waits up
    // to 90s for a still-pending funding tx). Skipped if no address is picked yet.
    `if [ -n "\${WORKER_ADDR:-}" ]; then BH="$(curl -s -m 5 -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["'"$WORKER_ADDR"'","latest"],"id":1}' '${net.rpc}' | sed -nE 's/.*"result":"(0x[0-9a-fA-F]+)".*/\\1/p')"; PFL="$(python3 -c 'import sys; print(round(int(sys.argv[1] or "0x0", 16)/10**18, 3))' "\${BH:-0x0}" 2>/dev/null || echo 0)"; if python3 -c 'import sys; sys.exit(0 if int(sys.argv[1] or "0x0", 16) >= int(sys.argv[2]) else 1)' "\${BH:-0x0}" "$THR_WEI" 2>/dev/null; then echo "✓ worker wallet funded ($PFL LCAI)"; else echo "⚠ worker wallet at $WORKER_ADDR has only $PFL LCAI; install will wait up to 90s for funding to confirm"; fi; fi`,
    // Worker key / password sanity. If a keystore for THIS network already exists
    // (a retry, or a "use a previous worker" flow), confirm at least one saved
    // password slot decrypts it - so the install path's multi-password resolve
    // will succeed. Only a BLOCK when a keystore is on disk AND none decrypt.
    `if command -v cast >/dev/null 2>&1; then KS="$HOME/lightchain-worker/keys-${network}/eth-keystore"; KSF="$(ls -1 "$KS" 2>/dev/null | head -1)"; if [ -n "$KSF" ]; then OK_PW=""; for PW in "\${WORKER_PASSWORD:-}" "\${WORKER_PASSWORD_ALT1:-}" "\${WORKER_PASSWORD_ALT2:-}" "\${WORKER_PASSWORD_ALT3:-}"; do [ -z "$PW" ] && continue; if cast wallet decrypt-keystore "$KSF" --keystore-dir "$KS" --unsafe-password "$PW" >/dev/null 2>&1; then OK_PW=1; break; fi; done; if [ -n "$OK_PW" ]; then echo "✓ existing worker key decrypts with a saved password"; elif [ -n "\${WORKER_PRIVKEY:-}" ]; then echo "✓ keystore password differs, but the app holds this worker's key; install will re-import it under the current password (no stake touched)"; else echo "⛔ a worker key for this network exists on disk, none of the saved passwords decrypts it, and the app does not hold the raw key. Re-enter the original password, or use Recover a replaced key on the dashboard."; OK=0; fi; fi; fi`,
    // Optional: when a raw key was passed (fresh install path), confirm it derives
    // to the WORKER_ADDR we're about to register. A mismatch here would silently
    // sign with the wrong key during install.
    `if command -v cast >/dev/null 2>&1; then if [ -n "\${WORKER_PRIVKEY:-}" ] && [ -n "\${WORKER_ADDR:-}" ]; then DERIVED="$(cast wallet address --private-key "$WORKER_PRIVKEY" 2>/dev/null)"; if [ -n "$DERIVED" ] && [ "$(printf %s "$DERIVED" | tr A-Z a-z)" = "$(printf %s "$WORKER_ADDR" | tr A-Z a-z)" ]; then echo "✓ worker key matches the target address"; else echo "⛔ the worker private key the app holds derives $DERIVED, not $WORKER_ADDR. Generate a new worker or recover the correct key before installing."; OK=0; fi; fi; fi`,
    '[ "$OK" = "1" ] && echo "✅ preflight passed - safe to install" || echo "⛔ preflight found blockers above - fix them before installing (your stake is only spent once install proceeds)"',
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
    'if ! docker info >/dev/null 2>&1; then',
    '  echo "▶ Docker is not running - starting Docker Desktop..."',
    '  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true',
    '  for _ in $(seq 1 15); do docker info >/dev/null 2>&1 && break; sleep 2; done',
    // A plain `open` is a no-op when the Docker Desktop GUI is already running but
    // its ENGINE is stopped (the half-state that "Free up memory" / a manual quit
    // leaves). Detect that and relaunch cleanly so Restart/Status can recover it.
    '  if ! docker info >/dev/null 2>&1 && pgrep -x "Docker Desktop" >/dev/null 2>&1; then',
    '    echo "▶ Docker Desktop is open but its engine is stopped - relaunching it..."',
    "    osascript -e 'quit app \"Docker Desktop\"' >/dev/null 2>&1 || true; sleep 2; pkill -x \"Docker Desktop\" >/dev/null 2>&1 || true; sleep 3",
    '    open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true',
    '    for _ in $(seq 1 45); do docker info >/dev/null 2>&1 && break; sleep 2; done',
    '  fi',
    "fi",
    'docker info >/dev/null 2>&1 || { echo "⛔ Cannot reach Docker. Open Docker Desktop manually and wait for the whale icon to settle, then try again."; exit 1; }',
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
      `docker info *> $null; if (-not $?) { Write-Host "> starting Docker Desktop..."; ${WIN_START_DOCKER}; for ($i=0; $i -lt 45; $i++) { docker info *> $null; if ($?) { break }; Start-Sleep 2 } }`,
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
# Restart = the user wants it running, so lift any pause from a prior Stop and
# re-arm sleep prevention (the machine must stay awake while it serves jobs).
Remove-Item (Join-Path $env:USERPROFILE ".lightnode\\keep-online.paused") -ErrorAction SilentlyContinue
$ka = Join-Path $env:USERPROFILE ".lightnode\\keep-awake.ps1"
if (Test-Path $ka) { Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$ka) -ErrorAction SilentlyContinue }
if (-not ((docker ps -a --format "{{.Names}}") -match "^lightchain-worker$")) { Write-Host "⛔ No worker container exists on this machine yet - Restart only recovers an existing one. Click Install to create and start it. If your worker is already registered + staked on-chain, Install detects that and skips re-staking; it just builds the container and brings it online."; exit 1 }
docker stop lightchain-worker *> $null
$sess = Join-Path $env:USERPROFILE "lightchain-worker\\keys\\session-keys.enc"
if (Test-Path $sess) { Move-Item $sess "$sess.bak-$((Get-Date).Ticks)"; Write-Host "✓ cleared stale session store" }
docker start lightchain-worker
Write-Host "✓ worker restarted - give it ~1 min, then check the dashboard"
$ms = (Get-Content (Join-Path $env:USERPROFILE ".lightnode\\model") -ErrorAction SilentlyContinue); if (-not $ms) { $ms = @("llama3-8b") }
Write-Host "pre-warming each served model (kept resident) so the first job does not cold-load"
foreach ($m in $ms) { if ($m) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 180 -Body "{\`"model\`":\`"$m\`",\`"prompt\`":\`"ok\`",\`"keep_alive\`":-1,\`"stream\`":false}" | Out-Null; Write-Host "$m warm + pinned" } catch { Write-Host "(could not pre-warm $m now - the watchdog will warm it shortly)" } } }
docker logs --tail 20 lightchain-worker`;
  }
  return [
    "exec 2>&1",
    'echo "▶ repairing lightchain-worker"',
    // Restart = the user wants it running, so lift any pause from a prior Stop and
    // re-arm sleep prevention (the machine must stay awake while it serves jobs).
    'rm -f "$HOME/.lightnode/keep-online.paused" 2>/dev/null || true',
    AWAKE_ON_UNIX,
    `if ! docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then echo "⛔ No worker container exists on this machine yet - Restart only recovers an existing one. Click Install to create and start it. If your worker is already registered + staked on-chain, Install detects that and skips re-staking; it just builds the container and brings it online."; exit 1; fi`,
    "docker stop lightchain-worker >/dev/null 2>&1 || true",
    'SESS="$HOME/lightchain-worker/keys/session-keys.enc"',
    '[ -f "$SESS" ] && mv "$SESS" "${SESS}.bak-$(date +%s)" && echo "✓ cleared stale session store"',
    "docker start lightchain-worker",
    'echo "✓ worker restarted - watching for connection (up to ~60s)"',
    'for _ in $(seq 1 30); do if docker logs --since 20s lightchain-worker 2>&1 | grep -qiE "websocket connected|gateway auth"; then echo "✅ worker connected - should go Live on the dashboard"; break; fi; sleep 2; done',
    // Pre-warm + pin the model (keep_alive:-1) exactly like the installer, so the
    // FIRST job after a restart doesn't cold-load and miss the deadline (a
    // cold-start timeout is the slashable case).
    'echo "▶ pre-warming each served model (kept resident) so the first job does not cold-load"',
    'while IFS= read -r M; do [ -n "$M" ] && { curl -s -m 180 http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$M\\",\\"prompt\\":\\"ok\\",\\"keep_alive\\":-1,\\"stream\\":false}" >/dev/null 2>&1 && echo "✓ $M warm + pinned" || echo "(could not pre-warm $M now - the watchdog will warm it shortly)"; }; done < "$HOME/.lightnode/model" 2>/dev/null || true',
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
