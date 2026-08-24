// Pure payload parsing + action dispatch for the pet external HTTP API
// (PRD: pet-external-notify-api). No I/O, no Tauri — unit-testable directly.
//
// The HTTP layer (`mod.rs`) reads the raw body, then calls `route_action`,
// which returns one of three outcomes. The caller is responsible for emitting
// `pet://notify` (Tauri `AppHandle::emit`) and mapping outcomes to HTTP
// status codes (200 / 400 / 501). Keeping parsing out of the server thread's
// I/O path lets `route_action` be exercised with plain `&str` bodies.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A validated `notify` payload mirroring the TS `PetBubblePayload` contract
/// (`src/components/pet/PetBubbleApp.tsx`). Serialized and emitted on
/// `pet://notify` exactly like the demo menu path in `lib.rs:463`.
#[derive(Serialize, Clone, Debug)]
pub struct PetNotifyPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub text: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<PetTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch: Option<LaunchSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<Value>>,
}

/// `target` mirror of the TS `PetBubbleTarget` — flat `{ kind, id }`. The
/// `tag = "kind"` keeps the JSON shape `{ "kind": "schedule", "id": "..." }`
/// so the existing `routePetBubbleAction` (which switches on `target.kind`)
/// sees the same fields regardless of source.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PetTarget {
    Schedule { id: String },
    Chat { id: String },
    Task { id: String },
    File { id: String },
}

/// External-launch spec carried by `notify` payloads. `type = "url"` opens
/// http(s) links in the default browser; `type = "app"` opens a macOS app by
/// name (subject to a user-maintained whitelist — enforced by the
/// `open_external` command, not here). Rust never shells out —
/// `std::process::Command` separates args, so `value` cannot inject flags.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LaunchSpec {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: String,
}

/// Whitelist for `kind` — matches the TS `PetBubbleKind` union.
const VALID_KINDS: [&str; 4] = ["info", "reminder", "message", "event"];

/// The longest `text` we accept. Generous for a notification, tight enough
/// that a caller can't use the API as a memory sink. Mirrors a sane display
/// ceiling; the bubble UI truncates visually anyway.
pub const MAX_TEXT_CHARS: usize = 4096;
/// Max length of the `source` field. Caller identity string — short label.
pub const MAX_SOURCE_CHARS: usize = 128;
/// Max length of the `template` field (template id). Short identifier.
pub const MAX_TEMPLATE_CHARS: usize = 64;
/// Max length of `launch.value`. URL or app name; well under this in practice.
pub const MAX_LAUNCH_VALUE_CHARS: usize = 512;

/// Outcome of routing a request body. Pure value — the caller decides the
/// side effect (emit) and the HTTP status.
pub enum DispatchOutcome {
    /// Valid `notify` action → emit this payload.
    Notify(PetNotifyPayload),
    /// Action the API recognizes the shape of but does not implement (e.g.
    /// future `show`/`hide`). Caller maps to 501.
    NotImplemented(String),
    /// Malformed body — invalid JSON, missing `text`, bad `kind`, bad target.
    /// Caller maps to 400.
    BadRequest(String),
}

/// Route a raw JSON body by its `action` field. Pure — no allocations beyond
/// the payload itself, no I/O. Entry point for the HTTP layer.
pub fn route_action(body: &str) -> DispatchOutcome {
    let v: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return DispatchOutcome::BadRequest("invalid json".into()),
    };
    let action = v.get("action").and_then(|x| x.as_str()).unwrap_or("");
    match action {
        "notify" => match build_notify(&v) {
            Ok(p) => DispatchOutcome::Notify(p),
            Err(msg) => DispatchOutcome::BadRequest(msg),
        },
        "" => DispatchOutcome::BadRequest("missing action".into()),
        other => DispatchOutcome::NotImplemented(other.into()),
    }
}

