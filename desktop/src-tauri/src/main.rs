// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

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

/// Real hardware detection — the thing a browser can't do. Uses sysinfo for
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

    // 2) macOS — Apple Silicon shares memory (unified, no separate VRAM).
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

    // 3) Windows fallback — GPU name via wmic (no reliable VRAM).
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
/// (it already generates the exact setup) and prompts for secrets in-memory —
/// nothing is persisted by this app.
#[tauri::command]
fn run_command_streamed(app: AppHandle, command: String) -> Result<(), String> {
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "windows") {
        ("powershell", vec!["-NoProfile", "-Command", &command])
    } else {
        ("bash", vec!["-lc", &command])
    };

    let mut child = Command::new(program)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let app2 = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app2.emit("setup-log", line);
        }
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
        .invoke_handler(tauri::generate_handler![detect_hardware, run_command_streamed])
        .run(tauri::generate_context!())
        .expect("error while running LightNode");
}
