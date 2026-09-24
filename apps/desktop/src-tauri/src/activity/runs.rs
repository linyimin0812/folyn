//! Collect-run history (采集记录): one row per completed collector run
//! (scheduled poll, manual collect, webhook-triggered collect). Written by
//! the host after each run; replaces the legacy storageClient-persisted
//! `collectHistory` with the same caps: 100 rows globally, 50 log lines
//! per run (hard backstop — the frontend already caps before sending).

use crate::errors::AppError;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Global cap: keep the newest 100 runs.
const MAX_RUNS: i64 = 100;
/// Per-run log-line cap (hard backstop, mirrors the frontend's 50).
const MAX_LOG_LINES: usize = 50;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectRunIn {
    pub collector_id: String,
    pub collector_name: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub accepted: i64,
    pub deduped: i64,
    /// 'ok' | 'no-result' — mirrors the frontend outcome enum.
    pub outcome: String,
    pub logs: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CollectRunRow {
    pub collector_id: String,
    pub collector_name: String,
    pub started_at: i64,
    /// COALESCE(finished_at, started_at) — always a number for the frontend.
    pub finished_at: i64,
    pub accepted: i64,
    pub deduped: i64,
    pub outcome: String,
    pub logs: Vec<String>,
}

/// Append one run, then evict everything beyond the newest `MAX_RUNS` rows.
/// One transaction so a crash never leaves the table over-cap.
pub fn insert_collect_run(conn: &mut Connection, run: &CollectRunIn) -> Result<(), AppError> {
    let logs: Vec<&String> = run.logs.iter().take(MAX_LOG_LINES).collect();
    let logs_json = serde_json::to_string(&logs).unwrap_or_else(|_| "[]".into());
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Internal { detail: format!("collect_runs tx: {e}") })?;
    tx.execute(
        "INSERT INTO collect_runs
           (collector_id, collector_name, started_at, finished_at, accepted, deduped, outcome, logs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            run.collector_id,
            run.collector_name,
            run.started_at,
            run.finished_at,
            run.accepted,
            run.deduped,
            run.outcome,
            logs_json
        ],
    )
    .map_err(|e| AppError::Internal { detail: format!("collect_runs insert: {e}") })?;
    tx.execute(
        "DELETE FROM collect_runs WHERE id NOT IN
           (SELECT id FROM collect_runs ORDER BY id DESC LIMIT ?1)",
        params![MAX_RUNS],
    )
    .map_err(|e| AppError::Internal { detail: format!("collect_runs evict: {e}") })?;
    tx.commit()
        .map_err(|e| AppError::Internal { detail: format!("collect_runs commit: {e}") })
}

/// All runs (≤ 100), newest-first by `started_at` (time order, not insert
/// order — the one-time legacy migration may insert old rows late).
/// Read errors collapse to an empty list, same as the query layer.
pub fn list_collect_runs(conn: &Connection) -> Vec<CollectRunRow> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT collector_id, collector_name, started_at,
                COALESCE(finished_at, started_at), accepted, deduped, outcome, logs
         FROM collect_runs ORDER BY started_at DESC, id DESC",
    ) else {
        return vec![];
    };
    let Ok(rows) = stmt.query_map([], |row| {
        let logs_json: String = row.get(7)?;
        Ok(CollectRunRow {
            collector_id: row.get(0)?,
            collector_name: row.get(1)?,
            started_at: row.get(2)?,
            finished_at: row.get(3)?,
            accepted: row.get(4)?,
            deduped: row.get(5)?,
            outcome: row.get(6)?,
            logs: serde_json::from_str(&logs_json).unwrap_or_default(),
        })
    }) else {
        return vec![];
    };
    rows.filter_map(|r| r.ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::db::test_conn;

    fn run(i: i64, log_lines: usize) -> CollectRunIn {
        CollectRunIn {
            collector_id: "git.commit".into(),
            collector_name: "Git".into(),
            started_at: i,
            finished_at: Some(i + 1),
            accepted: 1,
            deduped: 0,
            outcome: "ok".into(),
            logs: (0..log_lines).map(|n| format!("line {n}")).collect(),
        }
    }

    #[test]
    fn insert_list_roundtrip_and_log_cap() {
        let mut conn = test_conn();
        insert_collect_run(&mut conn, &run(1, 80)).unwrap();
        insert_collect_run(
            &mut conn,
            &CollectRunIn { finished_at: None, ..run(2, 0) },
        )
        .unwrap();
        let rows = list_collect_runs(&conn);
        assert_eq!(rows.len(), 2);
        // Newest first; null finished_at coalesces to started_at.
        assert_eq!((rows[0].started_at, rows[0].finished_at), (2, 2));
        assert_eq!(rows[1].started_at, 1);
        // 80 logs hard-capped at 50, content preserved up to the cap.
        assert_eq!(rows[1].logs.len(), 50);
        assert_eq!(rows[1].logs[49], "line 49");
    }

    #[test]
    fn evicts_beyond_100_keeping_newest() {
        let mut conn = test_conn();
        for i in 0..105 {
            insert_collect_run(&mut conn, &run(i, 0)).unwrap();
        }
        let rows = list_collect_runs(&conn);
        assert_eq!(rows.len(), 100);
        assert_eq!(rows[0].started_at, 104);
        assert_eq!(rows[99].started_at, 5);
    }
}
