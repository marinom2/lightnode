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
const INSTALLER_REV = "2026-05-28.12";

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
AWAKE="$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist"
if [ -f "$HOME/.lightnode/keep-online.paused" ]; then
  log "paused by user - leaving worker as-is, allowing the machine to sleep"
  [ "$(uname -s)" = "Darwin" ] && launchctl unload "$AWAKE" 2>/dev/null || true
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
docker info >/dev/null 2>&1 || { log "docker still down - retry next tick"; exit 0; }
if docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then
  docker ps --format '{{.Names}}' | grep -q '^lightchain-worker$' || { log "worker stopped - starting"; docker start lightchain-worker >/dev/null 2>&1 && log "worker started"; }
fi
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
if ! docker info >/dev/null 2>&1; then
  echo "▶ starting the Docker engine"
  if [ "$OS" = "Darwin" ]; then open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true;
  else sudo systemctl start docker 2>/dev/null || systemctl --user start docker-desktop 2>/dev/null || true; fi
fi

# 3) Wait for Docker (the slow one) with a one-time clean relaunch for the macOS
# half-state, then Ollama (which booted in parallel, so this is usually instant).
echo "… waiting for the Docker engine (a cold start - e.g. right after 'Free up memory' - can take 1-2 min; approve any Docker permission dialog if it appears)"
for i in $(seq 1 120); do
  docker info >/dev/null 2>&1 && break
  # macOS half-state: the GUI is open but the engine never started (common right
  # after 'Free up memory' quit Docker, where a plain 'open' is a no-op). If still
  # down at ~90s, relaunch it cleanly once - a normal cold boot is up well before then.
  if [ "$OS" = "Darwin" ] && [ "$i" = "45" ] && ! docker info >/dev/null 2>&1 && pgrep -x "Docker Desktop" >/dev/null 2>&1; then
    echo "▶ Docker is open but its engine hasn't come up - relaunching it..."
    osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true; sleep 2; pkill -x "Docker Desktop" >/dev/null 2>&1 || true; sleep 3
    open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
  fi
  [ $((i % 15)) -eq 0 ] && echo "… still waiting for Docker ($((i * 2))s elapsed)"
  sleep 2
