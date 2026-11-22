//! Activity collection (design: folyn-activity-collection-design.md §4–§6).
//! Commands are stateless: the vault root is passed in by the frontend, the SQLite connection is cached per DB path
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

/// `sources` semantics as on `activity_aggregate_metrics`. `from`/`to`
/// (epoch ms) bound the relations the same way the timeline bounds events.
#[tauri::command]
pub fn activity_get_entity_neighbors(
    vault_root: String,
    entity_id: String,
    sources: Option<Vec<String>>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<NeighborRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::get_entity_neighbors(conn, &entity_id, now_ms(), sources.as_deref(), from, to)
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
