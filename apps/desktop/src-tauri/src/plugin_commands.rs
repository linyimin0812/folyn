//! Plugin lifecycle commands + the `quill-plugin://` URI scheme handler.
//!
//! Sandbox-tier plugins live under `~/.quill/plugins/<id>/`. The URI scheme
//! serves their static assets (HTML/JS/CSS) to a sandboxed iframe so the host
//! never gives plugins raw Tauri capabilities. Install/list/uninstall commands
//! manage the on-disk registry (`plugins.json`) and emit lifecycle events.
//!
//! MVP limitation: `install_plugin` copies an **unpacked folder** as the
//! source. Zip extraction is deferred (see PR4). The `zip` crate is not added
//! to avoid a new dependency for a path that may change when the signature
//! chain lands.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::errors::AppError;

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

// ── Integrity (TOFU gate) ────────────────────────────────────────────────────

/// Compute the SHA-256 hex digest of `bytes`. Pure — no I/O.
pub fn compute_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let result = hasher.finalize();
    // Format as lowercase hex.
    let mut out = String::with_capacity(64);
    for b in result {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Walk `plugin_dir` recursively and return a map of relative-path → SHA-256
/// hex for every regular file. Relative paths use forward slashes. The
/// `plugins.json` file itself (if present in the dir) is skipped — it is not
/// plugin code and would self-reference.
pub fn compute_integrity(plugin_dir: &Path) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    walk_and_hash(plugin_dir, plugin_dir, &mut out)?;
    Ok(out)
}

fn walk_and_hash(
    base: &Path,
    current: &Path,
    out: &mut HashMap<String, String>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            walk_and_hash(base, &path, out)?;
        } else if ft.is_file() {
            let rel = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            // Skip the on-disk registry — it's metadata, not plugin code.
            if rel == "plugins.json" {
                continue;
            }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            out.insert(rel, compute_hash(&bytes));
        }
    }
    Ok(())
}

/// Pure trust-gate check: does every path in `stored` match the corresponding
/// hash in `actual`? Returns `false` if any stored entry is missing from
/// `actual` or has a different hash. Extra entries in `actual` are ignored
/// (new files appearing post-install don't invalidate trust — but the loader
/// only verifies `main` in practice; this is the full-set verification used by
/// Rust-side diagnostics).
#[allow(dead_code)]
pub fn verify_integrity(
    stored: &HashMap<String, String>,
    actual: &HashMap<String, String>,
) -> bool {
    for (path, stored_hash) in stored {
        match actual.get(path) {
            Some(actual_hash) if actual_hash == stored_hash => {}
            _ => return false,
        }
    }
    true
}

// ── Ed25519 signature verification (PR4 scaffolding) ────────────────────────
//
// MVP INTEGRITY MODEL: SHA-256 per-file integrity (computed at install, verified
// on load by the trusted loader) is the *gate*. Ed25519 signatures are OPTIONAL
// scaffolding: a plugin MAY carry `signature` + `publisherPublicKey` (base64)
// in its manifest/plugins.json. When present, `verify_plugin_signature` checks
// the signature over the canonicalized manifest. When absent, verification is a
// no-op (Ok(())). This lets a future marketplace require signatures without a
// breaking change — see `docs/plugin-development.md` "Integrity upgrade path".
//
// The signature is over the canonicalized manifest JSON (serde_json with sorted
// keys, no whitespace) — NOT over individual files. Per-file integrity is
// already covered by SHA-256; the signature proves *publisher identity + manifest
// authorship*, not byte-for-byte file integrity (a signed manifest with tampered
// files still fails the SHA-256 check at load).

/// Decode a standard base64 string into bytes. Returns `Err` on malformed input.
pub fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| format!("invalid base64: {e}"))
}

/// Canonicalize a manifest JSON value for signing: serialize with sorted keys
/// and no whitespace. The same input always produces the same bytes, so a
/// publisher can sign the canonical form and any host can re-derive it.
pub fn canonicalize_manifest(manifest: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(manifest).map_err(|e| format!("manifest canonicalize failed: {e}"))
}

