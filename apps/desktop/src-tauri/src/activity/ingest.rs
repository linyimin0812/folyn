//! Ingestion pipeline (design §4.2/§4.3): validate → entity resolution
//! (lookup-or-create) → append-only dedup insert → relations → task state
//! materialization. Privacy filtering (§4.3 step 2) happens in the host
//! before the call — the rules live in frontend settings, so the host strips
//! `raw` / redacts text before pushing; the Rust layer stays rule-agnostic.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub identity_key: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct EventEntity {
    #[serde(flatten)]
    pub entity: EntityRef,
    pub relation: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEventIn {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub source: String,
    pub actor: Option<EntityRef>,
    pub entities: Option<Vec<EventEntity>>,
    pub occurred_at: i64,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub url: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub raw: Option<serde_json::Value>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RejectedEvent {
    pub id: String,
    pub reason: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PushOutcome {
    pub accepted: usize,
    pub deduped: usize,
    pub rejected: Vec<RejectedEvent>,
}

// ponytail: fixed batch cap (design §4.3 step 6); per-collector rate
// throttling lands with the poll scheduler (subtask 2) if it ever matters.
pub const MAX_BATCH: usize = 500;

pub fn push_events(
    conn: &mut Connection,
    collector_id: &str,
    declared_types: Option<&[String]>,
    events: &[ActivityEventIn],
) -> PushOutcome {
    let mut out = PushOutcome::default();
    let tx = match conn.transaction() {
        Ok(tx) => tx,
        Err(e) => {
            out.rejected.push(RejectedEvent {
                id: String::new(),
                reason: format!("transaction open failed: {e}"),
            });
            return out;
        }
    };
    for (i, e) in events.iter().enumerate() {
        if i >= MAX_BATCH {
            out.rejected.push(RejectedEvent { id: e.id.clone(), reason: "batch cap exceeded".into() });
            continue;
        }
        if let Some(err) = validate(e, collector_id, declared_types) {
            out.rejected.push(RejectedEvent { id: e.id.clone(), reason: err });
            continue;
        }
        match insert_event(&tx, e) {
            Ok(true) => {
                out.accepted += 1;
                write_relations(&tx, e);
                if e.event_type == "task" {
                    materialize_task(&tx, e);
                }
            }
            Ok(false) => out.deduped += 1,
            Err(err) => out.rejected.push(RejectedEvent {
                id: e.id.clone(),
                reason: format!("insert failed: {err}"),
            }),
        }
    }
    if let Err(e) = tx.commit() {
        out.rejected.push(RejectedEvent {
            id: String::new(),
            reason: format!("commit failed: {e}"),
        });
    }
    out
}

fn validate(e: &ActivityEventIn, collector_id: &str, declared: Option<&[String]>) -> Option<String> {
    if e.id.trim().is_empty() {
        return Some("missing id".into());
    }
    if e.event_type.trim().is_empty() {
        return Some("missing type".into());
    }
    if e.source != collector_id {
        return Some(format!("source '{}' != collector '{}'", e.source, collector_id));
    }
    if e.occurred_at <= 0 {
        return Some("invalid occurredAt".into());
    }
    if let Some(types) = declared {
        if !types.contains(&e.event_type) {
            return Some(format!("type '{}' not in collector declaration", e.event_type));
        }
    }
    if let Some(ents) = &e.entities {
        for ee in ents {
            if ee.relation.trim().is_empty() {
                return Some("entity relation must be non-empty".into());
            }
        }
    }
    None
}

/// Lookup-or-create on (type, identity_key) — design §4.3 step 4. Entity id
/// is the deterministic `{type}:{identityKey}` so callers and relations can
/// predict it without a uuid dependency. Upsert: backfill the display name
/// only when the event carries one and it differs — a NULL name never wipes
/// an existing one.
pub fn resolve_entity(conn: &Connection, r: &EntityRef) -> String {
    let id = format!("{}:{}", r.entity_type, r.identity_key);
    let _ = conn.execute(
        "INSERT INTO entities (id, type, identity_key, display_name, created_at)
         VALUES (?1, ?2, ?3, ?4, unixepoch() * 1000)
         ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
         WHERE excluded.display_name IS NOT NULL
           AND entities.display_name IS DISTINCT FROM excluded.display_name",
        params![id, r.entity_type, r.identity_key, r.display_name],
    );
    id
}

/// Returns Ok(true) when inserted, Ok(false) when the id already existed
/// (insert-ignore dedup, design §4.3 step 3).
fn insert_event(tx: &rusqlite::Transaction, e: &ActivityEventIn) -> rusqlite::Result<bool> {
    let actor_id = e.actor.as_ref().map(|a| resolve_entity(tx, a));
    let inserted = tx.execute(
        "INSERT OR IGNORE INTO activity_events
         (id, type, source, actor_entity_id, occurred_at, title, summary, url, payload_json, raw_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, unixepoch() * 1000)",
        params![
            e.id,
            e.event_type,
            e.source,
            actor_id,
            e.occurred_at,
            e.title,
            e.summary,
            e.url,
            e.payload.as_ref().map(|p| p.to_string()),
            e.raw.as_ref().map(|p| p.to_string()),
        ],
    )?;
    Ok(inserted > 0)
}

/// Actor → entity edges (design §4.3 step 5). The relation label comes from
/// the event's entity refs — the host composes those from the collector's
/// `activityDisplay.entity.relationLabel` declarations, so this stays generic.
fn write_relations(tx: &rusqlite::Transaction, e: &ActivityEventIn) {
    let Some(actor) = &e.actor else { return };
    let from_id = resolve_entity(tx, actor);
    let Some(ents) = &e.entities else { return };
    for (i, ee) in ents.iter().enumerate() {
        if ee.entity.identity_key == actor.identity_key && ee.entity.entity_type == actor.entity_type {
            continue;
        }
        let to_id = resolve_entity(tx, &ee.entity);
        let rel_id = format!("rel_{}_{}", e.id, i);
        let _ = tx.execute(
            "INSERT OR IGNORE INTO relations (id, from_entity_id, to_entity_id, relation_type, activity_event_id, occurred_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![rel_id, from_id, to_id, ee.relation, e.id, e.occurred_at],
        );
    }
}

/// Materialize the task's current state into `entities.metadata_json`
/// (design §4.4): events stay append-only, "current state" is a projection.
fn materialize_task(tx: &rusqlite::Transaction, e: &ActivityEventIn) {
    let Some(task_ent) = e
        .entities
        .as_ref()
        .and_then(|ents| ents.iter().find(|ee| ee.entity.entity_type == "task"))
        .map(|ee| &ee.entity)
    else {
        return;
    };
    let Some(payload) = &e.payload else { return };
    let Some(obj) = payload.as_object() else { return };

    let id = resolve_entity(tx, task_ent);
    let existing: Option<String> = tx
        .query_row(
            "SELECT metadata_json FROM entities WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .unwrap_or(None);
    let mut meta: serde_json::Map<String, serde_json::Value> = existing
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for key in ["status", "startDate", "dueDate", "taskId", "progressNote"] {
        if let Some(v) = obj.get(key) {
            if !v.is_null() {
                meta.insert(key.to_string(), v.clone());
            }
        }
    }
    let _ = tx.execute(
        "UPDATE entities SET metadata_json = ?1 WHERE id = ?2",
        params![serde_json::Value::Object(meta).to_string(), id],
    );
}

pub fn get_cursor(conn: &Connection, collector_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT cursor FROM collector_cursors WHERE collector_id = ?1",
        [collector_id],
        |row| row.get(0),
    )
    .optional()
    .unwrap_or(None)
}

pub fn set_cursor(conn: &Connection, collector_id: &str, cursor: &str) {
    let _ = conn.execute(
        "INSERT INTO collector_cursors (collector_id, cursor, updated_at) VALUES (?1, ?2, unixepoch() * 1000)
         ON CONFLICT(collector_id) DO UPDATE SET cursor = ?2, updated_at = unixepoch() * 1000",
        params![collector_id, cursor],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::db::test_conn;
    use serde_json::json;

    fn ev(id: &str, event_type: &str, at: i64) -> ActivityEventIn {
        serde_json::from_value(json!({
            "id": id, "type": event_type, "source": "git",
            "occurredAt": at, "title": "t",
            "actor": {"type": "person", "identityKey": "me", "displayName": "I"},
            "entities": [{"type": "repository", "identityKey": "r1", "relation": "commit"}],
        }))
        .unwrap()
    }

    #[test]
    fn dedup_insert_ignore() {
        let mut conn = test_conn();
        let out = push_events(&mut conn, "git", None, &[ev("git:1", "commit", 1000)]);
        assert_eq!((out.accepted, out.deduped, out.rejected.len()), (1, 0, 0));
        let out = push_events(&mut conn, "git", None, &[ev("git:1", "commit", 1000)]);
        assert_eq!((out.accepted, out.deduped), (0, 1));
    }

    #[test]
    fn source_and_type_validation() {
        let mut conn = test_conn();
        let mut wrong_source = ev("git:2", "commit", 1000);
        wrong_source.source = "other".into();
        let out = push_events(&mut conn, "git", None, &[wrong_source]);
        assert_eq!(out.rejected[0].reason, "source 'other' != collector 'git'");

        let declared = vec!["commit".to_string()];
        let out = push_events(&mut conn, "git", Some(&declared), &[ev("git:3", "meeting", 1000)]);
        assert!(out.rejected[0].reason.contains("not in collector declaration"));
    }

    #[test]
    fn entity_lookup_or_create_is_idempotent() {
        let conn = test_conn();
        let r = EntityRef { entity_type: "person".into(), identity_key: "me".into(), display_name: Some("I".into()) };
        let id1 = resolve_entity(&conn, &r);
        let id2 = resolve_entity(&conn, &r);
        assert_eq!(id1, id2);
        assert_eq!(id1, "person:me");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM entities", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn entity_name_backfill_and_no_wipe() {
        let conn = test_conn();
        // Created without a name: later events can backfill one.
        resolve_entity(&conn, &EntityRef { entity_type: "person".into(), identity_key: "p".into(), display_name: None });
        resolve_entity(&conn, &EntityRef { entity_type: "person".into(), identity_key: "p".into(), display_name: Some("Alice".into()) });
        let name: Option<String> = conn
            .query_row("SELECT display_name FROM entities WHERE id = 'person:p'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name.as_deref(), Some("Alice"));
        // A nameless event must NOT wipe the stored name.
        resolve_entity(&conn, &EntityRef { entity_type: "person".into(), identity_key: "p".into(), display_name: None });
        let name: Option<String> = conn
            .query_row("SELECT display_name FROM entities WHERE id = 'person:p'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name.as_deref(), Some("Alice"));
    }

    #[test]
    fn relations_written_once_per_event() {
        let mut conn = test_conn();
        push_events(&mut conn, "git", None, &[ev("git:1", "commit", 1000)]);
        push_events(&mut conn, "git", None, &[ev("git:1", "commit", 1000)]);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM relations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let rel: (String, String) = conn
            .query_row("SELECT relation_type, to_entity_id FROM relations", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(rel, ("commit".to_string(), "repository:r1".to_string()));
    }

    #[test]
    fn task_state_materialized_and_events_append_only() {
        let mut conn = test_conn();
        let task_ev = |status: &str, at: i64| {
            serde_json::from_value::<ActivityEventIn>(json!({
                "id": format!("aone:{status}-{at}"), "type": "task", "source": "aone",
                "occurredAt": at, "title": "task",
                "entities": [{"type": "task", "identityKey": "T1", "displayName": "collectors", "relation": "update"}],
                "payload": {"taskId": "T1", "status": status, "startDate": 1, "dueDate": 100}
            }))
            .unwrap()
        };
        push_events(&mut conn, "aone", None, &[task_ev("in_progress", 1000)]);
        push_events(&mut conn, "aone", None, &[task_ev("done", 2000)]);
        let meta: String = conn
            .query_row("SELECT metadata_json FROM entities WHERE id = 'task:T1'", [], |r| r.get(0))
            .unwrap();
        assert!(meta.contains("\"status\":\"done\""));
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM activity_events WHERE type = 'task'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn batch_cap_rejects_extras() {
        let mut conn = test_conn();
        let events: Vec<ActivityEventIn> = (0..MAX_BATCH + 1)
            .map(|i| ev(&format!("git:cap{i}"), "commit", 1000 + i as i64))
            .collect();
        let out = push_events(&mut conn, "git", None, &events);
        assert_eq!(out.accepted, MAX_BATCH);
        assert_eq!(out.rejected.len(), 1);
    }

    #[test]
    fn cursor_roundtrip() {
        let conn = test_conn();
        assert_eq!(get_cursor(&conn, "git"), None);
        set_cursor(&conn, "git", "abc");
        assert_eq!(get_cursor(&conn, "git"), Some("abc".into()));
        set_cursor(&conn, "git", "def");
        assert_eq!(get_cursor(&conn, "git"), Some("def".into()));
    }
}
