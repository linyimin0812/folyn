//! Local HTTP server routing inbound webhooks to activity collectors
//! (design folyn-activity-collection-design.md §2.1 webhook mode).
//!
//! Mirrors `pet_api`: binds 127.0.0.1 only, bind-retry across
//! 17481..=17499 (a range distinct from pet_api's 17382..=17400), serves
//! forever on its own std thread. A failed bind across the whole range is
//! non-fatal — the app runs, `activity_webhook_info` reports `enabled:false`.
//!
//! The server does one thing per request: read a capped body → route →
//! `app.emit("activity://webhook", {collectorId, payload})` → 202. The
//! main window's collector runtime (`services/activity/runtime.ts`) owns
//! the actual dispatch to the collector's `onWebhook` — no collector logic
//! here. Route shape:
//!   POST /:collectorId  → 202 {"ok":true} (payload JSON-parsed, cap 1MB)
//!   GET  /health        → 200 {"ok":true,"port":<port>}
//!   wrong method        → 405
//!   anything else       → 404
//!
//! No auth (same user-accepted trade-off as pet_api): any local process can
//! POST. Unknown/disabled collectors are dropped with a log on the JS side,
//! and the ingest pipeline validates the events themselves.

use std::io::Read;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Response, Server};

/// First port tried for the activity webhook server. Documented to external
/// callers; first free port in the range wins.
pub const BASE_PORT: u16 = 17481;
/// Inclusive upper bound of the bind-retry range (distinct from pet_api's).
const PORT_RANGE_END: u16 = 17499;
/// Hard cap on request body size — the transport ceiling for a webhook
/// payload (design says ~1MB is plenty for one event batch).
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Info surfaced to the UI / external callers via `activity_webhook_info`.
/// `Default::default()` is the "no server" state (enabled=false).
#[derive(Serialize, Clone, Default)]
pub struct ActivityWebhookInfo {
    pub enabled: bool,
    pub port: Option<u16>,
    /// `POST http://127.0.0.1:<port>/<collectorId>` — shown in the collector
    /// config panel so the user can paste it into the external system.
    pub endpoint: Option<String>,
}

/// Shared state holding the live server info. Read by `activity_webhook_info`.
pub struct ActivityWebhookState(pub Mutex<Option<ActivityWebhookInfo>>);

/// Tauri command: return the current webhook server info to the frontend.
#[tauri::command]
pub fn activity_webhook_info(state: State<'_, ActivityWebhookState>) -> ActivityWebhookInfo {
    state
        .0
        .lock()
        .map(|g| g.clone().unwrap_or_default())
        .unwrap_or_default()
}

/// Route decision for one inbound request. Pure — unit-tested below.
#[derive(Debug, PartialEq)]
pub enum RouteDecision {
    Health,
    /// A syntactically valid collector id path segment.
    Collector(String),
    MethodNotAllowed,
    NotFound,
}

/// A collector id is a manifest-declared segment (`contributes.collectors[].id`)
/// — kebab-case-ish ASCII. Anything else is an unknown path (404), not a
/// collector.
fn is_valid_collector_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Route `(method, url)` to a decision. Query strings are ignored.
pub fn route_request(method: &str, url: &str) -> RouteDecision {
    let path = url.split('?').next().unwrap_or(url);
    let segments: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    if segments.as_slice() == ["health"] {
        return if method == "GET" {
            RouteDecision::Health
        } else {
            RouteDecision::MethodNotAllowed
        };
    }
    if segments.len() == 1 && is_valid_collector_segment(segments[0]) {
        return if method == "POST" {
            RouteDecision::Collector(segments[0].to_string())
        } else {
            RouteDecision::MethodNotAllowed
        };
    }
    RouteDecision::NotFound
}

/// Spawn the HTTP server on a background thread (call from `lib.rs::setup`
/// with `app.handle().clone()`). Same explicit-port iteration as pet_api so
/// the bound port == requested port.
pub fn spawn(app: AppHandle) {
    let bound = (BASE_PORT..=PORT_RANGE_END)
        .find_map(|port| Server::http(("127.0.0.1", port)).ok().map(|srv| (port, srv)));

    let info = match bound {
        Some((port, server)) => {
            let info = ActivityWebhookInfo {
                enabled: true,
                port: Some(port),
                endpoint: Some(format!("POST http://127.0.0.1:{port}/<collectorId>")),
            };
            set_state(&app, info.clone());
            std::thread::spawn(move || serve(server, app, port));
            info
        }
        None => {
            // Non-fatal: app runs without webhook routing; the collectors UI
            // shows "disabled" via `activity_webhook_info`.
            let info = ActivityWebhookInfo::default();
            set_state(&app, info.clone());
            info
        }
    };
    log::info!(
        "[activity-webhook] enabled={} port={:?}",
        info.enabled,
        info.port
    );
}

