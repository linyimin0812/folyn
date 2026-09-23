use rusqlite::Connection;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use crate::errors::AppError;

type SharedConn = Arc<Mutex<Connection>>;

fn cache() -> &'static Mutex<HashMap<PathBuf, SharedConn>> {
    static CONNS: OnceLock<Mutex<HashMap<PathBuf, SharedConn>>> = OnceLock::new();
    CONNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn vault_key(vault_root: &str) -> String {
    // ponytail: DefaultHasher output isn't stable across Rust major versions —
    // a toolchain bump could orphan the old dir; switch to a manual FNV/SHA if
    // that ever bites.
    let mut h = DefaultHasher::new();
    vault_root.hash(&mut h);
    format!("{:x}", h.finish())
}

/// `rename`, falling back to `copy` + `remove` across filesystems.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
        .or_else(|_| fs::copy(from, to).map(|_| ()).and_then(|_| fs::remove_file(from)))
}

/// Legacy DB lived at `<vault_root>/activity.sqlite`. Move it (plus -wal/-shm)
/// to the new location before opening; only when the target doesn't exist yet.
fn migrate_legacy_db(vault_root: &str, target_db: &Path) -> Result<(), AppError> {
    let legacy = Path::new(vault_root).join("activity.sqlite");
    if !legacy.exists() || target_db.exists() {
        return Ok(());
    }
    for suffix in ["", "-wal", "-shm"] {
        let from = legacy.with_file_name(format!("activity.sqlite{suffix}"));
        if !from.exists() {
            continue;
        }
        let to = target_db.with_file_name(format!("activity.sqlite{suffix}"));
        if let Err(e) = move_file(&from, &to) {
            if suffix.is_empty() {
                return Err(AppError::Io {
                    detail: format!("migrate activity db {} -> {}: {e}", from.display(), to.display()),
                });
            }
            // Stale -wal/-shm: SQLite checkpoints/rebuilds; ignore.
        }
    }
    Ok(())
}

/// Connection to `~/.folyn/activity/<vault-key>/activity.sqlite` (one DB per
/// vault, see design §5; key = hash of vault_root, so app data stays out of
/// the vault tree). A legacy `<vault_root>/activity.sqlite` is migrated on
/// first open. Cached per path; schema is idempotently ensured on first open.
pub fn conn(vault_root: &str) -> Result<SharedConn, AppError> {
    let dir = dirs::home_dir()
        .ok_or_else(|| AppError::Io {
            detail: "home directory not found".into(),
        })?
        .join(".folyn")
        .join("activity")
        .join(vault_key(vault_root));
    fs::create_dir_all(&dir).map_err(|e| AppError::Io {
        detail: format!("create {}: {e}", dir.display()),
    })?;
    let path = dir.join("activity.sqlite");
    let mut guard = cache().lock().unwrap();
    if let Some(c) = guard.get(&path) {
        return Ok(c.clone());
    }
    migrate_legacy_db(vault_root, &path)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_db_migrated_before_open() {
        let tmp = std::env::temp_dir().join(format!(
            "folyn-activity-migrate-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        let vault = tmp.join("vault");
        let target_dir = tmp.join("target");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(vault.join("activity.sqlite"), b"db").unwrap();
        fs::write(vault.join("activity.sqlite-wal"), b"wal").unwrap();

        let target = target_dir.join("activity.sqlite");
        migrate_legacy_db(vault.to_str().unwrap(), &target).unwrap();
        assert!(target.exists());
        assert!(target.with_file_name("activity.sqlite-wal").exists());
        assert!(!vault.join("activity.sqlite").exists());

        // Target already exists / no legacy left: no-op, no error.
        migrate_legacy_db(vault.to_str().unwrap(), &target).unwrap();
        fs::write(vault.join("activity.sqlite"), b"fresh").unwrap();
        migrate_legacy_db(vault.to_str().unwrap(), &target).unwrap();
        assert!(vault.join("activity.sqlite").exists(), "target wins, legacy untouched");
        assert_eq!(fs::read(&target).unwrap(), b"db");

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn vault_key_is_deterministic_and_path_sensitive() {
        assert_eq!(vault_key("/a/b"), vault_key("/a/b"));
        assert_ne!(vault_key("/a/b"), vault_key("/a/b/"));
    }
}
