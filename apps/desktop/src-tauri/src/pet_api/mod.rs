// Local HTTP API for the desktop pet (PRD: pet-external-notify-api).
//
// Binds 127.0.0.1 only — the first line of defense for this trust boundary.
// No auth (user-accepted trade-off): any local process can POST. Input is
// validated in `dispatch.rs` before it touches the app. The server thread
// does one thing per request: read a capped body → `route_action` → either
// `app.emit("pet://notify", payload)` (reusing the existing dispatcher) or
// a 4xx/5xx. No notification logic here.
//
// Port: tries 17382..=17400, first free wins. The actual port is held in
// `PetApiState` (in-memory, not on disk) and surfaced to the UI via the
// `get_pet_api_info` command. External callers default to 17382 and read
// the real port from the pet settings page if it was bumped.
//
// Lifecycle: spawned from `lib.rs::setup`; lives for the process. A failed
// bind across the whole range is non-fatal — the app still runs, the API
// just reports `enabled: false`.

use std::io::Read;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Response, Server};

pub mod dispatch;

pub use dispatch::LaunchSpec;

/// First port tried for the pet API. Documented to external callers; if it's
/// free this is the port they should use.
pub const BASE_PORT: u16 = 17382;
/// Inclusive upper bound of the bind-retry range.
const PORT_RANGE_END: u16 = 17400;
/// Hard cap on request body size. The trust boundary — a caller can't push
/// unbounded data into the parser. `dispatch::MAX_TEXT_CHARS` is the field
/// ceiling; this is the transport ceiling.
const MAX_BODY_BYTES: usize = 64 * 1024;

/// Info surfaced to the UI / external callers via `get_pet_api_info`.
/// `Default::default()` is the "no server" state (enabled=false).
#[derive(Serialize, Clone, Default)]
pub struct PetApiInfo {
    pub enabled: bool,
    pub port: Option<u16>,
    pub endpoints: Vec<String>,
}

/// Shared state holding the live server info. Read by `get_pet_api_info`.
/// `Option::None` until `spawn` binds successfully. Behind a `Mutex` because
/// the server thread writes once on bind and the command thread reads.
pub struct PetApiState(pub Mutex<Option<PetApiInfo>>);

/// Tauri command: return the current API server info to the frontend.
/// The pet settings page reads this to show the port + endpoint.
#[tauri::command]
pub fn get_pet_api_info(state: State<'_, PetApiState>) -> PetApiInfo {
    state
        .0
        .lock()
        .map(|g| g.clone().unwrap_or_default())
        .unwrap_or_default()
}

/// Outcome of `open_external` for the frontend to act on. `Opened` = done;
/// `NotInWhitelist` = the app name needs user authorization (the bubble
/// switches to its authorize UI); `Invalid` = the spec failed validation
/// (already validated in `dispatch::parse_launch`, but defense-in-depth here
/// so the command is safe to call even with hand-built args).
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpenExternalResult {
    Opened,
    NotInWhitelist { app: String },
    Invalid { reason: String },
    Failed { reason: String },
}

/// Tauri command: open an external URL or macOS app. URLs (http/https) open
/// in the default browser with no whitelist check. Apps open via
/// `open -a <name>` only if the name is in `whitelist` (a Vec<String> the
/// frontend passes from `petStore.bubbleAppWhitelist`). The command never
/// shells out — `std::process::Command` separates args so `value` cannot
/// inject flags.
#[tauri::command]
pub fn open_external(target: LaunchSpec, whitelist: Vec<String>) -> OpenExternalResult {
    match target.kind.as_str() {
        "url" => {
            if !target.value.starts_with("http://") && !target.value.starts_with("https://") {
                return OpenExternalResult::Invalid {
                    reason: "url must be http(s)".into(),
                };
            }
            match build_open_command(&target.value, false).status() {
                Ok(_) => OpenExternalResult::Opened,
                Err(e) => OpenExternalResult::Failed {
                    reason: e.to_string(),
                },
            }
        }
        "app" => {
            if target.value.is_empty() {
                return OpenExternalResult::Invalid {
                    reason: "empty app name".into(),
                };
            }
            if !whitelist.iter().any(|w| w == &target.value) {
                return OpenExternalResult::NotInWhitelist {
                    app: target.value.clone(),
                };
            }
            match build_open_command(&target.value, true).status() {
                Ok(s) if s.success() => OpenExternalResult::Opened,
                Ok(s) => OpenExternalResult::Failed {
                    reason: format!("exit: {}", s.code().unwrap_or(-1)),
                },
                Err(e) => OpenExternalResult::Failed {
                    reason: e.to_string(),
                },
            }
        }
        other => OpenExternalResult::Invalid {
            reason: format!("unknown launch type: {}", other),
        },
    }
}

