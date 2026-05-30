// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

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
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
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

    ("Unknown GPU".to_string(), None, false)
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

    let mut child = Command::new(program)
        .args(&args)
        .envs(envs)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            run_command_streamed,
            secret_set,
            secret_get,
            secret_delete,
            generate_worker_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running LightNode");
}
