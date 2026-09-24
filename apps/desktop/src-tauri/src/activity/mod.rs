//! Activity collection (design: folyn-activity-collection-design.md §4–§6).
//! Commands are stateless: the vault root is passed in by the frontend (same
//! contract as `scan_file_tree`), the SQLite connection is cached per DB path
//! (under `~/.folyn`, see `db::conn`).

pub mod db;
pub mod ingest;
pub mod query;
pub mod runs;

use crate::errors::AppError;
use ingest::{ActivityEventIn, PushOutcome};
use query::{
    DigestInput, EntityRow, EventRow, MetricRow, NeighborRow,
};
use rusqlite::Connection;
use serde::Serialize;

// ── collector exec (design §2.2 — collectors pull local sources) ──────────────
// Trusted blob modules cannot import `@tauri-apps/api` (bare specifiers don't
// resolve from a blob URL), and the shell plugin is sidecar-scoped — so the
// host hands collectors a tiny `ctx.exec` backed by this command.
// ponytail: program allowlist — exactly the binaries the reference collectors
// need. Extend the list when a collector legitimately needs another tool; a
// generic exec would be an unbounded code-execution surface for extension code.
const EXEC_ALLOWED_PROGRAMS: &[&str] = &["git"];

/// Result of `activity_exec` — stdout + stderr + exit code; the collector
/// decides what a non-zero exit means (git returns 128 on bad repo, etc.).
#[derive(Serialize, Debug)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run an allowlisted program with separated args (no shell → no injection)
/// in `cwd`. Backs the `ctx.exec` the collector runtime passes to `collect()`.
#[tauri::command]
pub fn activity_exec(
    program: String,
    args: Vec<String>,
    cwd: String,
) -> Result<ExecOutput, AppError> {
    if !EXEC_ALLOWED_PROGRAMS.contains(&program.as_str()) {
        return Err(format!("activity_exec denied: program not allowlisted: {program}").into());
    }
    let out = std::process::Command::new(&program)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("activity_exec failed to run {program}: {e}"))?;
    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code().unwrap_or(-1),
    })
}

// ── Frontmost-window sampling (window-activity collector) ────────────────────
// ponytail: these are FIXED scripts with no collector-controlled arguments —
// the fixed script IS the security boundary (same reasoning as the
// EXEC_ALLOWED_PROGRAMS allowlist above: exposing osascript/powershell with
// caller-chosen args would be an unbounded exec surface). Widening what this
// command returns means editing this file, not anything extension-side.

/// Result of `activity_front_window` — frontmost app + window title (title
/// null when the platform/window can't provide one).
#[derive(Serialize, Debug)]
pub struct FrontWindow {
    pub app: String,
    pub title: Option<String>,
}

/// Sample the frontmost window (app + title) for the window-activity
/// collector. `None` when unavailable (unsupported platform, permission
/// denied, no foreground window). On macOS the first call triggers the
/// system Automation-permission prompt — expected, documented in the
/// collector's manifest description.
#[tauri::command]
pub fn activity_front_window() -> Option<FrontWindow> {
    front_window()
}