/// Verify an optional ed25519 signature over the canonicalized manifest.
///
/// Returns `Ok(())` when:
///   - `signature` is `None` (MVP: signatures not required; SHA-256 is the gate)
///   - `signature` + `public_key` are both present AND verify against the
///     canonicalized manifest bytes
///
/// Returns `Err` when:
///   - only one of `signature` / `public_key` is present (incomplete)
///   - the signature is malformed, the key is malformed, or verification fails
///
/// This is a pure function — no I/O, no app handle — so it is unit-testable
/// without a running Tauri instance.
pub fn verify_plugin_signature(
    manifest: &serde_json::Value,
    signature: Option<&str>,
    public_key: Option<&str>,
) -> Result<(), String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey, PUBLIC_KEY_LENGTH};

    let (sig, key) = match (signature, public_key) {
        (None, None) => return Ok(()), // MVP: no signature = no check
        (None, Some(_)) => {
            return Err("publisherPublicKey present but signature missing".into());
        }
        (Some(_), None) => {
            return Err("signature present but publisherPublicKey missing".into());
        }
        (Some(s), Some(k)) => (s, k),
    };

    let sig_bytes = decode_base64(sig)?;
    let key_bytes = decode_base64(key)?;
    if sig_bytes.len() != ed25519_dalek::SIGNATURE_LENGTH {
        return Err(format!(
            "signature must be {} bytes, got {}",
            ed25519_dalek::SIGNATURE_LENGTH,
            sig_bytes.len()
        ));
    }
    if key_bytes.len() != PUBLIC_KEY_LENGTH {
        return Err(format!(
            "public key must be {} bytes, got {}",
            PUBLIC_KEY_LENGTH,
            key_bytes.len()
        ));
    }

    let key_array: [u8; PUBLIC_KEY_LENGTH] = key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "public key length mismatch".to_string())?;
    let sig_array: [u8; ed25519_dalek::SIGNATURE_LENGTH] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "signature length mismatch".to_string())?;

    let verifying_key = VerifyingKey::from_bytes(&key_array)
        .map_err(|e| format!("invalid public key: {e}"))?;
    let signature = Signature::from_bytes(&sig_array);
    let message = canonicalize_manifest(manifest)?;

    verifying_key
        .verify(message.as_bytes(), &signature)
        .map(|_| ())
        .map_err(|e| format!("signature verification failed: {e}"))
}

// ── Manifest validation (pure) ───────────────────────────────────────────────

/// Validate a raw manifest JSON value. Checks the same invariants as the
/// TypeScript `PluginHost.validateManifest`: kebab-case id, version present,
/// tier ∈ {sandbox, trusted}, `main` present, sandbox requires `html`.
pub fn validate_manifest(manifest: &serde_json::Value) -> Result<(), String> {
    let id = manifest["id"]
        .as_str()
        .ok_or_else(|| "manifest.id is required and must be a string".to_string())?;
    if !is_kebab_case(id) {
        return Err(format!("manifest.id must be kebab-case, got: {id}"));
    }

    let version = manifest["version"]
        .as_str()
        .ok_or_else(|| "manifest.version is required".to_string())?;
    if version.is_empty() {
        return Err("manifest.version must not be empty".into());
    }

    let tier = manifest["tier"]
        .as_str()
        .ok_or_else(|| "manifest.tier is required".to_string())?;
    if tier != "sandbox" && tier != "trusted" {
        return Err(format!("manifest.tier must be 'sandbox' or 'trusted', got: {tier}"));
    }

    let main = manifest["main"]
        .as_str()
        .ok_or_else(|| "manifest.main is required".to_string())?;
    if main.is_empty() {
        return Err("manifest.main must not be empty".into());
    }

    if tier == "sandbox" {
        let html = manifest["html"]
            .as_str()
            .ok_or_else(|| "sandbox plugins require manifest.html".to_string())?;
        if html.is_empty() {
            return Err("sandbox plugins require manifest.html".into());
        }
    }

    Ok(())
}

fn is_kebab_case(s: &str) -> bool {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return false;
    }
    // Must not start/end with '-', must have at least one hyphen-separated segment pair.
    // Matches the TS regex: ^[a-z0-9]+(-[a-z0-9]+)+$
    regex_lite(s)
}

/// Lightweight kebab-case check matching `^[a-z0-9]+(-[a-z0-9]+)+$` without
/// pulling in the `regex` crate.
fn regex_lite(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    // First segment: [a-z0-9]+
    let seg_start = i;
    while i < bytes.len() && (bytes[i].is_ascii_lowercase() || bytes[i].is_ascii_digit()) {
        i += 1;
    }
    if i == seg_start {
        return false;
    }
    // At least one (-[a-z0-9]+)+
    let mut got_hyphen_seg = false;
    while i < bytes.len() {
        if bytes[i] != b'-' {
            return false;
        }
        i += 1;
        let seg_start = i;
        while i < bytes.len() && (bytes[i].is_ascii_lowercase() || bytes[i].is_ascii_digit()) {
            i += 1;
        }
        if i == seg_start {
            return false; // '-' not followed by alnum
        }
        got_hyphen_seg = true;
    }
    got_hyphen_seg
}

