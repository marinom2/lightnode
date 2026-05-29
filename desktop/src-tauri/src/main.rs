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

fn keyring_entry(name: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

fn keyring_set(name: &str, value: &str) -> Result<(), String> {
    keyring_entry(name)?.set_password(value).map_err(|e| e.to_string())
}

fn keyring_get(name: &str) -> Result<Option<String>, String> {
    match keyring_entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn keyring_delete(name: &str) -> Result<(), String> {
    match keyring_entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// macOS data-protection keychain backed by a shared keychain-access-group. Items
/// here are readable, with NO per-app authorization prompt, by any binary signed
/// with our Team ID that carries the matching `keychain-access-groups` entitlement
/// - so the prompt no longer fires every time the app is rebuilt or updated. A
/// build WITHOUT the entitlement (unsigned dev binary) gets errSecMissingEntitlement
/// from these calls, which is the signal for the caller to fall back to `keyring`.
#[cfg(target_os = "macos")]
mod dp_keychain {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::CFData;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use core_foundation_sys::base::CFTypeRef;
    use core_foundation_sys::data::CFDataRef;
    use core_foundation_sys::string::CFStringRef;
    use security_framework_sys::base::{errSecDuplicateItem, errSecItemNotFound};
    use security_framework_sys::item::{
        kSecAttrAccessGroup, kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword,
        kSecReturnData, kSecUseDataProtectionKeychain, kSecValueData,
    };
    use security_framework_sys::keychain_item::{
        SecItemAdd, SecItemCopyMatching, SecItemDelete, SecItemUpdate,
    };
    use std::ptr;

    // The entitlement lists this exact group; the team prefix matches our signing
    // identity, so the OS grants prompt-free access to every binary we sign.
    const ACCESS_GROUP: &str = "84SJ6FKXLJ.ai.lightchain.lightnode";
    const SERVICE: &str = "ai.lightchain.lightnode";

    // Wrap a Security.framework static CFStringRef constant as a CFType (get rule
    // -> retained). Reading an extern static is unsafe; callers stay safe.
    fn stat(s: CFStringRef) -> CFType {
        unsafe { CFString::wrap_under_get_rule(s).as_CFType() }
    }

    // Class + service + account + access group + data-protection flag: the tuple
    // that uniquely identifies one item and routes it to the right keychain.
    fn identity(account: &str) -> Vec<(CFType, CFType)> {
        unsafe {
            vec![
                (stat(kSecClass), stat(kSecClassGenericPassword)),
                (stat(kSecAttrService), CFString::new(SERVICE).as_CFType()),
                (stat(kSecAttrAccount), CFString::new(account).as_CFType()),
                (stat(kSecAttrAccessGroup), CFString::new(ACCESS_GROUP).as_CFType()),
                (stat(kSecUseDataProtectionKeychain), CFBoolean::true_value().as_CFType()),
            ]
        }
    }

    pub fn get(account: &str) -> Result<Option<String>, i32> {
        let mut pairs = identity(account);
        pairs.push((stat(unsafe { kSecReturnData }), CFBoolean::true_value().as_CFType()));
        let query = CFDictionary::from_CFType_pairs(&pairs);
        let mut out: CFTypeRef = ptr::null();
        let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut out) };
        if status == errSecItemNotFound {
            return Ok(None);
        }
        if status != 0 {
            return Err(status);
        }
        if out.is_null() {
            return Ok(None);
        }
        let data = unsafe { CFData::wrap_under_create_rule(out as CFDataRef) };
        Ok(Some(String::from_utf8_lossy(data.bytes()).into_owned()))
    }

    pub fn set(account: &str, value: &str) -> Result<(), i32> {
        let mut add = identity(account);
        add.push((stat(unsafe { kSecValueData }), CFData::from_buffer(value.as_bytes()).as_CFType()));
        let dict = CFDictionary::from_CFType_pairs(&add);
        let status = unsafe { SecItemAdd(dict.as_concrete_TypeRef(), ptr::null_mut()) };
        if status == 0 {
            return Ok(());
        }
        if status == errSecDuplicateItem {
            let query = CFDictionary::from_CFType_pairs(&identity(account));
            let attrs = CFDictionary::from_CFType_pairs(&[(
                stat(unsafe { kSecValueData }),
                CFData::from_buffer(value.as_bytes()).as_CFType(),
            )]);
            let st = unsafe { SecItemUpdate(query.as_concrete_TypeRef(), attrs.as_concrete_TypeRef()) };
            return if st == 0 { Ok(()) } else { Err(st) };
        }
        Err(status)
    }

    pub fn delete(account: &str) -> Result<(), i32> {
        let query = CFDictionary::from_CFType_pairs(&identity(account));
        let status = unsafe { SecItemDelete(query.as_concrete_TypeRef()) };
        if status == 0 || status == errSecItemNotFound {
            Ok(())
        } else {
            Err(status)
        }
    }
}

/// Persist a secret. On macOS prefer the team-shared data-protection keychain (no
/// prompt for any binary we sign); fall back to `keyring` if that store is
/// unavailable (a build without the entitlement). Other OSes use `keyring`.
fn store_secret(name: &str, value: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if dp_keychain::set(name, value).is_ok() {
        return Ok(());
    }
    keyring_set(name, value)
}

/// Load a secret. On macOS read the data-protection keychain first; if the item
/// isn't there yet, read the legacy `keyring` once and copy it across, so existing
/// users migrate transparently and never get prompted again after that.
fn load_secret(name: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        match dp_keychain::get(name) {
            Ok(Some(v)) => return Ok(Some(v)),
            Ok(None) => {
                if let Ok(Some(v)) = keyring_get(name) {
                    let _ = dp_keychain::set(name, &v); // best-effort one-time migration
                    return Ok(Some(v));
                }
                return Ok(None);
            }
            Err(_) => {} // entitlement missing (dev build) - fall through to keyring
        }
    }
    keyring_get(name)
}

/// Remove a secret from every store it might live in.
fn remove_secret(name: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = dp_keychain::delete(name);
    }
    keyring_delete(name)
}

/// Store a secret in the OS keychain.
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    store_secret(&name, &value)
}

/// Read a secret from the OS keychain (None when absent).
#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    load_secret(&name)
}

/// Delete a secret from the OS keychain (ok if it was already absent).
#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    remove_secret(&name)
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

    store_secret(&name, &priv_hex)?;
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
        ("powershell", vec!["-NoProfile", "-Command", &command])
    } else {
        ("bash", vec!["-lc", &command])
    };

    // Merge plain env with secrets pulled from the keychain by NAME - so the web
    // UI can run a command that needs the worker key/password without ever
    // holding their values (it passes only the secret names).
    let mut envs = env.unwrap_or_default();
    if let Some(names) = secret_env {
        for n in names {
            if let Ok(Some(val)) = load_secret(&n) {
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

#[cfg(all(test, target_os = "macos"))]
mod dp_tests {
    use super::dp_keychain;

    // Read-only FFI smoke test: exercises the Security.framework call path and the
    // CoreFoundation wrapping without touching anything. On an unsigned test binary
    // this returns Err (missing entitlement); on a signed one, Ok(None) for an
    // unknown account. Either is fine - the point is it round-trips without crashing
    // (catches a bad CFRetain/CFRelease balance, which would abort the process).
    #[test]
    fn get_unknown_account_does_not_crash() {
        let r = dp_keychain::get("__lightnode_ffi_smoke_test__");
        assert!(r.is_err() || r == Ok(None));
    }
}