#[cfg(target_os = "macos")]
fn front_window() -> Option<FrontWindow> {
    // System Events list output: "AppName, Window Title" / "AppName, missing value".
    let script = "tell application \"System Events\" to get {name, name of first window} of first application process whose frontmost is true";
    let out = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !out.status.success() {
        // Automation not granted yet (or AppleScript error): the app-only
        // script usually still works — same permission, weaker query.
        let fallback = "tell application \"System Events\" to get name of first application process whose frontmost is true";
        let out2 = std::process::Command::new("osascript")
            .args(["-e", fallback])
            .output()
            .ok()?;
        if !out2.status.success() {
            return None;
        }
        let app = String::from_utf8_lossy(&out2.stdout).trim().to_string();
        return (!app.is_empty()).then(|| FrontWindow { app, title: None });
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Titles can contain commas; app names can't contain ", " in practice —
    // split at the first separator so a comma'd title stays whole.
    let (app, title) = match line.split_once(", ") {
        Some((a, t)) => (a.trim().to_string(), t.trim()),
        None => (line, ""),
    };
    if app.is_empty() {
        return None;
    }
    let title = if title.is_empty() || title == "missing value" {
        None
    } else {
        Some(title.to_string())
    };
    Some(FrontWindow { app, title })
}

#[cfg(target_os = "windows")]
fn front_window() -> Option<FrontWindow> {
    // Fixed script: P/Invoke GetForegroundWindow/GetWindowText, app name by
    // matching the process whose MainWindowHandle is the foreground window.
    // Output "app|title" (titles can contain '|' — split at the first one).
    let script = r#"[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class FW{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int n);}' -ErrorAction SilentlyContinue; $h=[FW]::GetForegroundWindow(); $s=New-Object System.Text.StringBuilder(512); [void][FW]::GetWindowText($h,$s,512); $p=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -eq $h } | Select-Object -First 1; Write-Output ($p.ProcessName + '|' + $s.ToString())"#;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (app, title) = line.split_once('|')?;
    let app = app.trim();
    if app.is_empty() {
        return None;
    }
    let title = if title.is_empty() { None } else { Some(title.to_string()) };
    Some(FrontWindow { app: app.to_string(), title })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn front_window() -> Option<FrontWindow> {
    None
}

// ── Vault scan (file-activity collector) ──────────────────────────────────────

/// One file found by `activity_scan_vault` (serde camelCase for the JS side).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileEntry {
    /// Vault-root-relative path, forward slashes.
    pub path: String,
    pub mtime_ms: i64,
    pub size: u64,
}

/// Recursively list every file under `vault_root`. `.git` is always skipped
/// (repo internals are never user activity); any directory whose relative path
/// OR basename matches a trimmed non-empty exclude entry is skipped too.
/// `exclude_patterns` are the appearance「过滤文件/文件夹」globs: a dir OR file
/// is skipped when any segment of its relative path matches a pattern
/// (`*` = any chars, `?` = one char, otherwise exact segment match — mirrors
/// `src/utils/excludePattern.ts`). Sorted by path. Backs the `ctx.scanVault`
/// the collector runtime injects.
#[tauri::command]
pub fn activity_scan_vault(
    vault_root: String,
    exclude_dirs: Vec<String>,
    exclude_patterns: Vec<String>,
) -> Result<Vec<VaultFileEntry>, AppError> {
    let excludes: Vec<String> = exclude_dirs
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let patterns: Vec<String> = exclude_patterns
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let root = std::path::Path::new(&vault_root);
    if !root.is_dir() {
        return Err(format!("activity_scan_vault: not a directory: {vault_root}").into());
    }
    let mut out = Vec::new();
    walk_vault(root, "", &excludes, &patterns, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Glob match for one path segment: `*` = any run of chars, `?` = one char,
/// otherwise exact. Same semantics as `patternToRegExp` in
/// `src/utils/excludePattern.ts`. Char-based so `?` never splits a UTF-8 char.
fn wildcard_match(seg: &str, pat: &str) -> bool {
    fn go(s: &[char], p: &[char]) -> bool {
        if p.is_empty() {
            return s.is_empty();
        }
        match p[0] {
            '*' => (0..=s.len()).any(|i| go(&s[i..], &p[1..])),
            '?' => !s.is_empty() && go(&s[1..], &p[1..]),
            c => !s.is_empty() && s[0] == c && go(&s[1..], &p[1..]),
        }
    }
    let s: Vec<char> = seg.chars().collect();
    let p: Vec<char> = pat.chars().collect();
    go(&s, &p)
}

/// Does any path segment of `rel` match one of the patterns?
fn segment_matches_pattern(rel: &str, patterns: &[String]) -> bool {
    rel.split('/').any(|seg| {
        patterns.iter().any(|p| {
            if p.contains('*') || p.contains('?') {
                wildcard_match(seg, p)
            } else {
                seg == p
            }
        })
    })
}

/// Fixed recursive walk (std::fs only). Unreadable entries are skipped — a
/// scan is a snapshot, not a contract to enumerate everything.
fn walk_vault(
    dir: &std::path::Path,
    rel: &str,
    excludes: &[String],
    patterns: &[String],
    out: &mut Vec<VaultFileEntry>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let Ok(ft) = entry.file_type() else { continue };
        // Appearance「过滤文件/文件夹」patterns apply to files AND dirs.
        if segment_matches_pattern(&child_rel, patterns) {
            continue;
        }
        if ft.is_dir() {
            // .git skipped unconditionally: repo internals, never user activity.
            if name == ".git" {
                continue;
            }
            if excludes.iter().any(|e| child_rel == *e || name == *e) {
                continue;
            }
            walk_vault(&entry.path(), &child_rel, excludes, patterns, out);
        } else {
            let Ok(md) = entry.metadata() else { continue };
            let mtime_ms = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(VaultFileEntry { path: child_rel, mtime_ms, size: md.len() });
        }
    }
}

fn with_conn<T>(vault_root: &str, f: impl FnOnce(&Connection) -> T) -> Result<T, AppError> {
    let shared = db::conn(vault_root)?;
    let guard = shared.lock().map_err(|_| AppError::Internal {
        detail: "activity db lock poisoned".into(),
    })?;
    Ok(f(&guard))
}

fn with_conn_mut<T>(vault_root: &str, f: impl FnOnce(&mut Connection) -> T) -> Result<T, AppError> {
    let shared = db::conn(vault_root)?;
    let mut guard = shared.lock().map_err(|_| AppError::Internal {
        detail: "activity db lock poisoned".into(),
    })?;
    Ok(f(&mut guard))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn activity_push_events(
    vault_root: String,
    collector_id: String,
    declared_types: Option<Vec<String>>,
    events: Vec<ActivityEventIn>,
) -> Result<PushOutcome, AppError> {
    let declared = declared_types.as_deref();
    with_conn_mut(&vault_root, |conn| {
        ingest::push_events(conn, &collector_id, declared, &events)
    })
}

#[tauri::command]
pub fn activity_get_cursor(vault_root: String, collector_id: String) -> Result<Option<String>, AppError> {
    with_conn(&vault_root, |conn| ingest::get_cursor(conn, &collector_id))
}

#[tauri::command]
pub fn activity_set_cursor(vault_root: String, collector_id: String, cursor: String) -> Result<(), AppError> {
    with_conn(&vault_root, |conn| ingest::set_cursor(conn, &collector_id, &cursor))
}

#[tauri::command]
pub fn activity_list_events(
    vault_root: String,
    from: Option<i64>,
    to: Option<i64>,
    types: Option<Vec<String>>,
    source: Option<String>,
    actor_entity_id: Option<String>,
    limit: Option<i64>,
    sources: Option<Vec<String>>,
) -> Result<Vec<EventRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::list_events(
            conn,
            from,
            to,
            types.as_deref(),
            source.as_deref(),
            actor_entity_id.as_deref(),
            limit,
            sources.as_deref(),
        )
    })
}

