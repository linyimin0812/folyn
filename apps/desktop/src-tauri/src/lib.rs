mod commands;

use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

/// Try to find `node` on the current PATH.
fn which_node_from_path() -> Option<String> {
    let path_var = std::env::var("PATH").ok()?;
    for dir in path_var.split(':') {
        let candidate = Path::new(dir).join("node");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

/// Resolve the default nvm node binary from ~/.nvm.
fn resolve_nvm_node() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let nvm_dir = Path::new(&home).join(".nvm").join("versions").join("node");
    if !nvm_dir.exists() {
        return None;
    }
    // Find the latest installed node version
    let mut versions: Vec<_> = std::fs::read_dir(&nvm_dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    versions.sort();
    let latest = versions.last()?;
    let node_bin = nvm_dir.join(latest).join("bin").join("node");
    if node_bin.exists() {
        Some(node_bin.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Global sidecar PID, set during setup and killed after the event loop exits.
static SIDECAR_PID: AtomicU32 = AtomicU32::new(0);

/// Kill the sidecar process by PID using the `kill` command.
fn kill_sidecar() {
    let pid = SIDECAR_PID.load(Ordering::SeqCst);
    if pid != 0 {
        println!("[Quill] Killing sidecar (pid: {})", pid);
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Build a custom menu without the default Edit menu (Undo/Redo/Cut/Copy/Paste).
            // The default macOS Edit menu intercepts Cmd+Z/Cmd+Shift+Z and triggers
            // native WebView undo/redo, which conflicts with CodeMirror's history plugin.
            // By providing a minimal menu, all keyboard shortcuts are passed directly
            // to the WebView and handled by CodeMirror.
            let app_menu = SubmenuBuilder::new(app, "Quill")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .separator()
                .fullscreen()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            // Open DevTools for debugging
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            // Locate quill-api-bundle:
            // 1. Production: next to the executable (Contents/MacOS/quill-api-bundle/)
            // 2. Development: in src-tauri/binaries/quill-api-bundle/
            let exe_path = std::env::current_exe()
                .expect("failed to get current exe path");
            let exe_dir = exe_path.parent()
                .expect("failed to get exe directory");

            let bundle_dir = {
                // Production: Tauri copies resources preserving the relative path structure.
                // "binaries/quill-api-bundle/**/*" lands at Contents/Resources/binaries/quill-api-bundle/
                // exe is at Contents/MacOS/quill → ../Resources/binaries/quill-api-bundle/
                let resources_dir = exe_dir
                    .join("..").join("Resources")
                    .join("binaries").join("quill-api-bundle");
                let candidate = if resources_dir.join("dist").join("index.js").exists() {
                    resources_dir
                } else {
                    // Dev fallback: exe is at target/debug/quill, go up to src-tauri/ then into binaries/
                    exe_dir.join("..").join("..").join("binaries").join("quill-api-bundle")
                };
                // Canonicalize to resolve any ".." components and symlinks,
                // so import.meta.url in the ESM bundle gets a clean absolute path.
                candidate.canonicalize().unwrap_or(candidate)
            };
            let main_js = bundle_dir.join("dist").join("index.js");

            if !main_js.exists() {
                eprintln!("[Quill] Sidecar not found at {:?}. Running without backend.", main_js);
                return Ok(());
            }

            println!("[Quill] Starting NestJS sidecar from: {:?}", main_js);

            // Resolve the full path to `node`.
            // Priority: .node-path (recorded at build time) > NODE_PATH_OVERRIDE > nvm > PATH > well-known paths.
            // Using the same node version as build time avoids NODE_MODULE_VERSION mismatch
            // with native addons like better-sqlite3.
            let node_bin = {
                // 1. Read the node path recorded during build-sidecar.sh
                let build_time_node = std::fs::read_to_string(bundle_dir.join(".node-path"))
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && Path::new(s).exists());

                let candidates = [
                    build_time_node,
                    std::env::var("NODE_PATH_OVERRIDE").ok(),
                    resolve_nvm_node(),
                    which_node_from_path(),
                    Some("/usr/local/bin/node".to_string()),
                    Some("/opt/homebrew/bin/node".to_string()),
                ];
                candidates.into_iter()
                    .flatten()
                    .find(|p| Path::new(p).exists())
                    .unwrap_or_else(|| "node".to_string())
            };

            println!("[Quill] Using node binary: {}", node_bin);

            // Spawn Node.js process to run the NestJS API
            let child = Command::new(&node_bin)
                .arg(&main_js)
                .current_dir(&bundle_dir)
                .spawn();

            match child {
                Ok(child) => {
                    let pid = child.id();
                    println!("[Quill] NestJS sidecar started (pid: {})", pid);
                    SIDECAR_PID.store(pid, Ordering::SeqCst);
                    std::mem::forget(child);
                }
                Err(err) => {
                    eprintln!("[Quill] Failed to start sidecar: {}. App will run without backend.", err);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::select_directory,
            commands::check_url,
            commands::create_webview,
            commands::navigate_webview,
            commands::close_webview,
            commands::set_webview_position,
            commands::hide_all_webviews,
            commands::on_webview_url_changed,
        ])
        .on_window_event(|_window, event| {
            // Kill sidecar when the main window is destroyed (closed)
            if let tauri::WindowEvent::Destroyed = event {
                kill_sidecar();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    kill_sidecar();
                }
                _ => {}
            }
        });
}
