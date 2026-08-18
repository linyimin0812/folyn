//! Plugin URI scheme handler + the on-disk registry (`plugins.json`) of
//! installed plugins.
//!
//! Sandbox-tier plugins live under `~/.quill/plugins/<id>/`. The URI scheme
//! serves their static assets (HTML/JS/CSS) to a sandboxed iframe so the host
//! never gives plugins raw Tauri capabilities. Install/list/uninstall
//! commands (in `plugin_install` / `plugin_lifecycle`) manage the on-disk
//! registry here and emit lifecycle events.
//!
//! This module is the shared core: it owns the `PluginEntry` type, the
//! `plugins_dir` resolver, the `plugins.json` read/write/upsert/remove
//! helpers, the `quill-plugin://` URI parser + CSP, and the
//! `is_valid_plugin_id` path-safety helper used by `plugin_fetch` and
//! `plugin_lifecycle`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

// ── URI scheme handler ───────────────────────────────────────────────────────

/// Parse a `quill-plugin://localhost/<id>/<path>` URI into `(plugin_id, file_path)`.
///
/// The URI path is `/<id>/<rest...>`. Returns `None` if the path is empty or
/// the id segment is missing. Path-traversal segments (`..`) are rejected.
pub fn parse_plugin_uri(uri_path: &str) -> Option<(String, String)> {
    let trimmed = uri_path.strip_prefix('/').unwrap_or(uri_path);
    let mut parts = trimmed.splitn(2, '/');
    let id = parts.next().filter(|s| !s.is_empty())?;
    let rest = parts.next().unwrap_or("");
    if rest.contains("..") {
        return None;
    }
    // Strip leading slashes from the file path and reject absolute traversal.
    let clean_rest = rest.trim_start_matches('/');
    Some((id.to_string(), clean_rest.to_string()))
}

/// Return the MIME `Content-Type` for a file based on its extension.
pub fn content_type_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// The CSP header injected into every plugin asset response. Sandbox plugins
/// get `default-src 'none'` so they can do nothing without going through the
/// host RPC bridge. `script-src 'unsafe-inline' quill-plugin:` lets the
/// plugin's HTML embed inline scripts AND load `<script src>` assets from the
/// plugin's own directory (Chromium does not resolve `'self'` to the document
/// origin for custom schemes like `quill-plugin://localhost`, so the scheme
/// must be named explicitly); `style-src 'unsafe-inline'` for inline styles.
/// `connect-src quill-plugin:` lets plugin JS call `fetch('quill-plugin://localhost/<id>/rpc', ...)`.
pub const PLUGIN_CSP: &str =
    "default-src 'none'; script-src 'unsafe-inline' quill-plugin:; style-src 'unsafe-inline'; connect-src quill-plugin:";

/// Resolve `~/.quill/plugins/` using the Tauri path resolver.
pub fn plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".quill").join("plugins"))
}

// ── On-disk registry (plugins.json) ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub tier: String,
    /// TOFU trust flag. `false` on install; set to `true` by `approve_plugin`
    /// (the explicit user-pin consent). The trusted-tier loader refuses to
    /// `import()` a plugin whose `trusted` is false.
    #[serde(default)]
    pub trusted: bool,
    /// Per-file SHA-256 hashes (relpath → hex), computed at install time.
    /// The trusted loader recomputes the hash of `main` before `import()` and
    /// compares it here — the real security boundary for the in-process tier.
    #[serde(default)]
    pub integrity: HashMap<String, String>,
    /// Optional ed25519 signature (standard base64) over the canonicalized
    /// manifest JSON. PR4 scaffolding — MVP does NOT require signatures; when
    /// absent, `verify_plugin_signature` returns `Ok(())` and SHA-256
    /// integrity remains the gate. A future marketplace may require this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Optional pinned publisher public key (standard base64, ed25519).
    /// When `signature` is present, this key verifies it. Trust-On-First-Use:
    /// the first time a plugin is approved, its publisher key is pinned; a
    /// later update with a different key must re-trigger consent.
    #[serde(default, rename = "publisherPublicKey", skip_serializing_if = "Option::is_none")]
    pub publisher_public_key: Option<String>,
}