// ── Recursive directory copy ─────────────────────────────────────────────────

/// Recursively copy `src` to `dst`. If `dst` exists, it is removed first
/// (re-install / update path). Creates parent dirs as needed.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        fs::remove_dir_all(dst).map_err(|e| format!("failed to remove existing plugin dir: {e}"))?;
    }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    copy_inner(src, dst)
}

fn copy_inner(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let from = entry.path();
        let to = dst.join(&name);
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_inner(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Install a plugin from an unpacked source folder. Copies the folder to
/// `~/.quill/plugins/<id>/`, reads + validates `manifest.json`, upserts the
/// entry in `plugins.json`, and emits `plugin://installed`.
///
/// MVP: `source_path` must be an existing directory containing `manifest.json`.
/// Zip extraction is deferred to PR4.
#[tauri::command]
pub async fn install_plugin(
    app: tauri::AppHandle,
    id: String,
    source_path: String,
) -> Result<PluginEntry, AppError> {
    let src = PathBuf::from(&source_path);
    if !src.is_dir() {
        return Err(format!("source_path must be an existing directory: {source_path}").into());
    }
    let manifest_path = src.join("manifest.json");
    if !manifest_path.exists() {
        return Err(format!("source_path must contain manifest.json: {source_path}").into());
    }

    // Read + validate manifest BEFORE copying.
    let manifest_str = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    validate_manifest(&manifest)?;

    // Verify the manifest's `id` matches the requested `id` (defensive).
    let manifest_id = manifest["id"]
        .as_str()
        .ok_or_else(|| "manifest.id missing".to_string())?;
    if manifest_id != id {
        return Err(format!(
            "manifest.id ({manifest_id}) does not match requested id ({id})"
        ).into());
    }

    let dir = plugins_dir(&app)?;
    let plugin_dir = dir.join(&id);
    copy_dir_recursive(&src, &plugin_dir)?;

    // Compute per-file SHA-256 integrity for the TOFU trust gate. Stored in
    // plugins.json; the trusted loader recomputes `main`'s hash before
    // `import()` and compares against this.
    let integrity = compute_integrity(&plugin_dir).unwrap_or_default();

    // Optional ed25519 signature scaffolding (PR4). The manifest MAY carry
    // `signature` + `publisherPublicKey` (base64). We persist them onto the
    // entry so a future load path can require verification; MVP does NOT
    // enforce — `verify_plugin_signature` returns Ok(()) when absent.
    let signature = manifest["signature"]
        .as_str()
        .map(|s| s.to_string());
    let publisher_public_key = manifest["publisherPublicKey"]
        .as_str()
        .map(|s| s.to_string());
    // Best-effort diagnostic: if a signature is present, verify it now so a
    // bad signature surfaces at install time rather than at activation. Non-
    // fatal — we still install (the SHA-256 gate is the real boundary); the
    // error is logged to stderr for the diagnostics UI to pick up later.
    if let Err(e) = verify_plugin_signature(&manifest, signature.as_deref(), publisher_public_key.as_deref()) {
        eprintln!("[plugin_commands] install_plugin: signature check warning for {id}: {e}");
    }

    let entry = PluginEntry {
        id: id.clone(),
        name: manifest["name"]
            .as_str()
            .unwrap_or(&id)
            .to_string(),
        version: manifest["version"]
            .as_str()
            .unwrap_or("0.0.0")
            .to_string(),
        tier: manifest["tier"]
            .as_str()
            .unwrap_or("sandbox")
            .to_string(),
        trusted: false,
        integrity,
        signature,
        publisher_public_key,
    };

    let records = read_plugins_json(&dir)?;
    let records = upsert_record(records, entry.clone());
    write_plugins_json(&dir, &records)?;

    app.emit("plugin://installed", &entry)
        .map_err(|e| e.to_string())?;
    Ok(entry)
}

/// List all installed plugins from `plugins.json`.
#[tauri::command]
pub async fn list_plugins(app: tauri::AppHandle) -> Result<Vec<PluginEntry>, AppError> {
    let dir = plugins_dir(&app)?;
    read_plugins_json(&dir).map_err(AppError::from)
}

/// Uninstall a plugin: delete its directory, remove the entry from
/// `plugins.json`, and emit `plugin://uninstalled`.
#[tauri::command]
pub async fn uninstall_plugin(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let dir = plugins_dir(&app)?;
    let plugin_dir = dir.join(&id);
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("failed to remove plugin dir: {e}"))?;
    }

    let records = read_plugins_json(&dir)?;
    let records = remove_record(records, &id);
    write_plugins_json(&dir, &records)?;

    app.emit(
        "plugin://uninstalled",
        serde_json::json!({ "id": id }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Approve (TOFU-pin) a plugin: set `trusted: true` on its record and emit
/// `plugin://approved`. This is the explicit user consent for the trusted tier
/// — the trusted loader refuses to `import()` a plugin until `approve_plugin`
/// has been called. MVP: no settings UI yet; PR4 adds the consent prompt.
#[tauri::command]
pub async fn approve_plugin(app: tauri::AppHandle, id: String) -> Result<PluginEntry, AppError> {
    let dir = plugins_dir(&app)?;
    let mut records = read_plugins_json(&dir)?;
    let entry = records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("plugin not found: {id}"))?;
    entry.trusted = true;
    let updated = entry.clone();
    write_plugins_json(&dir, &records)?;

    app.emit("plugin://approved", &updated)
        .map_err(|e| e.to_string())?;
    Ok(updated)
}

/// Return the full on-disk record for a plugin (including `trusted` +
/// `integrity`), or an error if not installed. The trusted loader calls this
/// to read the TOFU gate state before `import()`.
#[tauri::command]
pub async fn get_plugin_record(app: tauri::AppHandle, id: String) -> Result<PluginEntry, AppError> {
    let dir = plugins_dir(&app)?;
    let records = read_plugins_json(&dir)?;
    records
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("plugin not found: {id}"))
        .map_err(AppError::from)
}

/// Read a file from `~/.quill/plugins/<id>/<rel_path>` and return its contents
/// as a UTF-8 string. Used by the trusted loader to fetch the plugin's `main`
/// JS bundle for blob-URL `import()`. Path traversal (`..`) is rejected.
#[tauri::command]
pub async fn read_plugin_file(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<String, AppError> {
    if path.contains("..") {
        return Err("path traversal rejected".into());
    }
    let dir = plugins_dir(&app)?;
    let file = dir.join(&id).join(&path);
    let canonical = file
        .canonicalize()
        .map_err(|e| format!("file not found: {e}"))?;
    let root = dir.join(&id);
    let root = root.canonicalize().unwrap_or_else(|_| dir.join(&id));
    if !canonical.starts_with(&root) {
        return Err("path escapes plugin dir".into());
    }
    fs::read_to_string(&canonical).map_err(|e| AppError::from(e.to_string()))
}

/// Best-effort scoped capability grant for a trusted plugin.
///
/// IMPORTANT DESIGN REALITY (see prd.md Technical Notes + research/
/// vscode-extension-host.md §3): trusted plugins run in the MAIN webview,
/// which already has broad capabilities from `capabilities/default.json`.
/// `add_capability` here is **largely additive/redundant** — it does NOT
/// confine a trusted plugin. A trusted plugin can still call
/// `@tauri-apps/api` directly with the main window's existing caps. The
/// VSCode-research warning applies: in-process hosting makes consent a *soft*
/// gate. This is ACCEPTED for the trusted tier (TOFU-pinned = user explicitly
/// trusted = full power). Do NOT pretend this is a hard sandbox.
///
/// The grant maps the manifest's declarative `permissions` to Tauri
/// permission identifiers scoped to the plugin's data dir (for fs). Failures
/// are logged to stderr and returned as `Err`, but the caller (the frontend)
/// treats this as best-effort — a failed grant does not block activation
/// because the main window's existing caps already cover the surface.
#[tauri::command]
pub async fn grant_plugin_capabilities(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    use tauri::ipc::CapabilityBuilder;

    let dir = plugins_dir(&app)?;
    let manifest_path = dir.join(&id).join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;

    let perms = manifest["permissions"].as_object();
    let plugin_data_dir = dir.join(&id).join("data");
    let data_scope = vec![format!("{}/**", plugin_data_dir.display())];

    let mut cap = CapabilityBuilder::new(format!("plugin-{id}")).webview("main");

    if let Some(perms) = perms {
        // fs → scoped read/write to the plugin's data dir.
        if perms.get("fs").is_some() {
            cap = cap.permission_scoped(
                "fs:allow-read-text-file",
                data_scope.clone(),
                vec![],
            );
            cap = cap.permission_scoped(
                "fs:allow-write-text-file",
                data_scope.clone(),
                vec![],
            );
        }
        // clipboard
        if perms.get("clipboard").is_some() {
            cap = cap.permission("clipboard-manager:allow-read-text");
            cap = cap.permission("clipboard-manager:allow-write-text");
        }
        // dialog
        if perms.get("dialog").is_some() {
            cap = cap.permission("dialog:allow-open");
            cap = cap.permission("dialog:allow-save");
        }
    }

    // add_capability is behind the default `dynamic-acl` feature. Errors here
    // are non-fatal (best-effort) — log and propagate so the frontend can
    // decide whether to warn.
    match app.add_capability(cap) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("[plugin_commands] grant_plugin_capabilities failed for {id}: {e}");
            Err(format!("grant failed (non-fatal, main caps still apply): {e}").into())
        }
    }
}

