use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::errors::AppError;

type SharedConn = Arc<Mutex<Connection>>;

fn cache() -> &'static Mutex<HashMap<PathBuf, SharedConn>> {
    static CONNS: OnceLock<Mutex<HashMap<PathBuf, SharedConn>>> = OnceLock::new();
    CONNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Connection to `<vault_root>/activity.sqlite` (one DB per vault, see design
/// §5). Cached per path; schema is idempotently ensured on first open.
pub fn conn(vault_root: &str) -> Result<SharedConn, AppError> {
    let path = Path::new(vault_root).join("activity.sqlite");
    let mut guard = cache().lock().unwrap();
    if let Some(c) = guard.get(&path) {
        return Ok(c.clone());
    }
    let conn = Connection::open(&path).map_err(|e| AppError::Io {
        detail: format!("open activity.sqlite: {e}"),
    })?;
    init_schema(&conn).map_err(|e| AppError::Internal {
        detail: format!("activity schema init: {e}"),
    })?;
    let shared = Arc::new(Mutex::new(conn));
    guard.insert(path, shared.clone());
    Ok(shared)
}

/// Design §5 schema. `CREATE ... IF NOT EXISTS` — no migration machinery
/// until a schema change actually ships.
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_events (
          id              TEXT PRIMARY KEY,
          type            TEXT NOT NULL,
          source          TEXT NOT NULL,
          actor_entity_id TEXT,
          occurred_at     INTEGER NOT NULL,
          title           TEXT,
          summary         TEXT,
          url             TEXT,
          payload_json    TEXT,
          raw_json        TEXT,
          ai_summary      TEXT,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_time      ON activity_events(occurred_at);
        CREATE INDEX IF NOT EXISTS idx_events_type_time ON activity_events(type, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_events_source    ON activity_events(source);

        CREATE TABLE IF NOT EXISTS entities (
          id            TEXT PRIMARY KEY,
          type          TEXT NOT NULL,
          identity_key  TEXT NOT NULL,
          display_name  TEXT,
          metadata_json TEXT,
          created_at    INTEGER NOT NULL,
          UNIQUE(type, identity_key)
        );

        CREATE TABLE IF NOT EXISTS relations (
          id                TEXT PRIMARY KEY,
          from_entity_id    TEXT NOT NULL REFERENCES entities(id),
          to_entity_id      TEXT NOT NULL REFERENCES entities(id),
          relation_type     TEXT NOT NULL,
          activity_event_id TEXT REFERENCES activity_events(id),
          occurred_at       INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_relations_to   ON relations(to_entity_id, occurred_at);

        CREATE TABLE IF NOT EXISTS collector_cursors (
          collector_id TEXT PRIMARY KEY,
          cursor       TEXT,
          updated_at   INTEGER
        );",
    )
}

/// In-memory connection for tests.
#[cfg(test)]
pub fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init_schema(&conn).unwrap();
    conn
}
