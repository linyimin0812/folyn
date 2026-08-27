use crate::errors::AppError;

/// Removes the target directory first if it already exists (for re-cloning).
/// Includes network resilience configs for unstable connections.
#[tauri::command]
pub async fn git_clone(url: String, target_dir: String) -> Result<String, AppError> {
    // Remove existing target directory for clean re-clone
    let _ = std::fs::remove_dir_all(&target_dir);

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&target_dir).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let output = std::process::Command::new("git")
        .args([
            "-c", "http.version=HTTP/1.1",
            "-c", "http.userAgent=Folyn-Desktop/1.0",
            "-c", "http.lowSpeedLimit=1000",
            "-c", "http.lowSpeedTime=30",
            "clone", "--depth", "1", "--single-branch",
            &url, &target_dir,
        ])
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Cleanup failed clone attempt
        let _ = std::fs::remove_dir_all(&target_dir);
        return Err(format!("克隆仓库失败: {}", stderr.trim()).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Remove a directory and all its contents recursively.
/// Used to clean up cloned repos after analysis.
#[tauri::command]
pub async fn remove_dir(path: String) -> Result<(), AppError> {
    std::fs::remove_dir_all(&path).map_err(AppError::from)
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use notify::{Watcher, RecursiveMode, Event};
use tauri::Emitter;

/// Signal flag the background watcher thread polls. Set by stop_vault_watcher
/// so the thread exits its event-pump loop and drops the notify watcher.
static WATCHER_STOP: AtomicBool = AtomicBool::new(false);

/// Serialized event shape sent to the webview via `app://vault-watcher-event`.
/// Mirrors the JS `WatchEvent` the old plugin-fs watcher delivered, so the
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

/// Get a text overview of a project directory (file tree + basic stats).
/// Excludes common noise directories (.git, node_modules, target, etc.).
/// Limits output to 500 lines for manageable AI context.
#[tauri::command]
pub async fn get_project_overview(dir: String) -> Result<String, AppError> {
    let mut lines: Vec<String> = Vec::new();
    walk_dir(std::path::Path::new(&dir), 0, 3, &mut lines);

    let total_lines = lines.len();
    let truncated = if total_lines > 500 {
        let head: Vec<&str> = lines.iter().take(500).map(String::as_str).collect();
        format!(
            "{}\n... ({} more files)",
            head.join("\n"),
            total_lines - 500
        )
    } else {
        lines.join("\n")
    };

    // Strip the base dir prefix for readability
    let prefix = format!("{}/", dir.trim_end_matches('/'));
    let cleaned = truncated
        .replace(&prefix, "")
        .replace(dir.trim_end_matches('/'), ".");

    Ok(cleaned)
}

// ponytail: replaces `find -maxdepth 3 -not -path '*/.git/*' ...` — that shell
// command is macOS/Linux only. A 20-line std::fs recursion covers the same
// contract (maxdepth + skip-list) without a dep. Skip-list matches the prior
// `-not -path` filters verbatim. Upgrade to walkdir if/when symlink or
// permission-edge handling is needed.
const PROJECT_OVERVIEW_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".next",
    "dist",
    "build",
];

fn walk_dir(root: &std::path::Path, depth: u32, max_depth: u32, out: &mut Vec<String>) {
    if depth > max_depth {
        return;
    }
    let mut entries: Vec<_> = match std::fs::read_dir(root) {
        Ok(it) => it.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if PROJECT_OVERVIEW_SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }
        // Normalize to '/' so the prefix-strip logic below works on Windows too.
        out.push(path.to_string_lossy().replace('\\', "/"));
        if path.is_dir() {
            walk_dir(&path, depth + 1, max_depth, out);
        }
    }
}