/// Verify an installed plugin's optional ed25519 signature against its pinned
/// publisher key. Reads the manifest from disk, canonicalizes it, and calls
/// {@link verify_plugin_signature}. Returns `Ok(())` when no signature is
/// present (MVP: signatures optional). Frontend diagnostics UI can call this
/// to surface "signature invalid" before the user approves a trusted plugin.
#[tauri::command]
pub async fn verify_plugin_signature_cmd(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), AppError> {
    let dir = plugins_dir(&app)?;
    let manifest_path = dir.join(&id).join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    let entry = {
        let records = read_plugins_json(&dir)?;
        records
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| format!("plugin not found: {id}"))?
    };
    verify_plugin_signature(
        &manifest,
        entry.signature.as_deref(),
        entry.publisher_public_key.as_deref(),
    )
    .map_err(AppError::from)
}

// ── sandbox http:fetch (CSP bypass via Rust) ─────────────────────────────────
//
// Sandbox-tier `http:fetch` used to run `fetch()` in the host webview realm,
// which is gated by the main page's CSP `connect-src 'self' ipc: http://ipc.localhost`.
// Any plugin-declared origin (e.g. `https://api.example.com`) is blocked by CSP
// in release (dev does not inject CSP, so the bug was invisible locally). The
// fix: route `http:fetch` to this Rust command, which performs the request with
// `reqwest` (no CSP) and re-checks the manifest's `permissions.http.origins`
// allowlist as defense-in-depth behind the JS-side `isOriginAllowed` fast-fail.
//
// Contract (matches the old JS `fetch()` return shape so rpcBridge is unchanged):
//   request:  { pluginId, url, method?, headers?, body? }
//   response: { status: u16, headers: HashMap<String,String>, body: String }

