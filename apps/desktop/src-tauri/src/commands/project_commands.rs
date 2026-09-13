use crate::errors::AppError;

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use notify::{Watcher, RecursiveMode, Event};
use tauri::Emitter;

/// Signal flag the background watcher thread polls. Set by stop_vault_watcher
/// so the thread exits its event-pump loop and drops the notify watcher.
static WATCHER_STOP: AtomicBool = AtomicBool::new(false);

/// Serialized event shape sent to the webview via `app://vault-watcher-event`.
/// Mirrors the JS `WatchEvent` the old extension-fs watcher delivered, so the
/// frontend handler doesn't change.
#[derive(serde::Serialize, Clone)]
pub struct WatcherEventPayload {
    #[serde(rename = "type")]
    pub event_type: String,
    pub paths: Vec<String>,
}

/// Start a recursive file watcher on a background thread. Returns immediately —
/// the heavy notify setup (registering inotify/FSEvents for the entire tree)
/// happens on a spawned thread, never blocking the IPC channel. Events are
/// emitted to the webview via `app://vault-watcher-event`. A subsequent call
/// (or `stop_vault_watcher`) stops the previous watcher first.
#[tauri::command]
pub async fn start_vault_watcher(
    app: tauri::AppHandle,
    root: String,
) -> Result<(), AppError> {
    stop_vault_watcher();

    WATCHER_STOP.store(false, Ordering::Relaxed);
    let app_handle = app.clone();
    let base_path = root.clone();

    thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[vault-watcher] failed to create watcher: {e}");
                return;
            }
        };

        // Recursive watch — this is the expensive call that used to block IPC.
        // On a background thread it doesn't matter.
        if let Err(e) = watcher.watch(std::path::Path::new(&base_path), RecursiveMode::Recursive) {
            eprintln!("[vault-watcher] failed to watch {base_path}: {e}");
            return;
        }

        // Pump events to the webview until stopped.
        while !WATCHER_STOP.load(Ordering::Relaxed) {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(Ok(event)) => {
                    let event_type = format!("{:?}", event.kind);
                    let _ = app_handle.emit("app://vault-watcher-event", WatcherEventPayload {
                        event_type,
                        paths: event.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
                    });
                }
                Ok(Err(e)) => {
                    eprintln!("[vault-watcher] event error: {e}");
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            }
        }

        // Drop the watcher to stop watching.
        drop(watcher);
    });

    Ok(())
}

/// Stop the active vault watcher (if any). Returns immediately.
#[tauri::command]
pub fn stop_vault_watcher() {
    WATCHER_STOP.store(true, Ordering::Relaxed);
    // The background thread polls WATCHER_STOP every 200ms and exits its loop,
    // dropping the notify watcher.
}

/// Recursively scan a vault root in-process and return the full file tree
/// as a flat list of entries with vault-relative paths. Single IPC round-trip
/// replaces one-readDir-per-directory (plus one-stat-per-file) which made vault
/// add/switch crawl on large directories. `is_dir` is true for
/// directories; names are the final path segment. Dotfiles are included only
/// when `show_hidden` is true. `exclude` names are pruned during the walk
/// (directories AND files), so a `.git` / `node_modules` entry never gets
/// recursed into — this is what makes the scan fast on real repos (the prior
/// version shipped the entire `.git/objects` tree over IPC then dropped it in JS).
#[derive(serde::Serialize)]
pub struct FileTreeEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeEntry>>,
}

#[tauri::command]
pub async fn scan_file_tree(
    root: String,
    show_hidden: bool,
    exclude: Option<Vec<String>>,
) -> Result<Vec<FileTreeEntry>, AppError> {
    fn build(
        parent_abs: &std::path::Path,
        rel_prefix: &str,
        show_hidden: bool,
        exclude: &[String],
    ) -> Vec<FileTreeEntry> {
        let mut entries: Vec<_> = match std::fs::read_dir(parent_abs) {
            Ok(it) => it.filter_map(|e| e.ok()).collect(),
            Err(_) => return Vec::new(),
        };
        entries.sort_by_key(|e| e.file_name());
        let mut out = Vec::with_capacity(entries.len());
        for entry in entries {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().into_owned();
            if !show_hidden && name_str.starts_with('.') {
                continue;
            }
            if exclude.iter().any(|p| p == &name_str) {
                continue;
            }
            let path = if rel_prefix.is_empty() {
                name_str.clone()
            } else {
                format!("{}/{}", rel_prefix, name_str)
            };
            let is_dir = entry
                .file_type()
                .map(|ft| ft.is_dir())
                .unwrap_or(false);
            let children = if is_dir {
                Some(build(&entry.path(), &path, show_hidden, exclude))
            } else {
                None
            };
            out.push(FileTreeEntry {
                path,
                name: name_str,
                is_dir,
                children,
            });
        }
        out
    }
    let root_path = std::path::Path::new(&root);
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let exclude: Vec<String> = exclude.unwrap_or_default();
    Ok(build(root_path, "", show_hidden, &exclude))
}
