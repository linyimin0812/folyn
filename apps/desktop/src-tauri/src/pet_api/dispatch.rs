// Pure payload parsing + action dispatch for the pet external HTTP API
// (PRD: pet-external-notify-api). No I/O, no Tauri — unit-testable directly.
//
// The HTTP layer (`mod.rs`) reads the raw body, then calls `route_action`,
// which returns one of three outcomes. The caller is responsible for emitting
// `pet://notify` (Tauri `AppHandle::emit`) and mapping outcomes to HTTP
// status codes (200 / 400 / 501). Keeping parsing out of the server thread's
// I/O path lets `route_action` be exercised with plain `&str` bodies.

use serde::Serialize;
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
    pub target: Option<PetTarget>,
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

/// Whitelist for `kind` — matches the TS `PetBubbleKind` union.
const VALID_KINDS: [&str; 4] = ["info", "reminder", "message", "event"];

/// The longest `text` we accept. Generous for a notification, tight enough
/// that a caller can't use the API as a memory sink. Mirrors a sane display
/// ceiling; the bubble UI truncates visually anyway.
pub const MAX_TEXT_CHARS: usize = 4096;

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
    Ok(PetNotifyPayload {
        title,
        text: text.into(),
        kind: kind.into(),
        target,
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
}
