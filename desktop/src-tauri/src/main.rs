// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// OS keychain namespace for LightNode secrets (the worker key + keystore
/// password). Stored natively so the remote web UI never has to persist them.
const KEYCHAIN_SERVICE: &str = "ai.lightchain.lightnode";

fn keychain(name: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

/// Store a secret in the OS keychain.
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    keychain(&name)?.set_password(&value).map_err(|e| e.to_string())
}

/// Read a secret from the OS keychain (None when absent).
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    match keychain(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a secret from the OS keychain (ok if it was already absent).
#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match keychain(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Generate a fresh worker key natively (secp256k1), store the PRIVATE key in
/// the keychain under `name`, and return ONLY the public Ethereum address. The
/// raw key never crosses into the web layer - the most private generation path.
#[tauri::command]
fn generate_worker_key(name: String) -> Result<String, String> {
    use k256::ecdsa::SigningKey;
    use sha3::{Digest, Keccak256};

    let sk = SigningKey::random(&mut rand::rngs::OsRng);
    let priv_hex = format!("0x{}", hex::encode(sk.to_bytes()));

    // Ethereum address = last 20 bytes of keccak256(uncompressed pubkey[1..]).
    let point = sk.verifying_key().to_encoded_point(false);
    let pub_bytes = &point.as_bytes()[1..]; // drop the 0x04 SEC1 prefix -> 64 bytes
    let hash = Keccak256::digest(pub_bytes);
    let address = format!("0x{}", hex::encode(&hash[12..]));

    keychain(&name)?.set_password(&priv_hex).map_err(|e| e.to_string())?;
    Ok(address)
}

#[derive(Serialize, Clone)]
struct Hardware {
    os: String,
    cores: usize,
    ram_gb: u64,
    gpu: String,
    /// VRAM in GB when discoverable (None for Apple Silicon unified memory / unknown).
    vram_gb: Option<u64>,
    unified: bool,
}

/// Real hardware detection - the thing a browser can't do. Uses sysinfo for
/// CPU/RAM and platform tools for the GPU.
#[tauri::command]
fn detect_hardware() -> Hardware {
    let mut sys = sysinfo::System::new_all();
    sys.refresh_all();

    let cores = sys.cpus().len();
    let ram_gb = sys.total_memory() / 1024 / 1024 / 1024; // bytes -> GiB

    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
    .to_string();

    let (gpu, vram_gb, unified) = detect_gpu();

    Hardware { os, cores, ram_gb, gpu, vram_gb, unified }
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new(cmd);
    c.args(args);
    sanitize_appimage_env(&mut c);
    let out = c.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Strip the AppImage's bundled-library paths from a child process's environment.
///
/// When the app runs as an AppImage, its runtime exports `LD_LIBRARY_PATH` (and
/// friends) pointing at the bundle's own libs. Any SYSTEM tool we shell out to
/// (curl, docker, git, cast, lspci) then loads those bundled libs instead of the
/// system ones and crashes - e.g. the system `curl` picks up the AppImage's newer
/// libcurl against the system's older libnghttp2: "undefined symbol:
/// nghttp2_option_set_no_rfc9113_...". Children must run in the host's library
/// environment, so we remove only the bundle-prefixed entries (preserving any the
/// user set). No-op when not inside an AppImage / not on Linux.
fn sanitize_appimage_env(cmd: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        let appdir = match std::env::var("APPDIR") {
            Ok(d) if !d.is_empty() => d,
            _ => return, // not running from an AppImage - nothing to clean
        };
        // Colon-separated search paths the AppImage runtime prepends to.
        const PATH_VARS: &[&str] = &[
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "GTK_PATH",
            "GIO_MODULE_DIR",
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            "GDK_PIXBUF_MODULE_FILE",
            "GDK_PIXBUF_MODULEDIR",
            "GSETTINGS_SCHEMA_DIR",
            "PYTHONPATH",
            "PYTHONHOME",
            "PERLLIB",
            "XDG_DATA_DIRS",
        ];
        for var in PATH_VARS {
            let Ok(val) = std::env::var(var) else { continue };
            let kept: Vec<&str> = val
                .split(':')
                .filter(|p| !p.is_empty() && !p.starts_with(appdir.as_str()))
                .collect();
            if kept.is_empty() {
                cmd.env_remove(var);
            } else {
                cmd.env(var, kept.join(":"));
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = cmd;
}

fn detect_gpu() -> (String, Option<u64>, bool) {
    // 1) NVIDIA (Linux / Windows / Linux-on-cloud) via nvidia-smi.
    if let Some(o) = run("nvidia-smi", &["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]) {
        if let Some(line) = o.lines().next() {
            let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
            if !parts.is_empty() {
                let name = parts[0].to_string();
                let vram = parts.get(1).and_then(|m| m.parse::<u64>().ok()).map(|mb| (mb + 512) / 1024);
                return (name, vram, false);
            }
        }
    }

    // 2) macOS - Apple Silicon shares memory (unified, no separate VRAM).
    #[cfg(target_os = "macos")]
    if let Some(o) = run("system_profiler", &["SPDisplaysDataType"]) {
        let name = o
            .lines()
            .find(|l| l.contains("Chipset Model:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Apple GPU".to_string());
        let unified = name.contains("Apple");
        return (name, None, unified);
    }

    // 3) Windows fallback - GPU name via wmic (no reliable VRAM).
    #[cfg(target_os = "windows")]
    if let Some(o) = run("wmic", &["path", "win32_VideoController", "get", "name"]) {
        if let Some(name) = o.lines().nth(1) {
            let n = name.trim();
            if !n.is_empty() {
                return (n.to_string(), None, false);
            }
        }
    }

    // 4) Linux non-NVIDIA (AMD / Intel). nvidia-smi covered NVIDIA above; without
    //    this branch every AMD/Intel box read "Unknown GPU" with no VRAM. Name
    //    from lspci, VRAM from the amdgpu sysfs node (Intel iGPUs share system RAM
    //    and expose no VRAM total, so vram stays None there).
    #[cfg(target_os = "linux")]
    {
        let vram = linux_vram_gb();
        let name = linux_gpu_name();
        if vram.is_some() || name.is_some() {
            return (name.unwrap_or_else(|| "GPU".to_string()), vram, false);
        }
    }

    ("Unknown GPU".to_string(), None, false)
}

/// Total dedicated VRAM (GiB) for a Linux discrete GPU, read from the amdgpu
/// driver's sysfs node (bytes). Scans every cardN and takes the largest. Returns
/// None when no card exposes it (e.g. Intel iGPUs, which share system RAM).
#[cfg(target_os = "linux")]
fn linux_vram_gb() -> Option<u64> {
    use std::fs;
    let mut best: u64 = 0;
    for entry in fs::read_dir("/sys/class/drm").ok()?.flatten() {
        let fname = entry.file_name();
        let fname = fname.to_string_lossy();
        // Top-level cards only (cardN), not connector subdirs (cardN-HDMI-A-1).
        if !fname.starts_with("card") || fname.contains('-') {
            continue;
        }
        let path = entry.path().join("device/mem_info_vram_total");
        if let Ok(s) = fs::read_to_string(&path) {
            if let Ok(bytes) = s.trim().parse::<u64>() {
                best = best.max(bytes);
            }
        }
    }
    if best == 0 {
        return None;
    }
    // bytes -> GiB, rounded to nearest.
    Some((best + (1 << 29)) / (1 << 30))
}

/// Human GPU name on Linux via lspci (pciutils, present on ~every desktop).
/// Pulls the marketing name out of the display-controller line, e.g.
/// "...AMD/ATI Vega 20 [Radeon Pro VII] (rev 01)" -> "Radeon Pro VII".
#[cfg(target_os = "linux")]
fn linux_gpu_name() -> Option<String> {
    let out = run(
        "sh",
        &[
            "-c",
            "lspci 2>/dev/null | grep -iE 'vga compatible controller|3d controller|display controller' | head -1",
        ],
    )?;
    let line = out.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    let mut after = line.splitn(2, ": ").nth(1).unwrap_or(line).trim().to_string();
    if let Some(i) = after.rfind(" (rev ") {
        after.truncate(i);
    }
    // Prefer the marketing name in the final [..] if present.
    if let (Some(a), Some(b)) = (after.rfind('['), after.rfind(']')) {
        if b > a + 1 {
            return Some(after[a + 1..b].trim().to_string());
        }
    }
    Some(after)
}

/// Runs a shell command and streams its output to the webview as `setup-log`
/// events, finishing with `setup-exit { code }`. The web UI builds the command
/// (it already generates the exact setup); secrets are passed via `env` (process
/// environment), never baked into the command string or persisted by this app.
#[tauri::command]
fn run_command_streamed(
    app: AppHandle,
    command: String,
    env: Option<HashMap<String, String>>,
    secret_env: Option<Vec<String>>,
) -> Result<(), String> {
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "windows") {
        // -ExecutionPolicy Bypass so the toolkit's .ps1 phase scripts run on a
        // default Windows client (policy is Restricted there, which blocks .ps1
        // FILES). The install command also sets this process-scoped, so this is
        // belt-and-suspenders for older web bundles.
        (
            "powershell",
            vec![
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &command,
            ],
        )
    } else {
        ("bash", vec!["-lc", &command])
    };

    // Merge plain env with secrets pulled from the keychain by NAME - so the web
    // UI can run a command that needs the worker key/password without ever
    // holding their values (it passes only the secret names).
    let mut envs = env.unwrap_or_default();
    if let Some(names) = secret_env {
        for n in names {
            if let Ok(Some(val)) = secret_get(n.clone()) {
                envs.insert(n, val);
            }
        }
    }

    let mut cmd = Command::new(program);
    cmd.args(&args)
        .envs(envs)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Run children in the host library environment, not the AppImage's bundled
    // one - otherwise system curl/docker/git load mismatched bundled libs and
    // crash (the libcurl/libnghttp2 undefined-symbol failure on Linux AppImages).
    sanitize_appimage_env(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // Drain stderr on its own thread and emit it as the same `setup-log` events.
    // The installer writes real diagnostics there (PowerShell terminating errors,
    // cast/RPC failures, the toolkit's `throw` messages, bash `set -e` aborts). If
    // we pipe stderr but never read it, those lines are lost - a failed phase looks
    // like a silent stop with no cause - and a full pipe buffer can stall the child.
    let app_err = app.clone();
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit("setup-log", line);
        }
    });

    let app2 = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app2.emit("setup-log", line);
        }
        // Flush all stderr to the UI before reporting the exit code.
        let _ = stderr_thread.join();
        match child.wait() {
            Ok(status) => {
                let _ = app2.emit("setup-exit", status.code().unwrap_or(-1));
            }
            Err(e) => {
                let _ = app2.emit("setup-log", format!("error: {e}"));
                let _ = app2.emit("setup-exit", -1);
            }
        }
    });

    Ok(())
}

/// Show a native OS notification (Notification Center / Action Center / libnotify).
/// Used to alert the operator about stuck jobs / claimable rewards / out-of-gas
/// while the app is open but not focused - the same conditions the Action Center
/// surfaces. Best-effort: a failed notification never breaks the caller.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            run_command_streamed,
            secret_set,
            secret_get,
            secret_delete,
            generate_worker_key,
            notify
        ])
        .run(tauri::generate_context!())
        .expect("error while running LightNode");
}