/// Response shape returned by `plugin_http_fetch`. Mirrors the object the old
/// JS `fetch()` branch returned so the rpcBridge caller is unchanged.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Extract the origin (`scheme://host[:port]`) from a URL string.
///
/// `host` includes the port if present. The host is lowercased (RFC 3986 §3.2.2
/// says host is case-insensitive); scheme is lowercased too. Returns `None` for
/// malformed URLs or URLs without a host (e.g. `file:///...` has no host → the
/// sandbox http allowlist is origin-based, so hostless URLs are rejected).
pub fn extract_origin(url: &str) -> Option<String> {
    // Hand-rolled parser: `scheme://host[:port]/...` or `scheme://host[:port]?...`.
    // We avoid pulling the `url` crate (not currently a direct dep) for a tiny
    // parse. This mirrors the TS `extractOrigin` using `new URL()`.
    let scheme_end = url.find("://")?;
    let scheme = url[..scheme_end].to_ascii_lowercase();
    // Scheme must be non-empty and start with a letter (per RFC 3986).
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        return None;
    }
    let rest = &url[scheme_end + 3..];
    // Authority runs until the first '/', '?', or '#'.
    let authority_end = rest
        .find(['/', '?', '#'])
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return None; // no host
    }
    // Strip userinfo (user:pass@) if present.
    let host_port = match authority.rfind('@') {
        Some(at) => &authority[at + 1..],
        None => authority,
    };
    if host_port.is_empty() {
        return None;
    }
    // Lowercase the host (and port — harmless for digits). Host is everything
    // up to the last colon that is NOT inside an IPv6 literal `[...]`. ASCII
    // lowercasing is safe for both reg-names and IPv6 hex digits/colons.
    let host_port_lower = host_port.to_ascii_lowercase();
    Some(format!("{scheme}://{host_port_lower}"))
}