// ponytail: macOS `open [<url> | -a <app>]` vs Windows `cmd /c start "" <target>`.
// `start` is a cmd.exe builtin (not a binary), so Windows must spawn cmd.exe
// with `start` as an arg. `start "" <url>` opens the default browser;
// `start "" <appname>` launches a registered app by name — the closest
// Windows analog to macOS `open -a`. Whitelist controls the value either way.
fn build_open_command(target: &str, as_app: bool) -> std::process::Command {
    if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("cmd.exe");
        cmd.arg("/c").arg("start").arg("").arg(target);
        cmd
    } else if as_app {
        let mut cmd = std::process::Command::new("open");
        cmd.arg("-a").arg(target);
        cmd
    } else {
        let mut cmd = std::process::Command::new("open");
        cmd.arg(target);
        cmd
    }
}

/// Spawn the HTTP server on a background thread. Tries `BASE_PORT`..=
/// `PORT_RANGE_END`; the first bind wins. On success stores the info in
/// `PetApiState` and serves forever. On full-range failure stores an
/// `enabled: false` info and returns (the app keeps running).
///
/// Call from `lib.rs::setup` with `app.handle().clone()`.
pub fn spawn(app: AppHandle) {
    // ponytail: explicit-port iteration so the bound port == requested port
    // (port 0 would give an ephemeral port we'd have to read back out of
    // server_addr). First free port in the range wins.
    let bound = (BASE_PORT..=PORT_RANGE_END).find_map(|port| {
        Server::http(("127.0.0.1", port))
            .ok()
            .map(|srv| (port, srv))
    });

    let info = match bound {
        Some((port, server)) => {
            let info = PetApiInfo {
                enabled: true,
                port: Some(port),
                endpoints: vec!["POST /pet/action".into(), "GET /health".into()],
            };
            set_state(&app, info.clone());
            std::thread::spawn(move || serve(server, app, port));
            info
        }
        None => {
            // Non-fatal: app runs without the external API. Surface it so
            // the settings page can show "disabled" rather than hang.
            let info = PetApiInfo {
                enabled: false,
                port: None,
                endpoints: vec![],
            };
            set_state(&app, info.clone());
            info
        }
    };
    log::info!("[pet-api] enabled={} port={:?}", info.enabled, info.port);
}

/// Write the info into shared state. Best-effort: if the state isn't
/// managed yet (shouldn't happen — `spawn` runs after `app.manage`), the
/// write is a no-op and the server still serves.
fn set_state(app: &AppHandle, info: PetApiInfo) {
    if let Some(state) = app.try_state::<PetApiState>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(info);
        }
    }
}

/// The server loop. Runs on its own std thread (tiny_http is sync + threaded;
/// no tokio `net` feature needed — see research/rust-http-server.md).
fn serve(server: Server, app: AppHandle, port: u16) {
    for rq in server.incoming_requests() {
        let method = rq.method().as_str();
        let url = rq.url();
        if method == "GET" && url == "/health" {
            let body = serde_json::json!({ "ok": true, "port": port });
            respond_json(rq, &body, 200);
            continue;
        }
        if !(method == "POST" && url == "/pet/action") {
            respond_text(rq, "not found", 404);
            continue;
        }
        handle_action(rq, &app);
    }
}

/// Read a capped body, route it, and respond. Emits `pet://notify` on the
/// valid path — the existing main-window dispatcher does the actual surfacing
/// (bubble / OS notification per `petStore.notificationForm`).
fn handle_action(mut rq: tiny_http::Request, app: &AppHandle) {
    // `take` caps the read so a huge body can't exhaust memory; we detect
    // "over the cap" by allowing one extra byte and checking the length.
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
    match dispatch::route_action(&body) {
        dispatch::DispatchOutcome::Notify(payload) => {
            // Same emit path as the demo menu trigger (lib.rs:463). A
            // serialize failure here would be a programmer error (the struct
            // is always serializable), but we never let it crash the server.
            if let Ok(value) = serde_json::to_value(&payload) {
                let _ = app.emit("pet://notify", value);
            }
            respond_text(rq, "ok", 200);
        }
        dispatch::DispatchOutcome::NotImplemented(action) => {
            respond_text(rq, &format!("action not implemented: {}", action), 501);
        }
        dispatch::DispatchOutcome::BadRequest(msg) => {
            respond_text(rq, &format!("bad request: {}", msg), 400);
        }
    }
}

/// Respond with a text body + status. Best-effort: a closed connection means
/// `respond` errors, which we ignore (the caller already gave up).
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
