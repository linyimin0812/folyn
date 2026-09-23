//! Query layer (design §6). All reads are plain SQL aggregates over the
//! append-only event stream; AI summary generation itself lives in the host
//! (subtask 4) — this layer only caches/reads the `ai_summary` column.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use time::format_description;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub source: String,
    pub actor_entity_id: Option<String>,
    pub occurred_at: i64,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub url: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub ai_summary: Option<String>,
}

const EVENT_COLS: &str =
    "id, type, source, actor_entity_id, occurred_at, title, summary, url, payload_json, ai_summary";

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<EventRow> {
    let payload_json: Option<String> = row.get(8)?;
    let ai_summary: Option<String> = row.get(9)?;
    Ok(EventRow {
        id: row.get(0)?,
        event_type: row.get(1)?,
        source: row.get(2)?,
        actor_entity_id: row.get(3)?,
        occurred_at: row.get(4)?,
        title: row.get(5)?,
        summary: row.get(6)?,
        url: row.get(7)?,
        payload: payload_json.and_then(|s| serde_json::from_str(&s).ok()),
        ai_summary,
    })
}

pub fn list_events(
    conn: &Connection,
    from: Option<i64>,
    to: Option<i64>,
    types: Option<&[String]>,
    source: Option<&str>,
    actor_entity_id: Option<&str>,
    limit: Option<i64>,
) -> Vec<EventRow> {
    let mut sql = format!("SELECT {EVENT_COLS} FROM activity_events WHERE 1=1");
    let mut bound: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(f) = from {
        sql.push_str(" AND occurred_at >= ?");
        bound.push(Box::new(f));
    }
    if let Some(t) = to {
        sql.push_str(" AND occurred_at <= ?");
        bound.push(Box::new(t));
    }
    if let Some(s) = source {
        sql.push_str(" AND source = ?");
        bound.push(Box::new(s.to_string()));
    }
    if let Some(a) = actor_entity_id {
        sql.push_str(" AND actor_entity_id = ?");
        bound.push(Box::new(a.to_string()));
    }
    if types.map(|t| !t.is_empty()).unwrap_or(false) {
        sql.push_str(" AND type IN (");
        for (i, t) in types.unwrap().iter().enumerate() {
            sql.push_str(if i == 0 { "?" } else { ",?" });
            bound.push(Box::new(t.clone()));
        }
        sql.push(')');
    }
    sql.push_str(" ORDER BY occurred_at DESC LIMIT ?");
    bound.push(Box::new(limit.unwrap_or(500)));
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|p| p.as_ref()).collect();
    let out = match stmt.query_map(refs.as_slice(), row_to_event) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    };
    out
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    #[serde(rename = "type")]
    pub event_type: String,
    pub count: i64,
    /// SUM(payload.minutes) — only meaningful for meeting-like types; null
    /// for the rest. Frontend maps rows to metric cards (design §6).
    pub total_minutes: Option<f64>,
}