/// Validate the `notify` payload fields. Returns an owned `PetNotifyPayload`
/// on success, or a human-readable reason on failure. Pure.
fn build_notify(v: &Value) -> Result<PetNotifyPayload, String> {
    let text = v
        .get("text")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "missing text".to_string())?;
    if text.trim().is_empty() {
        return Err("empty text".into());
    }
    // Char-count (not byte) so multi-byte CJK counts as one char per grapheme
    // cluster boundary-ish — good enough for a length ceiling.
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("text too long".into());
    }
    let kind = v.get("kind").and_then(|x| x.as_str()).unwrap_or("info");
    if !VALID_KINDS.contains(&kind) {
        return Err(format!("invalid kind: {}", kind));
    }
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let target = v.get("target").map(parse_target).transpose()?;
    let source = v
        .get("source")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_SOURCE_CHARS).collect::<String>());
    let data = v.get("data").filter(|x| x.is_object()).cloned();
    let template = v
        .get("template")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(MAX_TEMPLATE_CHARS).collect::<String>());
    let launch = v.get("launch").map(parse_launch).transpose()?;
    // Pass through actions array as opaque Values — the bubble renderer +
    // DOMPurify handle the inner HTML. We only sanity-check it's an array.
    let actions = v
        .get("actions")
        .filter(|x| x.is_array())
        .and_then(|x| x.as_array().map(|a| a.clone().into_iter().collect::<Vec<_>>()));
    Ok(PetNotifyPayload {
        title,
        text: text.into(),
        kind: kind.into(),
        source,
        data,
        template,
        target,
        launch,
        actions: if actions.as_ref().map(|a| a.is_empty()).unwrap_or(true) {
            None
        } else {
            actions
        },
    })
}

/// Parse the optional `target` object. Missing/empty is fine (None); a present
/// but malformed target is an error so a caller can't silently lose the jump.
fn parse_target(v: &Value) -> Result<PetTarget, String> {
    let kind = v
        .get("kind")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "target missing kind".to_string())?;
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "target missing id".to_string())?;
    if id.is_empty() {
        return Err("target empty id".into());
    }
    match kind {
        "schedule" => Ok(PetTarget::Schedule { id: id.into() }),
        "chat" => Ok(PetTarget::Chat { id: id.into() }),
        "task" => Ok(PetTarget::Task { id: id.into() }),
        "file" => Ok(PetTarget::File { id: id.into() }),
        _ => Err(format!("invalid target kind: {}", kind)),
    }
}

