//! Activity collection (design: folyn-activity-collection-design.md §4–§6).
//! Commands are stateless: the vault root is passed in by the frontend (same
//! contract as `scan_file_tree`), the SQLite connection is cached per path.

pub mod db;
pub mod ingest;
pub mod query;

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
        )
    })
}

#[tauri::command]
pub fn activity_aggregate_metrics(
    vault_root: String,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<MetricRow>, AppError> {
    with_conn(&vault_root, |conn| query::aggregate_metrics(conn, from, to))
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

#[tauri::command]
pub fn activity_get_entity_neighbors(vault_root: String, entity_id: String) -> Result<Vec<NeighborRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::get_entity_neighbors(conn, &entity_id, now_ms())
    })
}

#[tauri::command]
pub fn activity_daily_digest_input(vault_root: String, date: String) -> Result<Option<DigestInput>, AppError> {
    with_conn(&vault_root, |conn| query::daily_digest_input(conn, &date))
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