/// Write the info into shared state. Best-effort, same contract as pet_api.
fn set_state(app: &AppHandle, info: ActivityWebhookInfo) {
    if let Some(state) = app.try_state::<ActivityWebhookState>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(info);
        }
    }
}

/// The server loop (std thread; tiny_http is sync + threaded).
fn serve(server: Server, app: AppHandle, port: u16) {
    for rq in server.incoming_requests() {
        let method = rq.method().as_str();
        let url = rq.url();
        match route_request(method, url) {
            RouteDecision::Health => {
                respond_json(rq, &serde_json::json!({ "ok": true, "port": port }), 200);
            }
            RouteDecision::MethodNotAllowed => {
                respond_text(rq, "method not allowed", 405);
            }
            RouteDecision::NotFound => {
                respond_text(rq, "not found", 404);
            }
            RouteDecision::Collector(collector_id) => {
                handle_webhook(rq, &app, collector_id);
            }
        }
    }
}

/// Read a capped body, JSON-parse it, and emit `activity://webhook` to the
/// main window. The JS-side `dispatchWebhook` owns everything after this —
/// unknown/disabled collectors are logged + dropped there.
fn handle_webhook(mut rq: tiny_http::Request, app: &AppHandle, collector_id: String) {
    // Same take(cap+1) trick as pet_api so a huge body can't exhaust memory.
    let mut buf: Vec<u8> = Vec::new();
    let reader = rq.as_reader();
    let read = reader
        .take((MAX_BODY_BYTES + 1) as u64)
        .read_to_end(&mut buf);
    if read.is_err() {
        respond_text(rq, "read error", 400);
        return;
    }
    if buf.len() > MAX_BODY_BYTES {
        respond_text(rq, "body too large", 413);
        return;
    }
    let body = String::from_utf8_lossy(&buf);
    let payload: serde_json::Value = match serde_json::from_str(body.trim()) {
        Ok(v) => v,
        Err(e) => {
            respond_text(rq, &format!("bad json: {e}"), 400);
            return;
        }
    };
    let _ = app.emit(
        "activity://webhook",
        serde_json::json!({ "collectorId": collector_id, "payload": payload }),
    );
    respond_json(rq, &serde_json::json!({ "ok": true }), 202);
}

/// Respond with a text body + status. Best-effort (closed connection ignored).
fn respond_text(rq: tiny_http::Request, body: &str, status: u16) {
    let _ = rq.respond(Response::from_string(body).with_status_code(status));
}

/// Respond with a JSON value + status + content-type.
fn respond_json(rq: tiny_http::Request, value: &serde_json::Value, status: u16) {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
    let resp = Response::from_string(body)
        .with_status_code(status)
        .with_header(
            Header::from_bytes("Content-Type", "application/json")
                .expect("static header bytes are valid"),
        );
    let _ = rq.respond(resp);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_collector_posts() {
        assert_eq!(
            route_request("POST", "/git-commit"),
            RouteDecision::Collector("git-commit".into())
        );
        assert_eq!(
            route_request("POST", "/webhook?token=1"),
            RouteDecision::Collector("webhook".into())
        );
    }

    #[test]
    fn wrong_method_is_405_not_404() {
        assert_eq!(route_request("GET", "/git-commit"), RouteDecision::MethodNotAllowed);
        assert_eq!(route_request("DELETE", "/health"), RouteDecision::MethodNotAllowed);
    }

    #[test]
    fn health_is_get_only() {
        assert_eq!(route_request("GET", "/health"), RouteDecision::Health);
    }

    #[test]
    fn unknown_or_invalid_paths_are_404() {
        assert_eq!(route_request("POST", "/"), RouteDecision::NotFound);
        assert_eq!(route_request("POST", "/a/b"), RouteDecision::NotFound);
        // path separators / traversal in the segment → not a collector id
        assert_eq!(route_request("POST", "/..%2Fetc"), RouteDecision::NotFound);
        assert_eq!(route_request("POST", "/bad segment"), RouteDecision::NotFound);
    }
}
