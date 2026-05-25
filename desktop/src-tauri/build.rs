fn main() {
    // Declare our app commands so Tauri generates `allow-*` ACL permissions for
    // them. Without this, invoking them from the hosted (remote) UI is rejected
    // with "Command <name> not allowed by ACL". The capability then grants these.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["detect_hardware", "run_command_streamed"]),
        ),
    )
    .expect("failed to run tauri-build");
}