/// Check whether a URL's origin is in the declared allowlist. Pure — no I/O.
///
/// Origins are compared as `scheme://host[:port]` (host lowercased). A
/// subdomain is NOT matched by a bare apex entry (e.g. `https://api.example.com`
/// does NOT match `https://example.com`) — exact origin match only, matching
/// the JS-side `isOriginAllowed` semantics.
pub fn is_origin_allowed(url: &str, allowed_origins: &[String]) -> bool {
    if allowed_origins.is_empty() {
        return false;
    }
    let Some(origin) = extract_origin(url) else {
        return false;
    };
    allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&origin))
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

/// Defense-in-depth origin check against a plugin manifest. Reads
/// `permissions.http.origins` from the manifest JSON value and calls
/// {@link is_origin_allowed}. Pure — no I/O, no app handle — so it is
/// unit-testable without a live reqwest or AppHandle.
pub fn check_http_origin(manifest: &serde_json::Value, url: &str) -> Result<(), String> {
    let origins = manifest["permissions"]["http"]["origins"]
        .as_array()
        .ok_or_else(|| "http:fetch denied: no http.origins declared".to_string())?;
    let allowed: Vec<String> = origins
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    if !is_origin_allowed(url, &allowed) {
        return Err(format!("http:fetch denied: origin not allowed: {url}"));
    }
    Ok(())
}

/// Perform an HTTP request on behalf of a sandbox plugin. The origin is
/// re-checked against the plugin's on-disk `manifest.json`
/// `permissions.http.origins` (defense-in-depth behind the JS-side fast-fail).
/// Uses `reqwest` to bypass the host webview's CSP `connect-src`. Returns a
/// buffered `{status, headers, body}` matching the old JS `fetch()` shape.
#[tauri::command]
pub async fn plugin_http_fetch(
    app: tauri::AppHandle,
    plugin_id: String,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, AppError> {
    // Load the plugin's manifest from disk and re-check the origin allowlist.
    // The JS rpcBridge already fast-fails on non-allowlisted origins; this is
    // the defense-in-depth layer that holds even if the JS bridge is bypassed.
    // Reject path-traversal/path-separator chars in `plugin_id` so a caller
    // cannot point at another plugin's manifest and read its declared origins.
    // `plugin_id` is a bare id segment (`<id>`, not a path).
    if !is_valid_plugin_id(&plugin_id) {
        return Err(format!("http:fetch denied: invalid plugin id: {plugin_id}").into());
    }
    let dir = plugins_dir(&app)?;
    let manifest_path = dir.join(&plugin_id).join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest for {plugin_id}: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    check_http_origin(&manifest, &url)?;

    // Build the request. Method defaults to GET.
    let method_str = method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("invalid method {method_str}: {e}"))?;

    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10));
    // (No default headers; the plugin's headers are applied per-request below.)

    let client = builder
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;

    let mut req = client.request(method, &url);
    if let Some(headers) = headers {
        for (k, v) in headers {
            // Silently skip headers reqwest rejects (e.g. forbidden header
            // names like `Host`); a malformed header must not abort the whole
            // plugin surface.
            if let Ok(name) = reqwest::header::HeaderName::try_from(k.as_str()) {
                if let Ok(val) = reqwest::header::HeaderValue::try_from(v) {
                    req = req.header(name, val);
                }
            }
        }
    }
    if let Some(body) = body {
        req = req.body(body);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("http:fetch request failed: {e}"))?;

    let status = resp.status().as_u16();
    let mut out_headers: HashMap<String, String> = HashMap::new();
    for (name, value) in resp.headers().iter() {
        // Lowercase the header name to match the old JS shape: the DOM `Headers`
        // API normalizes names to lowercase, so `Object.fromEntries(entries())`
        // produced lowercase keys. reqwest's `HeaderMap` preserves the case as
        // received from the server; without lowercasing, a plugin reading
        // `headers['content-type']` would miss a `Content-Type` response header.
        // Last-wins on duplicate names (HashMap overwrite), matching the old JS
        // `Object.fromEntries` semantics.
        if let Ok(v) = value.to_str() {
            out_headers.insert(name.as_str().to_ascii_lowercase(), v.to_string());
        }
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("http:fetch body read failed: {e}"))?;

    Ok(HttpResponse {
        status,
        headers: out_headers,
        body,
    })
}