/// `sources`: include-list of collector ids (None = no filtering; Some(empty)
/// = match nothing). Disabled collectors hide their already-collected content.
#[tauri::command]
pub fn activity_aggregate_metrics(
    vault_root: String,
    from: Option<i64>,
    to: Option<i64>,
    sources: Option<Vec<String>>,
) -> Result<Vec<MetricRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::aggregate_metrics(conn, from, to, sources.as_deref())
    })
}

#[tauri::command]
pub fn activity_list_entities(
    vault_root: String,
    entity_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<EntityRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::list_entities(conn, entity_type.as_deref(), limit)
    })
}

#[tauri::command]
pub fn activity_get_entity(vault_root: String, id: String) -> Result<Option<EntityRow>, AppError> {
    with_conn(&vault_root, |conn| query::get_entity(conn, &id))
}

/// `sources` semantics as on `activity_aggregate_metrics`.
#[tauri::command]
pub fn activity_get_entity_neighbors(
    vault_root: String,
    entity_id: String,
    sources: Option<Vec<String>>,
) -> Result<Vec<NeighborRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::get_entity_neighbors(conn, &entity_id, now_ms(), sources.as_deref())
    })
}

/// `sources` semantics as on `activity_aggregate_metrics`.
#[tauri::command]
pub fn activity_daily_digest_input(
    vault_root: String,
    date: String,
    sources: Option<Vec<String>>,
) -> Result<Option<DigestInput>, AppError> {
    with_conn(&vault_root, |conn| {
        query::daily_digest_input(conn, &date, sources.as_deref())
    })
}