pub fn aggregate_metrics(conn: &Connection, from: Option<i64>, to: Option<i64>) -> Vec<MetricRow> {
    let sql = "SELECT type, COUNT(*),
        CASE WHEN SUM(json_extract(payload_json, '$.minutes')) IS NULL THEN NULL
             ELSE CAST(SUM(json_extract(payload_json, '$.minutes')) AS REAL) END
        FROM activity_events WHERE (?1 IS NULL OR occurred_at >= ?1) AND (?2 IS NULL OR occurred_at <= ?2)
        GROUP BY type ORDER BY type";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let out: Vec<MetricRow> = stmt
        .query_map(params![from, to], |row| {
            Ok(MetricRow {
                event_type: row.get(0)?,
                count: row.get(1)?,
                total_minutes: row.get(2)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    out
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EntityRow {
    pub id: String,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub identity_key: String,
    pub display_name: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

const ENTITY_COLS: &str = "id, type, identity_key, display_name, metadata_json";

fn row_to_entity(row: &rusqlite::Row) -> rusqlite::Result<EntityRow> {
    let metadata_json: Option<String> = row.get(4)?;
    Ok(EntityRow {
        id: row.get(0)?,
        entity_type: row.get(1)?,
        identity_key: row.get(2)?,
        display_name: row.get(3)?,
        metadata: metadata_json.and_then(|s| serde_json::from_str(&s).ok()),
    })
}

pub fn list_entities(conn: &Connection, entity_type: Option<&str>, limit: Option<i64>) -> Vec<EntityRow> {
    let sql = match entity_type {
        Some(_) => format!("SELECT {ENTITY_COLS} FROM entities WHERE type = ?1 ORDER BY display_name LIMIT ?2"),
        None => format!("SELECT {ENTITY_COLS} FROM entities ORDER BY display_name LIMIT ?1"),
    };
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let out: Vec<EntityRow> = match entity_type {
        Some(t) => stmt
            .query_map(params![t, limit.unwrap_or(200)], row_to_entity)
            .unwrap()
            .filter_map(|r| r.ok())
            .collect(),
        None => stmt
            .query_map(params![limit.unwrap_or(200)], row_to_entity)
            .unwrap()
            .filter_map(|r| r.ok())
            .collect(),
    };
    out
}

pub fn get_entity(conn: &Connection, id: &str) -> Option<EntityRow> {
    conn.query_row(
        &format!("SELECT {ENTITY_COLS} FROM entities WHERE id = ?1"),
        [id],
        row_to_entity,
    )
    .optional()
    .ok()
    .flatten()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NeighborRow {
    pub neighbor_id: String,
    pub relation: String,
    pub event_count: i64,
    pub last_at: i64,
    /// event_count × exp(-days/14) — two-week half-life, design §6.
    pub score: f64,
}

pub fn get_entity_neighbors(conn: &Connection, entity_id: &str, now_ms: i64) -> Vec<NeighborRow> {
    let sql = "SELECT CASE WHEN r.from_entity_id = ?1 THEN r.to_entity_id ELSE r.from_entity_id END AS neighbor_id,
        r.relation_type, COUNT(*) AS event_count, MAX(r.occurred_at) AS last_at
        FROM relations r WHERE r.from_entity_id = ?1 OR r.to_entity_id = ?1
        GROUP BY neighbor_id, r.relation_type";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let mut out: Vec<NeighborRow> = stmt
        .query_map(params![entity_id], |row| {
            Ok(NeighborRow {
                neighbor_id: row.get(0)?,
                relation: row.get(1)?,
                event_count: row.get(2)?,
                last_at: row.get(3)?,
                score: 0.0,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    for n in &mut out {
        let age_days = (now_ms - n.last_at) as f64 / 86_400_000.0;
        n.score = n.event_count as f64 * (-age_days / 14.0f64).exp();
    }
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    out
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DigestInput {
    pub events: Vec<EventRow>,
    pub ongoing_tasks: Vec<EntityRow>,
}

/// "YYYY-MM-DD" → epoch ms (UTC midnight). Caller-side contract: frontend
/// sends the user-local calendar day; the UTC offset skew only shifts the
/// window boundary — acceptable for a daily digest, not worth a tz port.
fn day_to_epoch_ms(date: &str) -> Option<i64> {
    let fmt = format_description::parse("[year]-[month]-[day]").ok()?;
    let d = time::Date::parse(date, &fmt).ok()?;
    Some(d.midnight().assume_utc().unix_timestamp() * 1000)
}

pub fn daily_digest_input(conn: &Connection, date: &str) -> Option<DigestInput> {
    let start = day_to_epoch_ms(date)?;
    let end = start + 86_400_000 - 1;
    let events = list_events(conn, Some(start), Some(end), None, None, None, None);
    let ongoing_tasks: Vec<EntityRow> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, type, identity_key, display_name, metadata_json FROM entities
                 WHERE type = 'task'
                   AND json_extract(metadata_json, '$.startDate') <= ?1
                   AND json_extract(metadata_json, '$.dueDate')   >= ?2
                   AND json_extract(metadata_json, '$.status') != 'done'",
            )
            .ok()?;
        let rows = stmt
            .query_map(params![start, start], row_to_entity)
            .ok()?;
        rows.filter_map(|r| r.ok()).collect()
    };
    Some(DigestInput { events, ongoing_tasks })
}

pub fn get_event_summary(conn: &Connection, event_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT ai_summary FROM activity_events WHERE id = ?1",
        [event_id],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

pub fn set_event_summary(conn: &Connection, event_id: &str, summary: &str) -> bool {
    conn.execute(
        "UPDATE activity_events SET ai_summary = ?1 WHERE id = ?2",
        params![summary, event_id],
    )
    .map(|n| n > 0)
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::db::test_conn;
    use crate::activity::ingest::push_events;
    use serde_json::json;

    fn seed(conn: &mut Connection) {
        for (id, at) in [("git:1", 1000), ("git:2", 2000), ("mtg:1", 3000)] {
            let (event_type, entities) = if id.starts_with("git") {
                ("commit", json!([{"type": "repository", "identityKey": "r1", "relation": "commit"}]))
            } else {
                ("meeting", json!([{"type": "meeting", "identityKey": "m1", "relation": "attend"}]))
            };
            let e: crate::activity::ingest::ActivityEventIn = serde_json::from_value(json!({
                "id": id, "type": event_type, "source": id.split(':').next().unwrap(),
                "occurredAt": at, "title": "t",
                "actor": {"type": "person", "identityKey": "me"},
                "entities": entities,
                "payload": if event_type == "meeting" { json!({"minutes": 60}) } else { serde_json::Value::Null }
            }))
            .unwrap();
            let source = e.source.clone();
            push_events(conn, &source, None, &[e]);
        }
    }

    #[test]
    fn list_and_filter() {
        let mut conn = test_conn();
        seed(&mut conn);
        assert_eq!(list_events(&conn, None, None, None, None, None, None).len(), 3);
        let types = vec!["commit".to_string()];
        assert_eq!(list_events(&conn, None, None, Some(&types), None, None, None).len(), 2);
        assert_eq!(list_events(&conn, Some(2500), None, None, None, None, None).len(), 1);
        let all = list_events(&conn, None, None, None, None, None, None);
        assert!(all[0].occurred_at >= all[1].occurred_at);
    }

    #[test]
    fn aggregate_counts_and_minutes() {
        let mut conn = test_conn();
        seed(&mut conn);
        let rows = aggregate_metrics(&conn, None, None);
        let commit = rows.iter().find(|r| r.event_type == "commit").unwrap();
        let meeting = rows.iter().find(|r| r.event_type == "meeting").unwrap();
        assert_eq!(commit.count, 2);
        assert!(commit.total_minutes.is_none());
        assert_eq!(meeting.count, 1);
        assert_eq!(meeting.total_minutes, Some(60.0));
    }

    #[test]
    fn neighbors_scored_and_sorted() {
        let mut conn = test_conn();
        seed(&mut conn);
        let now = 86_400_000 * 10; // 10 days after the events
        let ns = get_entity_neighbors(&conn, "person:me", now);
        assert_eq!(ns.len(), 2);
        // repository: 2 events × decay > meeting: 1 event × decay
        assert_eq!(ns[0].neighbor_id, "repository:r1");
        assert!(ns[0].score > ns[1].score);
        assert_eq!(ns[0].event_count, 2);
    }

    #[test]
    fn digest_input_two_streams() {
        let mut conn = test_conn();
        let task: crate::activity::ingest::ActivityEventIn = serde_json::from_value(json!({
            "id": "aone:t1", "type": "task", "source": "aone", "occurredAt": 1000,
            "title": "sdk",
            "actor": {"type": "person", "identityKey": "me"},
            "entities": [{"type": "task", "identityKey": "T1", "relation": "update"}],
            "payload": {"taskId": "T1", "status": "in_progress",
                        "startDate": 0, "dueDate": 86_400_000_i64 * 30}
        }))
        .unwrap();
        push_events(&mut conn, "aone", None, &[task]);
        // Window covering epoch day 0: both the event and the ongoing task hit.
        let input = daily_digest_input(&conn, "1970-01-01").unwrap();
        assert_eq!(input.events.len(), 1);
        assert_eq!(input.ongoing_tasks.len(), 1);
        assert_eq!(input.ongoing_tasks[0].id, "task:T1");
        // A day outside the schedule window: no events, no ongoing tasks.
        let empty = daily_digest_input(&conn, "2030-01-01").unwrap();
        assert!(empty.events.is_empty());
        assert!(empty.ongoing_tasks.is_empty());
    }

    #[test]
    fn summary_cache_roundtrip() {
        let mut conn = test_conn();
        seed(&mut conn);
        assert_eq!(get_event_summary(&conn, "git:1"), None);
        assert!(set_event_summary(&conn, "git:1", "did things"));
        assert_eq!(get_event_summary(&conn, "git:1"), Some("did things".into()));
        assert!(!set_event_summary(&conn, "nope", "x"));
    }
}