/// Parse the optional `launch` object. `type` must be `"url"` or `"app"`;
/// `value` must be non-empty and under `MAX_LAUNCH_VALUE_CHARS`. URL values
/// must start with `http://` or `https://`; app values must match
/// `[A-Za-z0-9 .\-]+` and contain no path separators (defense-in-depth —
/// the actual open() call uses arg separation, but we reject early so
/// malformed requests never reach the bubble's launch UI).
fn parse_launch(v: &Value) -> Result<LaunchSpec, String> {
    let kind = v
        .get("type")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "launch missing type".to_string())?;
    let value = v
        .get("value")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "launch missing value".to_string())?;
    if value.is_empty() {
        return Err("launch empty value".into());
    }
    if value.chars().count() > MAX_LAUNCH_VALUE_CHARS {
        return Err("launch value too long".into());
    }
    match kind {
        "url" => {
            if !value.starts_with("http://") && !value.starts_with("https://") {
                return Err("launch url must be http(s)".into());
            }
            Ok(LaunchSpec {
                kind: "url".into(),
                value: value.into(),
            })
        }
        "app" => {
            // App name: alphanumerics, space, dot, dash only. No path
            // separators — prevents `../`, absolute paths, shell metachars.
            if !value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '.' || c == '-')
            {
                return Err("launch app name has invalid characters".into());
            }
            Ok(LaunchSpec {
                kind: "app".into(),
                value: value.into(),
            })
        }
        _ => Err(format!("invalid launch type: {}", kind)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notify_body(text: &str) -> String {
        format!(r#"{{"action":"notify","kind":"info","text":"{}"}}"#, text)
    }

    #[test]
    fn valid_notify_minimal() {
        let out = route_action(&notify_body("hi"));
        match out {
            DispatchOutcome::Notify(p) => {
                assert_eq!(p.text, "hi");
                assert_eq!(p.kind, "info");
                assert!(p.title.is_none());
                assert!(p.target.is_none());
            }
            _ => panic!("expected Notify, got {:?}", "other"),
        }
    }

    #[test]
    fn valid_notify_with_target_and_title() {
        let body = r#"{"action":"notify","kind":"reminder","title":"T","text":"x","target":{"kind":"schedule","id":"a/b"}}"#;
        let out = route_action(body);
        match out {
            DispatchOutcome::Notify(p) => {
                assert_eq!(p.title.as_deref(), Some("T"));
                assert_eq!(p.kind, "reminder");
                match p.target {
                    Some(PetTarget::Schedule { id }) => assert_eq!(id, "a/b"),
                    other => panic!("wrong target: {:?}", other),
                }
            }
            _ => panic!("expected Notify"),
        }
    }

    #[test]
    fn defaults_kind_to_info() {
        let body = r#"{"action":"notify","text":"x"}"#;
        match route_action(body) {
            DispatchOutcome::Notify(p) => assert_eq!(p.kind, "info"),
            _ => panic!("expected Notify"),
        }
    }

    #[test]
    fn rejects_missing_text() {
        let body = r#"{"action":"notify","kind":"info"}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_empty_text() {
        let body = r#"{"action":"notify","kind":"info","text":"   "}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_bad_kind() {
        let body = r#"{"action":"notify","kind":"nope","text":"x"}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_text_too_long() {
        let big = "a".repeat(MAX_TEXT_CHARS + 1);
        assert!(matches!(
            route_action(&notify_body(&big)),
            DispatchOutcome::BadRequest(_)
        ));
    }

    #[test]
    fn rejects_bad_target_kind() {
        let body =
            r#"{"action":"notify","kind":"info","text":"x","target":{"kind":"wat","id":"y"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_target_missing_id() {
        let body = r#"{"action":"notify","kind":"info","text":"x","target":{"kind":"schedule"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn unknown_action_is_not_implemented() {
        let body = r#"{"action":"show","text":"x"}"#;
        match route_action(body) {
            DispatchOutcome::NotImplemented(a) => assert_eq!(a, "show"),
            _ => panic!("expected NotImplemented"),
        }
    }

    #[test]
    fn missing_action_is_bad_request() {
        let body = r#"{"text":"x"}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn invalid_json_is_bad_request() {
        assert!(matches!(
            route_action("{not json"),
            DispatchOutcome::BadRequest(_)
        ));
    }

    #[test]
    fn payload_serializes_to_ts_contract_shape() {
        let body = r#"{"action":"notify","kind":"reminder","title":"T","text":"x","target":{"kind":"file","id":"f"}}"#;
        if let DispatchOutcome::Notify(p) = route_action(body) {
            let json = serde_json::to_value(&p).unwrap();
            assert_eq!(json["text"], "x");
            assert_eq!(json["kind"], "reminder");
            assert_eq!(json["title"], "T");
            assert_eq!(json["target"]["kind"], "file");
            assert_eq!(json["target"]["id"], "f");
        }
    }

    #[test]
    fn passthrough_data_source_template_fields() {
        let body = r#"{"action":"notify","text":"x","source":"github","template":"glass","data":{"repo":"folyn","runId":42}}"#;
        let p = match route_action(body) {
            DispatchOutcome::Notify(p) => p,
            _ => panic!("expected Notify"),
        };
        assert_eq!(p.source.as_deref(), Some("github"));
        assert_eq!(p.template.as_deref(), Some("glass"));
        let data = p.data.expect("data passthrough");
        assert_eq!(data["repo"], "folyn");
        assert_eq!(data["runId"], 42);
    }

    #[test]
    fn passthrough_launch_url() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"url","value":"https://ci.example.com/r/1"}}"#;
        let p = match route_action(body) {
            DispatchOutcome::Notify(p) => p,
            _ => panic!("expected Notify"),
        };
        let l = p.launch.expect("launch");
        assert_eq!(l.kind, "url");
        assert_eq!(l.value, "https://ci.example.com/r/1");
    }

    #[test]
    fn passthrough_launch_app() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"app","value":"Xcode"}}"#;
        let p = match route_action(body) {
            DispatchOutcome::Notify(p) => p,
            _ => panic!("expected Notify"),
        };
        let l = p.launch.expect("launch");
        assert_eq!(l.kind, "app");
        assert_eq!(l.value, "Xcode");
    }

    #[test]
    fn rejects_launch_url_non_http() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"url","value":"file:///etc/passwd"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_launch_app_with_path_separator() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"app","value":"a/b"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_launch_app_with_shell_metachar() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"app","value":"a;rm -rf"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_launch_bad_type() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"shell","value":"ls"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn rejects_launch_missing_value() {
        let body = r#"{"action":"notify","text":"x","launch":{"type":"url"}}"#;
        assert!(matches!(route_action(body), DispatchOutcome::BadRequest(_)));
    }

    #[test]
    fn passthrough_actions_array() {
        let body = r#"{"action":"notify","text":"x","actions":[{"id":"view","label":"查看"},{"id":"open","label":"打开"}]}"#;
        let p = match route_action(body) {
            DispatchOutcome::Notify(p) => p,
            _ => panic!("expected Notify"),
        };
        let actions = p.actions.expect("actions");
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0]["id"], "view");
    }

    #[test]
    fn empty_actions_array_serialized_as_none() {
        let body = r#"{"action":"notify","text":"x","actions":[]}"#;
        let p = match route_action(body) {
            DispatchOutcome::Notify(p) => p,
            _ => panic!("expected Notify"),
        };
        assert!(p.actions.is_none(), "empty actions should be None");
    }
}