#[tauri::command]
pub fn activity_get_event_summary(vault_root: String, event_id: String) -> Result<Option<String>, AppError> {
    with_conn(&vault_root, |conn| query::get_event_summary(conn, &event_id))
}

#[tauri::command]
pub fn activity_set_event_summary(
    vault_root: String,
    event_id: String,
    summary: String,
) -> Result<bool, AppError> {
    with_conn(&vault_root, |conn| {
        query::set_event_summary(conn, &event_id, &summary)
    })
}

/// Append one collect-run history record (采集记录) — see `runs.rs`.
#[tauri::command]
pub fn activity_insert_collect_run(
    vault_root: String,
    run: runs::CollectRunIn,
) -> Result<(), AppError> {
    with_conn_mut(&vault_root, |conn| runs::insert_collect_run(conn, &run))?
}

/// All collect-run records (≤ 100), newest-first.
#[tauri::command]
pub fn activity_list_collect_runs(vault_root: String) -> Result<Vec<runs::CollectRunRow>, AppError> {
    with_conn(&vault_root, runs::list_collect_runs)
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn scan_walks_recursively_and_applies_excludes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::write(root.join("notes/sub/b.md"), "yyy").unwrap();
        // .git always skipped.
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref").unwrap();
        // Excluded by basename and by relative path; blank entries ignored.
        fs::create_dir_all(root.join("junk")).unwrap();
        fs::write(root.join("junk/c.md"), "x").unwrap();
        fs::create_dir_all(root.join("notes/secret")).unwrap();
        fs::write(root.join("notes/secret/d.md"), "x").unwrap();

        let entries = activity_scan_vault(
            root.to_string_lossy().into_owned(),
            vec!["junk".into(), "notes/secret".into(), "  ".into(), String::new()],
            vec![],
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "notes/sub/b.md"]);
        assert!(entries.iter().all(|e| e.size > 0 && e.mtime_ms > 0));
    }

    #[test]
    fn scan_applies_exclude_patterns() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("app.log"), "x").unwrap();
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::write(root.join("notes/debug.log"), "x").unwrap();
        // Segment pattern prunes the whole nested dir.
        fs::create_dir_all(root.join("notes/__wiki__/deep")).unwrap();
        fs::write(root.join("notes/__wiki__/deep/b.md"), "x").unwrap();
        // Exact file-name segment pattern.
        fs::write(root.join("notes/secret.md"), "x").unwrap();
        // `?` wildcard: one char.
        fs::write(root.join("notes/draft-1.md"), "x").unwrap();

        let entries = activity_scan_vault(
            root.to_string_lossy().into_owned(),
            vec![],
            vec![
                "*.log".into(),
                "__wiki__".into(),
                "secret.md".into(),
                "draft-?.md".into(),
            ],
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md"]);
    }

    #[test]
    fn scan_non_directory_is_an_error() {
        let err =
            activity_scan_vault("/definitely/not/a/dir".into(), vec![], vec![]).unwrap_err();
        assert!(err.to_string().contains("not a directory"));
    }
}