/// Read `plugins.json` from the plugins dir. Returns an empty vec if the file
/// does not exist yet (fresh install path).
pub fn read_plugins_json(dir: &Path) -> Result<Vec<PluginEntry>, String> {
    let path = dir.join("plugins.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Write the full record set to `plugins.json`. Creates the dir if missing.
pub fn write_plugins_json(dir: &Path, records: &[PluginEntry]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    let path = dir.join("plugins.json");
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Upsert a record by id. If an entry with the same id exists, it is replaced;
/// otherwise the record is appended. Returns the updated vec.
pub fn upsert_record(mut records: Vec<PluginEntry>, record: PluginEntry) -> Vec<PluginEntry> {
    if let Some(existing) = records.iter_mut().find(|r| r.id == record.id) {
        *existing = record;
    } else {
        records.push(record);
    }
    records
}

/// Remove a record by id. Returns the filtered vec (records that remain).
pub fn remove_record(mut records: Vec<PluginEntry>, id: &str) -> Vec<PluginEntry> {
    records.retain(|r| r.id != id);
    records
}

/// Validate a `plugin_id` segment used to build a manifest path. Rejects empty,
/// `.`/`..`-bearing, and path-separator-containing ids so a caller cannot point
/// at another plugin's manifest on disk (defense-in-depth: the JS bridge passes
/// a trusted id, but this holds even if the bridge is bypassed). Pure — no I/O.
pub fn is_valid_plugin_id(id: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    // Any '.' (covers `.` and `..`), '/' or '\' could escape the plugin dir.
    !id.contains('.') && !id.contains('/') && !id.contains('\\')
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_plugin_uri ──

    #[test]
    fn parse_uri_basic() {
        let (id, path) = parse_plugin_uri("/my-plugin/index.html").unwrap();
        assert_eq!(id, "my-plugin");
        assert_eq!(path, "index.html");
    }

    #[test]
    fn parse_uri_nested_path() {
        let (id, path) = parse_plugin_uri("/my-plugin/assets/style.css").unwrap();
        assert_eq!(id, "my-plugin");
        assert_eq!(path, "assets/style.css");
    }

    #[test]
    fn parse_uri_no_path() {
        let (id, path) = parse_plugin_uri("/my-plugin").unwrap();
        assert_eq!(id, "my-plugin");
        assert_eq!(path, "");
    }

    #[test]
    fn parse_uri_empty() {
        assert!(parse_plugin_uri("").is_none());
    }

    #[test]
    fn parse_uri_rejects_traversal() {
        assert!(parse_plugin_uri("/my-plugin/../other/data").is_none());
    }

    #[test]
    fn parse_uri_strips_leading_slash_from_path() {
        let (id, path) = parse_plugin_uri("/my-plugin//index.html").unwrap();
        assert_eq!(id, "my-plugin");
        assert_eq!(path, "index.html");
    }

    // ── content_type_for ──

    #[test]
    fn content_type_html() {
        assert!(content_type_for("index.html").starts_with("text/html"));
    }

    #[test]
    fn content_type_js() {
        assert!(content_type_for("app.js").starts_with("text/javascript"));
    }

    #[test]
    fn content_type_css() {
        assert!(content_type_for("style.css").starts_with("text/css"));
    }

    #[test]
    fn content_type_unknown() {
        assert_eq!(content_type_for("file.xyz"), "application/octet-stream");
    }

    // ── plugins.json upsert/remove ──

    /// Test helper: build a PluginEntry with default trusted/integrity.
    fn make_entry(id: &str, name: &str, version: &str) -> PluginEntry {
        PluginEntry {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            tier: "sandbox".into(),
            trusted: false,
            integrity: HashMap::new(),
            signature: None,
            publisher_public_key: None,
        }
    }

    #[test]
    fn upsert_appends_new() {
        let records = vec![];
        let entry = make_entry("a", "A", "1");
        let result = upsert_record(records, entry);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "a");
    }

    #[test]
    fn upsert_replaces_existing() {
        let old = make_entry("a", "A", "1");
        let new = make_entry("a", "A2", "2");
        let result = upsert_record(vec![old], new);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].version, "2");
        assert_eq!(result[0].name, "A2");
    }

    #[test]
    fn remove_by_id() {
        let a = make_entry("a", "A", "1");
        let b = make_entry("b", "B", "1");
        let result = remove_record(vec![a, b], "a");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "b");
    }

    #[test]
    fn remove_nonexistent_is_noop() {
        let a = make_entry("a", "A", "1");
        let result = remove_record(vec![a], "zzz");
        assert_eq!(result.len(), 1);
    }

    // ── approve_plugin (pure upsert trust logic) ──

    #[test]
    fn upsert_sets_trusted_true_on_approve() {
        let mut entry = make_entry("a", "A", "1");
        assert!(!entry.trusted);
        entry.trusted = true;
        let records = upsert_record(vec![], entry);
        assert!(records[0].trusted);
    }

    #[test]
    fn approve_does_not_reset_integrity() {
        let mut entry = make_entry("a", "A", "1");
        entry.integrity.insert("index.js".into(), "deadbeef".into());
        // Simulate approve: set trusted only, integrity preserved.
        entry.trusted = true;
        assert_eq!(entry.integrity.get("index.js"), Some(&"deadbeef".to_string()));
    }

    // ── PluginEntry serde round-trip (backwards compat) ──

    #[test]
    fn entry_deserializes_without_trusted_integrity_fields() {
        // Old plugins.json entries (pre-PR3) lack `trusted`/`integrity`.
        let json = serde_json::json!({
            "id": "old-plugin",
            "name": "Old",
            "version": "0.1.0",
            "tier": "sandbox",
        });
        let entry: PluginEntry = serde_json::from_value(json).unwrap();
        assert_eq!(entry.id, "old-plugin");
        assert!(!entry.trusted);
        assert!(entry.integrity.is_empty());
    }

    #[test]
    fn entry_serializes_trusted_integrity() {
        let mut entry = make_entry("a", "A", "1");
        entry.trusted = true;
        entry.integrity.insert("index.js".into(), "abc123".into());
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"trusted\":true"));
        assert!(json.contains("abc123"));
    }

    // ── PluginEntry signature field serde ──

    #[test]
    fn entry_round_trips_signature_fields() {
        let mut entry = make_entry("signed", "Signed", "1.0.0");
        entry.signature = Some("sig-base64".into());
        entry.publisher_public_key = Some("key-base64".into());
        let json = serde_json::to_string(&entry).unwrap();
        // skip_serializing_if = Option::is_none means these only appear when set.
        assert!(json.contains("\"signature\":\"sig-base64\""));
        assert!(json.contains("\"publisherPublicKey\":\"key-base64\""));
        let back: PluginEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.signature.as_deref(), Some("sig-base64"));
        assert_eq!(back.publisher_public_key.as_deref(), Some("key-base64"));
    }

    #[test]
    fn entry_omits_signature_when_none() {
        let entry = make_entry("unsigned", "Unsigned", "1.0.0");
        let json = serde_json::to_string(&entry).unwrap();
        assert!(!json.contains("signature"));
        assert!(!json.contains("publisherPublicKey"));
    }

    #[test]
    fn entry_deserializes_without_signature_fields_backwards_compat() {
        // Pre-PR4 plugins.json entries lack signature/publisherPublicKey.
        let json = serde_json::json!({
            "id": "old-plugin",
            "name": "Old",
            "version": "0.1.0",
            "tier": "trusted",
            "trusted": true,
        });
        let entry: PluginEntry = serde_json::from_value(json).unwrap();
        assert!(entry.signature.is_none());
        assert!(entry.publisher_public_key.is_none());
    }

    // ── is_valid_plugin_id (manifest path safety) ──

    #[test]
    fn is_valid_plugin_id_accepts_plain_segment() {
        assert!(is_valid_plugin_id("demo-plugin"));
        assert!(is_valid_plugin_id("a"));
        assert!(is_valid_plugin_id("my_plugin_2"));
    }

    #[test]
    fn is_valid_plugin_id_rejects_empty() {
        assert!(!is_valid_plugin_id(""));
    }

    #[test]
    fn is_valid_plugin_id_rejects_dot_traversal() {
        // A single '.' or '..' would resolve to the parent dir.
        assert!(!is_valid_plugin_id("."));
        assert!(!is_valid_plugin_id(".."));
        assert!(!is_valid_plugin_id("a..b"));
    }

    #[test]
    fn is_valid_plugin_id_rejects_separators() {
        assert!(!is_valid_plugin_id("a/b"));
        assert!(!is_valid_plugin_id("a\\b"));
        assert!(!is_valid_plugin_id("/abs"));
    }
}