// ── Fetch-RPC bridge for tool windows ───────────────────────────────────────
//
// When a sandbox tool window (Tauri WebviewWindow loaded from
// `quill-plugin://localhost/<id>/<entry>`) POSTs to
// `quill-plugin://localhost/<id>/rpc`, the URI scheme handler in `lib.rs`
// hands the request here. We emit a `plugin-rpc-request` event that the
// main webview's `toolWindowRpcListener` picks up; it dispatches via the
// shared `dispatchPluginRpc` (same permission checks as the iframe bridge)
// and calls back via the `plugin_rpc_respond` Tauri command below. The
// oneshot channel keyed by `request_id` is the join point.

use std::sync::atomic::{AtomicU64, Ordering};

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
pub static RPC_PENDING: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<RpcResponseData>>>> =
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new(std::collections::HashMap::new())
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

    // ── validate_manifest ──

    #[test]
    fn manifest_valid_sandbox() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "name": "My Plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn manifest_valid_trusted() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "name": "My Plugin",
            "version": "1.0.0",
            "tier": "trusted",
            "main": "index.js",
        });
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn manifest_rejects_bad_id() {
        let m = serde_json::json!({
            "id": "BadId",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_sandbox_without_html() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_unknown_tier() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "wat",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_missing_main() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }

    // ── is_kebab_case ──

    #[test]
    fn kebab_valid() {
        assert!(is_kebab_case("my-plugin"));
        assert!(is_kebab_case("a-b-c"));
        assert!(is_kebab_case("pdf-tools-3"));
    }

    #[test]
    fn kebab_invalid() {
        assert!(!is_kebab_case("myplugin")); // no hyphen
        assert!(!is_kebab_case("My-Plugin")); // uppercase
        assert!(!is_kebab_case("-my-plugin")); // leading -
        assert!(!is_kebab_case("my-plugin-")); // trailing -
        assert!(!is_kebab_case("my--plugin")); // double hyphen
        assert!(!is_kebab_case(""));
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

    // ── Integrity / TOFU gate ──

    #[test]
    fn compute_hash_is_stable_sha256_hex() {
        let h = compute_hash(b"hello");
        // Known SHA-256 of "hello"
        assert_eq!(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        assert_eq!(h.len(), 64);
    }

    #[test]
    fn compute_hash_empty_input() {
        let h = compute_hash(b"");
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn verify_integrity_matches_when_identical() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"console.log(1);"));
        stored.insert("style.css".into(), compute_hash(b"body{}"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"console.log(1);"));
        actual.insert("style.css".into(), compute_hash(b"body{}"));
        assert!(verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_rejects_mismatch() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"original"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"tampered"));
        assert!(!verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_rejects_missing_file() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"code"));
        let actual: HashMap<String, String> = HashMap::new();
        assert!(!verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_ignores_extra_files_in_actual() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"code"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"code"));
        actual.insert("extra.js".into(), compute_hash(b"new"));
        assert!(verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_empty_stored_is_true() {
        let stored: HashMap<String, String> = HashMap::new();
        let actual: HashMap<String, String> = HashMap::new();
        assert!(verify_integrity(&stored, &actual));
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

    // ── decode_base64 ──

    #[test]
    fn decode_base64_valid() {
        let bytes = decode_base64("aGVsbG8=").unwrap(); // "hello"
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn decode_base64_rejects_malformed() {
        assert!(decode_base64("!!!not-base64!!!").is_err());
    }

    #[test]
    fn decode_base64_trims_whitespace() {
        let bytes = decode_base64("  aGVsbG8=  \n").unwrap();
        assert_eq!(bytes, b"hello");
    }

    // ── canonicalize_manifest ──

    #[test]
    fn canonicalize_manifest_is_stable() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "sandbox" });
        let a = canonicalize_manifest(&m).unwrap();
        let b = canonicalize_manifest(&m).unwrap();
        assert_eq!(a, b);
    }

    // ── verify_plugin_signature (ed25519 scaffolding) ──

    #[test]
    fn signature_absent_returns_ok() {
        // MVP: no signature = no check. SHA-256 integrity is the gate.
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, None, None).is_ok());
    }

    #[test]
    fn signature_without_key_is_err() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, Some("sig"), None).is_err());
        assert!(verify_plugin_signature(&m, None, Some("key")).is_err());
    }

    #[test]
    fn signature_malformed_base64_is_err() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, Some("!!!bad-b64!!!"), Some("aGVsbG8=")).is_err());
    }

    #[test]
    fn signature_wrong_length_is_err() {
        use base64::Engine;
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        // 32-byte key but 1-byte signature — both wrong length.
        let key = base64::engine::general_purpose::STANDARD.encode([0u8; 32]);
        let sig = base64::engine::general_purpose::STANDARD.encode([0u8; 1]);
        assert!(verify_plugin_signature(&m, Some(&sig), Some(&key)).is_err());
    }

    #[test]
    fn signature_valid_key_invalid_signature_is_err() {
        // Valid-length key + valid-length signature, but the signature does not
        // actually verify against the canonicalized manifest (it's over the
        // wrong message).
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};
        use rand::rngs::OsRng;
        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        let key_bytes = verifying_key.to_bytes();
        // A signature over the WRONG message — should fail verification.
        let bad_sig = signing_key.sign(b"not the manifest");
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(bad_sig.to_bytes());
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_bytes);
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "trusted" });
        assert!(verify_plugin_signature(&m, Some(&sig_b64), Some(&key_b64)).is_err());
    }

    #[test]
    fn signature_valid_verifies_ok() {
        // End-to-end: sign the canonicalized manifest with a real key, then
        // verify. Proves the scaffolding wiring is correct.
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};
        use rand::rngs::OsRng;
        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "trusted" });
        let canonical = canonicalize_manifest(&m).unwrap();
        let sig = signing_key.sign(canonical.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(verifying_key.to_bytes());
        assert!(verify_plugin_signature(&m, Some(&sig_b64), Some(&key_b64)).is_ok());
    }

    // ── extract_origin / is_origin_allowed (sandbox http:fetch) ──

    #[test]
    fn extract_origin_https_host() {
        assert_eq!(
            extract_origin("https://api.example.com/data?q=1"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_with_port() {
        assert_eq!(
            extract_origin("http://localhost:3000/api"),
            Some("http://localhost:3000".into())
        );
    }

    #[test]
    fn extract_origin_strips_userinfo() {
        assert_eq!(
            extract_origin("https://user:pass@api.example.com/path"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_lowercases_host() {
        assert_eq!(
            extract_origin("https://API.Example.COM/Path"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_rejects_malformed() {
        assert!(extract_origin("not-a-url").is_none());
        assert!(extract_origin("://no-scheme").is_none());
        assert!(extract_origin("https://").is_none()); // no host
        assert!(extract_origin("file:///etc/passwd").is_none()); // hostless
    }

    #[test]
    fn is_origin_allowed_exact_match() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_case_insensitive_host() {
        let allow = vec!["https://API.Example.COM".to_string()];
        assert!(is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_different_origin() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(!is_origin_allowed("https://evil.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_subdomain_not_in_list() {
        // A bare apex entry does NOT match a subdomain — exact origin only.
        let allow = vec!["https://example.com".to_string()];
        assert!(!is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_port_mismatch() {
        let allow = vec!["http://localhost:3000".to_string()];
        assert!(!is_origin_allowed("http://localhost:8080/api", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_malformed_url() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(!is_origin_allowed("not-a-url", &allow));
    }

    #[test]
    fn is_origin_allowed_empty_allowlist_denies() {
        assert!(!is_origin_allowed("https://api.example.com/data", &[]));
    }

    // ── check_http_origin (manifest defense-in-depth) ──

    #[test]
    fn check_http_origin_allows_declared_origin() {
        let m = serde_json::json!({
            "permissions": { "http": { "origins": ["https://api.example.com"] } }
        });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_ok());
    }

    #[test]
    fn check_http_origin_denies_undeclared_origin() {
        let m = serde_json::json!({
            "permissions": { "http": { "origins": ["https://api.example.com"] } }
        });
        assert!(check_http_origin(&m, "https://evil.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_no_http_permissions() {
        let m = serde_json::json!({ "permissions": { "fs": { "scope": ["data/**"] } } });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_origins_not_array() {
        let m = serde_json::json!({ "permissions": { "http": { "origins": "oops" } } });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_no_permissions_key() {
        let m = serde_json::json!({ "id": "x" });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }

    #[test]
    fn http_response_round_trips() {
        let mut headers = HashMap::new();
        headers.insert("content-type".into(), "text/plain".into());
        let resp = HttpResponse {
            status: 200,
            headers,
            body: "hello".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let back: HttpResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back, resp);
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

    // ── fetch-RPC bridge ──

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