done
docker info >/dev/null 2>&1 || { echo "⛔ Docker engine didn't come up. Open Docker Desktop manually (approve any permission prompt), wait for the whale icon in the menu bar to settle, then run install again."; exit 1; }
echo "✓ Docker engine ready"
echo "… waiting for Ollama on 127.0.0.1:11434"
for _ in $(seq 1 30); do curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || { echo "⛔ Ollama isn't responding on 127.0.0.1:11434 - open the Ollama app (or run 'ollama serve'), then re-run."; exit 1; }
echo "✓ Ollama server running"

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
  const list = models.length ? models : [DEFAULT_MODEL];
  const supported = list.join(","); // SUPPORTED_MODELS the worker advertises
  const shellList = list.map((m) => `"${m}"`).join(" "); // for `for M in ...` loops
  return [
    "set -e",
    "exec 2>&1", // surface stderr (git clone, cast, etc.) in the streamed log
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
    // The toolkit prints a hardcoded "STAKE 50,000 LCAI" line, but the real stake
    // is read live from AIConfig at register time (the binary logs the actual
    // amount). Don't assert a number ourselves - just say "the network minimum" so
    // it's honest on every network without baking in a value that could drift.
    `sed -i.bak "s/STAKE 50,000 LCAI/STAKE the network minimum/g" 07-register.sh && rm -f 07-register.sh.bak`,
    `echo "▶ funding worker: send to $WORKER_ADDR"`,
    // This machine runs ONE worker container at a time. If a container for THIS
    // network is already running, nothing to do. If it's for a DIFFERENT network,
    // the user explicitly chose to install this one, so stop the other and carry
    // on (phase 08 removes + recreates it). Its stake + per-network keystore are
    // intact, so a later reinstall of that network brings it right back.
    `if docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -qE '^lightchain-worker Up'; then RUNCHAIN="$(docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^CHAIN_ID=' | head -1 | cut -d= -f2)"; if [ -n "$RUNCHAIN" ] && [ "$RUNCHAIN" != "${chainId}" ]; then echo "▶ a worker for the other network (chain $RUNCHAIN) is running; this machine runs one at a time. Stopping it to install ${network} (chain ${chainId}). Its stake + keys stay intact - reinstall that network to bring it back."; docker stop lightchain-worker >/dev/null 2>&1 || true; else echo "✓ worker already running on ${network} - nothing to reinstall"; echo "✅ worker online"; exit 0; fi; fi`,
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
    `for p in ${DESKTOP_PHASES}; do if [ "$p" = "04-import-key" ] && [ "$SKIP_IMPORT" = "1" ]; then echo "▶ phase 04-import-key (skipped - key already present)"; continue; fi; if [ "$p" = "07-register" ]; then ST="$(WORKER_PASSWORD="$WORKER_PASSWORD" "$RUNBASH" status.sh 2>&1 || true)"; if printf '%s\\n' "$ST" | grep -qi "registered" && ! printf '%s\\n' "$ST" | grep -qiE "not[ _-]*registered"; then echo "▶ phase 07-register (skipped - already registered on-chain; stake stays locked, no re-funding needed)"; continue; fi; fi; echo "▶ phase $p"; FORCE=1 "$RUNBASH" "$p.sh" || { echo "⛔ stopped at $p"; exit 1; }; done`,
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
  const phases = DESKTOP_PHASES.split(" ").map((p) => `.\\${p}.ps1`).join("','");
  const list = models.length ? models : [DEFAULT_MODEL];
  const supported = list.join(",");
  const psList = "@(" + list.map((m) => `'${m}'`).join(",") + ")";
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
# Keep-online watchdog: auto-start Docker + the worker on a schedule (survives reboot).
try {
  $ko = Join-Path $env:USERPROFILE ".lightnode\\keep-online.ps1"
@'
if (Test-Path (Join-Path $env:USERPROFILE ".lightnode\keep-online.paused")) { exit 0 }
docker info *> $null
if (-not $?) { Start-Process "Docker Desktop" -ErrorAction SilentlyContinue; for ($i=0;$i -lt 45;$i++){ docker info *> $null; if($?){break}; Start-Sleep 2 } }
docker info *> $null; if (-not $?) { exit 0 }
if ((docker ps -a --format "{{.Names}}") -match "^lightchain-worker$") { if (-not ((docker ps --format "{{.Names}}") -match "^lightchain-worker$")) { docker start lightchain-worker | Out-Null } }
$ms = Get-Content (Join-Path $env:USERPROFILE ".lightnode\model") -ErrorAction SilentlyContinue
foreach ($m in $ms) { if ($m) { try { Invoke-RestMethod -Uri http://127.0.0.1:11434/api/generate -Method Post -TimeoutSec 5 -Body "{\`"model\`":\`"$m\`",\`"prompt\`":\`"ok\`",\`"keep_alive\`":-1,\`"stream\`":false}" *> $null } catch {} } }
'@ | Set-Content -Path $ko -Encoding ASCII
  schtasks /Create /TN "LightChainWorkerWatchdog" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$ko\`"" /SC MINUTE /MO 10 /F | Out-Null
  Write-Host "✓ keep-online watchdog active (Scheduled Task, every 10 min)"
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
# The toolkit prints a hardcoded "STAKE 50,000 LCAI" line, but the real stake is
# read live from AIConfig at register time. Don't assert a number - just say "the
# network minimum" so it's honest on every network.
if (Test-Path 07-register.ps1) { (Get-Content 07-register.ps1) -replace 'STAKE 50,000 LCAI', 'STAKE the network minimum' | Set-Content 07-register.ps1 }
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
  else { Write-Host "▶ backing up a previous worker keystore (not deleting)"; Move-Item $ks "$ks.bak-$((Get-Date).Ticks)" }
}
# Stale ECDH key (different worker / old password) → back up so phase 05 regenerates.
$keysDir = Join-Path $env:USERPROFILE "lightchain-worker\\keys-${network}"
$enc = Join-Path $keysDir "worker-encryption.key"
$sess = Join-Path $keysDir "session-keys.enc"
$marker = Join-Path $keysDir ".lightnode-worker"
$waddr = ($env:WORKER_ADDR -replace '^0x','').ToLower()
if ((Get-Content $marker -ErrorAction SilentlyContinue) -ne $waddr) { foreach ($f in @($enc, $sess)) { if (Test-Path $f) { Write-Host "▶ backing up old worker state: $(Split-Path $f -Leaf)"; Move-Item $f "$f.bak-$((Get-Date).Ticks)" } } }
if ((Test-Path $sess) -and (Test-Path $enc) -and ((Get-Item $sess).LastWriteTime -lt (Get-Item $enc).LastWriteTime)) { Write-Host "▶ stale session store - backing it up"; Move-Item $sess "$sess.bak-$((Get-Date).Ticks)" }
New-Item -ItemType Directory -Force -Path $keysDir | Out-Null
Set-Content -Path $marker -Value $waddr
$env:FORCE = "1"
foreach ($p in @('${phases}')) { if (($p -like '*04-import-key*') -and $skipImport) { Write-Host "▶ phase 04-import-key (skipped - key present)"; continue }; if ($p -like '*07-register*') { $st = (& .\\status.ps1 2>$null | Out-String); if (($st -match 'REGISTERED') -and ($st -notmatch 'NOT[ _-]*REGISTERED')) { Write-Host "▶ phase 07-register (skipped - already registered on-chain; stake stays locked, no re-funding needed)"; continue } }; Write-Host "▶ phase $p"; & $p; if ($LASTEXITCODE -ne 0) { Write-Host "⛔ stopped at $p"; exit 1 } }
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
    // Derive the worker key from the on-disk keystore - the authoritative source
    // for the worker actually installed here. Only when the app didn't already
    // hand us a matching key (the in-browser path passes one).
    'if [ -z "${WORKER_PRIVKEY:-}" ] && [ -n "$KS_NAME" ]; then',
    // Make sure Docker is reachable so we can read the container\'s keystore
    // password (authoritative for this keystore). Soft - never fatal.
    '  if ! docker info >/dev/null 2>&1; then for s in "$HOME/.docker/run/docker.sock" "/var/run/docker.sock" "$HOME/.colima/default/docker.sock" "$HOME/.rd/docker.sock"; do [ -S "$s" ] && DOCKER_HOST="unix://$s" docker info >/dev/null 2>&1 && { export DOCKER_HOST="unix://$s"; break; }; done; fi',
    '  if ! docker info >/dev/null 2>&1; then open -a Docker >/dev/null 2>&1 || true; for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done; fi',
    "  PW_CT=\"$(docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^WORKER_KEYSTORE_PASSWORD=' | head -1 | cut -d= -f2-)\"",
    // Try the container password first (always matches the on-disk keystore),
    // then any app-supplied password as a fallback. Use whichever decrypts.
    '  for PW in "$PW_CT" "${WORKER_PASSWORD:-}"; do',
    '    [ -z "$PW" ] && continue',
    "    K=\"$(cast wallet decrypt-keystore \"$KS_NAME\" --keystore-dir \"$KS_DIR\" --unsafe-password \"$PW\" 2>/dev/null | grep -oE '0x[0-9a-fA-F]{64}' | head -1)\"",
    '    if [ -n "$K" ]; then export WORKER_PRIVKEY="$K"; export WORKER_PASSWORD="$PW"; break; fi',
    "  done",
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
    'echo "✓ decode: $TOKS tok/s · prefill: $PREFILL tok/s · cold load: ${LOADS}s"',
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
    'if (-not $env:WORKER_PRIVKEY -and $ks) {',
    // Container password first (authoritative for this keystore), app password as fallback.
    "  $pwCt = (docker inspect lightchain-worker --format '{{range .Config.Env}}{{println .}}{{end}}' 2>$null | Select-String '^WORKER_KEYSTORE_PASSWORD=(.+)$' | Select-Object -First 1).Matches.Groups[1].Value",
    '  foreach ($pw in @($pwCt, $env:WORKER_PASSWORD)) {',
    '    if (-not $pw) { continue }',
    "    $pk = ((cast wallet decrypt-keystore $ks.Name --keystore-dir $ksDir --unsafe-password $pw 2>$null) | Select-String -Pattern '0x[0-9a-fA-F]{64}' | Select-Object -First 1).Matches.Value",
    '    if ($pk) { $env:WORKER_PRIVKEY = $pk; $env:WORKER_PASSWORD = $pw; break }',
    '  }',
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
  return [
    `$RPC_URL = "${net.rpc}"; $JOBREG = "${net.jobRegistry}"`,
    `foreach ($j in @(${jobIds.join(",")})) {`,
    '  cast call $JOBREG "releaseJob(uint256)" $j --rpc-url $RPC_URL *> $null',
    '  if (-not $?) { Write-Host "job $j still in its release window (try again later)"; continue }',
    '  if (-not $env:WORKER_PRIVKEY) { Write-Host "job $j is ready but there is no worker key to sign with"; continue }',
    '  $e = (cast send $JOBREG "releaseJob(uint256)" $j --private-key $env:WORKER_PRIVKEY --rpc-url $RPC_URL 2>&1)',
    '  if ($?) { Write-Host "settled job $j" } else { Write-Host "job $j is ready but the release tx failed: $e" }',
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
    '  elif cast send "$JOBREG" "withdraw()" --private-key "$WORKER_PRIVKEY" --rpc-url "$RPC_URL" >/dev/null 2>&1; then echo "  ✓ claimed $(cast from-wei "$EARNED_DEC") LCAI of earnings into your worker wallet"; ',
    '  else echo "  ⛔ earnings claim tx failed - try again"; fi',
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
    '  if ($earnedDec -and $earnedDec -ne "0") {',
    '    if (-not $env:WORKER_PRIVKEY) { Write-Host "earnings claimable but no worker key to sign with" }',
    '    elseif ((cast send $JOBREG "withdraw()" --private-key $env:WORKER_PRIVKEY --rpc-url $RPC_URL *> $null) -or $?) { Write-Host "claimed $(cast from-wei $earnedDec) LCAI of earnings into your worker wallet" }',
    '    else { Write-Host "earnings claim tx failed - try again" }',
    '  } else { Write-Host "no unclaimed earnings sitting in the job registry" }',
    '}',
  ];
}

/**
 * Settle the worker's completed jobs AND claim the resulting earnings into the
 * worker wallet. Releasing a job only credits an internal JobRegistry balance;
 * `withdraw()` moves it to the wallet - so we always do both. `jobIds` are the
 * worker's Completed (unreleased) jobs, looked up from the subgraph by the app.
 */
export function settleJobsCommand(os: OS, network: NetworkId, jobIds: number[]): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      ...keystoreDeriveWin(),
      'Write-Host "settling completed jobs + claiming your rewards"',
      ...releaseJobsWin(network, jobIds),
      ...claimEarningsWin(network),
    ].join("\n");
  }
  return [
    "exec 2>&1",
    ...keystoreDeriveUnix(),
    'echo "▶ settling completed jobs + claiming your rewards"',
    ...releaseJobsUnix(network, jobIds),
    ...claimEarningsUnix(network),
  ].join("\n");
}

/**
 * Deregister + withdraw stake. First auto-settles any releasable completed jobs
 * (they block deregistration until released), then runs the toolkit deregister,
 * and only on real success tears down the watchdog + reports. Per-network.
 */
export function deregisterCommand(os: OS, network: NetworkId, jobIds: number[] = []): string {
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      // Bring the Docker engine up before deregister (it runs a docker container),
      // so one click completes instead of just starting Docker on the first pass.
      'docker info *> $null; if (-not $?) { Write-Host "> starting Docker Desktop..."; Start-Process "Docker Desktop" -ErrorAction SilentlyContinue; for ($i=0; $i -lt 45; $i++) { docker info *> $null; if ($?) { break }; Start-Sleep 2 } }',
      'docker info *> $null; if (-not $?) { Write-Host "Cannot reach Docker. Open Docker Desktop once, then try again."; exit 1 }',
      'Set-Location "$env:USERPROFILE\\.lightnode\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null',
      ...keystoreDeriveWin(),
      'Write-Host "settling completed jobs + claiming rewards before deregister..."',
      ...releaseJobsWin(network, jobIds),
      ...claimEarningsWin(network),
      '$env:FORCE = "1"',
      'if (-not (Test-Path .\\deregister.ps1)) { Write-Host "toolkit not found - install the worker first"; exit 1 }',
      '.\\deregister.ps1',
      'if ($LASTEXITCODE -eq 0) {',
      '  New-Item -ItemType File -Force -Path "$env:USERPROFILE\\.lightnode\\keep-online.paused" | Out-Null',
      '  schtasks /Delete /TN "LightChainWorkerWatchdog" /F *> $null',
      '  docker stop lightchain-worker *> $null',
      '  Write-Host "deregistered - stake returned to the worker wallet; worker stopped + watchdog removed. Use Withdraw Funds to send the stake out; you can now install on another network directly."',
      '} else {',
      '  Write-Host "deregister did not complete - see the error just above. Your stake is safe and still registered. The usual cause is completed jobs still inside their release window; retry once they settle."',
      '  exit 1',
      '}',
    ].join("\n");
  }
  return [
    // Ensure the Docker engine is fully up FIRST (with the half-state recovery +
    // wait). deregister.sh runs `invoke_worker deregister` as a `docker run`, so
    // without this a single click would only start Docker and the deregister step
    // would fail on that pass, forcing a second click.
    dockerEnvPreambleUnix(),
    'export PATH="$HOME/.foundry/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
    'TK="$HOME/.lightnode/lightchain-worker-toolkit/scripts/bash"; [ -d "$TK" ] || TK="$HOME/lightchain-worker-toolkit/scripts/bash"',
    'cd "$TK" 2>/dev/null || { echo "⛔ toolkit not found - install the worker first."; exit 1; }',
    'if bash -c "declare -A _t" 2>/dev/null; then RB=bash; else RB="$(brew --prefix 2>/dev/null)/bin/bash"; fi',
    ...keystoreDeriveUnix(),
    // Settle releasable completed jobs first - they gate deregistration - and
    // claim the earnings into the wallet so nothing is stranded in the registry.
    'echo "▶ settling completed jobs + claiming rewards before deregister..."',
    ...releaseJobsUnix(network, jobIds),
    ...claimEarningsUnix(network),
    'if echo deregister | FORCE=1 "$RB" deregister.sh; then',
    '  touch "$HOME/.lightnode/keep-online.paused"',
    '  launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true',
    '  rm -f "$HOME/Library/LaunchAgents/ai.lightchain.worker-watchdog.plist" 2>/dev/null || true',
    `  ( crontab -l 2>/dev/null | grep -v 'lightnode/keep-online.sh' ) | crontab - 2>/dev/null || true`,
    // Done with this worker - stop holding the machine awake and remove the agent.
    '  launchctl unload "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; rm -f "$HOME/Library/LaunchAgents/ai.lightchain.worker-awake.plist" 2>/dev/null || true; pkill -f "systemd-inhibit.*lightnode-awake" 2>/dev/null || true',
    // Stop the now-pointless container so this network's worker slot is free -
    // a deregistered worker can't earn, and the next install (e.g. mainnet)
    // refuses to run while a DIFFERENT-network container is still up.
    '  docker stop lightchain-worker >/dev/null 2>&1 || true',
    '  echo "✓ deregistered - stake returned to the worker wallet; worker stopped + watchdog removed. Use Withdraw Funds to send the stake out; you can now install on another network directly."',
    'else',
    '  echo "⛔ deregister did not complete - see the error just above. Your stake is SAFE and the worker is still registered. The usual cause is completed jobs still inside their release window; retry once they settle (a few hours)."',
    '  exit 1',
    'fi',
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
  if (os === "windows") {
    return [
      '$ErrorActionPreference = "Continue"',
      'Set-Location "$env:USERPROFILE\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null; Set-Location "$env:USERPROFILE\\.lightnode\\lightchain-worker-toolkit\\scripts\\powershell" 2>$null',
      ...keystoreDeriveWin(),
      'if (-not $env:WORKER_PASSWORD) { Write-Host "couldn\'t unlock the worker keystore (need its password) - reinstall and retry."; exit 1 }',
      // KEYS_DIR was set by the keystore derivation to the matched per-network dir.
      `$env:NETWORK = "${network}"; $env:SUPPORTED_MODELS = "${supported}"`,
      `Write-Host "adding model(s) on-chain: ${modelsToAdd.join(", ")} (no re-stake)..."`,
      '. .\\common.ps1; Invoke-Worker -Subcommand "add-models"; if ($LASTEXITCODE -ne 0) { Write-Host "add-models failed - see above"; exit 1 }',
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
    `export NETWORK=${network} SUPPORTED_MODELS=${supported}`,
    `echo "▶ adding model(s) on-chain: ${modelsToAdd.join(", ")} (no re-stake)..."`,
    // Stop the container after a successful add so the follow-up reinstall actually
    // recreates it with the new model set (the install short-circuits on a
    // same-network worker that's still Up).
    `if "$RB" -c 'source ./common.sh && invoke_worker add-models'; then echo "✓ added on-chain - restarting the worker with the new set"; docker stop lightchain-worker >/dev/null 2>&1 || true; else echo "⛔ add-models failed - see the error above"; exit 1; fi`,
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
    `if ! docker ps -a --format '{{.Names}}' | grep -q '^lightchain-worker$'; then echo "⛔ No lightchain-worker container found - install one first."; exit 1; fi`,
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
