//! Fetch-RPC bridge for plugin tool windows.
//!
//! When a sandbox tool window (Tauri WebviewWindow loaded from
//! `mochi-plugin://localhost/<id>/<entry>`) POSTs to
//! `mochi-plugin://localhost/<id>/rpc`, the URI scheme handler in `lib.rs`
//! hands the request here. We emit a `plugin-rpc-request` event that the
//! main webview's `toolWindowRpcListener` picks up; it dispatches via the
//! shared `dispatchPluginRpc` (same permission checks as the iframe bridge)
//! and calls back via the `plugin_rpc_respond` Tauri command below. The
//! oneshot channel keyed by `request_id` is the join point.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::LazyLock;
use std::sync::Mutex;

use crate::errors::AppError;

static RPC_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// The response delivered by the main webview via `plugin_rpc_respond`.
/// `result` is an arbitrary JSON value (already permission-checked on the JS
/// side); `error` is a human-readable string. Exactly one is `Some`.
#[derive(Clone, Debug)]
pub struct RpcResponseData {
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Global pending-RPC table. Keyed by request_id (a u64 formatted as a
/// string). The URI handler inserts; `plugin_rpc_respond` removes and
/// resolves. ponytail: global lock — a per-plugin lock would only matter
/// if a single plugin saturates the bridge with thousands of concurrent
/// RPCs; upgrade to a sharded map if a real plugin hits contention.
pub static RPC_PENDING: LazyLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<RpcResponseData>>>> =
    LazyLock::new(|| {
        Mutex::new(HashMap::new())
    });

/// Generate a fresh request id (monotonic per-process). Format: `rpc-<n>`.
pub fn next_rpc_request_id() -> String {
    let n = RPC_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("rpc-{n}")
}

/// Tauri command invoked by the main webview's `toolWindowRpcListener`
/// after `dispatchPluginRpc` resolves. Delivers the result/error to the
/// URI handler waiting on the oneshot. Unknown `request_id`s are silently
/// dropped (the request may have timed out and been reaped).
#[tauri::command]
pub async fn plugin_rpc_respond(
    request_id: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> Result<(), AppError> {
    let sender = {
        let mut map = RPC_PENDING.lock().map_err(|e| format!("rpc pending lock poisoned: {e}"))?;
        map.remove(&request_id)
    };
    if let Some(sender) = sender {
        let _ = sender.send(RpcResponseData { result, error });
    }
    Ok(())
}

/// Entry point invoked by the URI scheme handler for `POST .../rpc`.
/// Spawns an async task that:
///   1. Inserts a oneshot sender into `RPC_PENDING` keyed by `request_id`.
///   2. Emits `plugin-rpc-request` with `{ requestId, pluginId, body }` to
///      the main webview.
///   3. Awaits the oneshot (30s timeout).
///   4. Calls `responder.respond(...)` with the JSON response (or 504 on
///      timeout). Removes the pending entry.
///
/// The body is forwarded as a raw string so Rust does not need to know the
/// RPC protocol shape; the main webview parses `JSON.parse(body)` into
/// `{ method, params }`.
pub fn handle_plugin_rpc_request(
    app: tauri::AppHandle,
    request_id: String,
    plugin_id: String,
    body: String,
    responder: tauri::UriSchemeResponder,
) {
    use tauri::Emitter;

    let (tx, rx) = tokio::sync::oneshot::channel::<RpcResponseData>();
    {
        if let Ok(mut map) = RPC_PENDING.lock() {
            map.insert(request_id.clone(), tx);
        }
    }

    let req_id_for_emit = request_id.clone();
    let req_id_for_cleanup = request_id.clone();
    tauri::async_runtime::spawn(async move {
        let payload = serde_json::json!({
            "requestId": req_id_for_emit,
            "pluginId": plugin_id,
            "body": body,
        });
        if let Err(e) = app.emit("plugin-rpc-request", payload) {
            log::warn!("[plugin-rpc] emit failed: {e}");
        }

        let response = match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            rx,
        )
        .await
        {
            Ok(Ok(data)) => {
                let body_json = if let Some(err) = data.error {
                    serde_json::json!({ "error": err })
                } else {
                    data.result.unwrap_or(serde_json::Value::Null)
                };
                let body_bytes = serde_json::to_vec(&body_json).unwrap_or_else(|_| b"null".to_vec());
                http::Response::builder()
                    .status(200)
                    .header("Content-Type", "application/json")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body_bytes)
                    .unwrap_or_else(|_| http::Response::new(b"null".to_vec()))
            }
            _ => http::Response::builder()
                .status(504)
                .header("Content-Type", "application/json")
                .body(br#"{"error":"rpc timeout"}"#.to_vec())
                .unwrap_or_else(|_| http::Response::new(br#"{"error":"rpc timeout"}"#.to_vec())),
        };

        // Best-effort cleanup: if the responder already responded (shouldn't
        // happen, but defensive) or the channel was already consumed, we still
        // remove the entry to avoid a leak.
        if let Ok(mut map) = RPC_PENDING.lock() {
            map.remove(&req_id_for_cleanup);
        }

        responder.respond(response);
    });
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_rpc_request_id_is_monotonic_and_unique() {
        let a = next_rpc_request_id();
        let b = next_rpc_request_id();
        let c = next_rpc_request_id();
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_ne!(a, c);
        // Format sanity: prefix + numeric suffix.
        assert!(a.starts_with("rpc-"));
    }

    #[tokio::test]
    async fn plugin_rpc_respond_delivers_result_to_pending_sender() {
        let request_id = format!("test-{}", std::process::id());
        let (tx, mut rx) = tokio::sync::oneshot::channel::<RpcResponseData>();
        {
            let mut map = RPC_PENDING.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }
        // Act: invoke the command as the main webview would.
        let result = serde_json::json!({ "ok": true });
        let _ = plugin_rpc_respond(request_id.clone(), Some(result.clone()), None)
            .await;
        // The pending entry is removed even on the timeout path; here the
        // happy path.
        let data = rx.try_recv().expect("response delivered via oneshot");
        assert_eq!(data.result, Some(result));
        assert!(data.error.is_none());
        // The map entry is gone after respond.
        assert!(RPC_PENDING
            .lock()
            .unwrap()
            .get(&request_id)
            .is_none());
    }

    #[tokio::test]
    async fn plugin_rpc_respond_delivers_error_to_pending_sender() {
        let request_id = format!("test-err-{}", std::process::id());
        let (tx, mut rx) = tokio::sync::oneshot::channel::<RpcResponseData>();
        {
            let mut map = RPC_PENDING.lock().unwrap();
            map.insert(request_id.clone(), tx);
        }
        let _ = plugin_rpc_respond(request_id.clone(), None, Some("denied".into())).await;
        let data = rx.try_recv().expect("error delivered via oneshot");
        assert!(data.result.is_none());
        assert_eq!(data.error.as_deref(), Some("denied"));
    }

    #[tokio::test]
    async fn plugin_rpc_respond_silently_drops_unknown_request_id() {
        // Unknown id (e.g., the request already timed out and was reaped).
        // Should not panic and should return Ok(()).
        let result = plugin_rpc_respond(
            "nonexistent-id".to_string(),
            Some(serde_json::Value::Null),
            None,
        )
        .await;
        assert!(result.is_ok());
    }
}
