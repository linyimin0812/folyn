//! Extension CRUD lifecycle commands: list / uninstall / approve (TOFU-pin) /
//! get-record / read-file / grant-capabilities.
//!
//! All commands operate on the on-disk registry in `~/.folyn/extensions/`
//! (`extensions.json` + per-extension dirs) maintained by `extension_commands`.
//! `approve_extension` is the explicit user consent that flips the TOFU trust
//! flag the trusted loader checks before `import()`.

use std::fs;

use tauri::Emitter;

use crate::errors::AppError;
use crate::extension_commands::{
    ExtensionEntry, extensions_dir, read_extensions_json, remove_record, write_extensions_json,
};
use crate::extension_security::compute_hash;

/// List all installed extensions from `extensions.json`.
#[tauri::command]
pub async fn list_extensions(app: tauri::AppHandle) -> Result<Vec<ExtensionEntry>, AppError> {
    let dir = extensions_dir(&app)?;
    read_extensions_json(&dir).map_err(AppError::from)
}

/// Uninstall a extension: delete its directory, remove the entry from
/// `extensions.json`, and emit `extension://uninstalled`.
#[tauri::command]
pub async fn uninstall_extension(app: tauri::AppHandle, id: String) -> Result<(), AppError> {
    let dir = extensions_dir(&app)?;
    let extension_dir = dir.join(&id);
    if extension_dir.exists() {
        fs::remove_dir_all(&extension_dir)
            .map_err(|e| format!("failed to remove extension dir: {e}"))?;
    }

    let records = read_extensions_json(&dir)?;
    let records = remove_record(records, &id);
    write_extensions_json(&dir, &records)?;

    app.emit(
        "extension://uninstalled",
        serde_json::json!({ "id": id }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Approve (TOFU-pin) a extension: set `trusted: true` on its record and emit
/// `extension://approved`. This is the explicit user consent for the trusted tier
/// — the trusted loader refuses to `import()` a extension until `approve_extension`
/// has been called. MVP: no settings UI yet; PR4 adds the consent prompt.
///
/// Collector hostAllowlist consent (design §2.1/§7.3): approving an extension
/// whose `contributes.collectors[].hostAllowlist` is non-empty also merges those
/// hosts into the manifest's `permissions.http.origins`, so `extension_http_fetch`'s
/// manifest-origin re-check passes for the hosts the user just saw listed in the
/// consent dialog. Pure JSON→JSON — unit-tested below.
fn merge_collector_host_allowlist(manifest: &mut serde_json::Value) -> Vec<String> {
    let hosts: Vec<String> = manifest["contributes"]["collectors"]
        .as_array()
        .map(|cs| {
            cs.iter()
                .filter_map(|c| c["hostAllowlist"].as_array())
                .flatten()
                .filter_map(|v| v.as_str())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    if hosts.is_empty() {
        return vec![];
    }
    // check_http_origin compares scheme://host[:port] — bare domains get the
    // https:// prefix; entries already carrying a scheme pass through as-is.
    let targets: Vec<String> = hosts
        .into_iter()
        .map(|h| if h.contains("://") { h } else { format!("https://{h}") })
        .collect();

    // IndexMut below auto-vivifies Null→object but PANICS on a type mismatch
    // (e.g. a hand-tampered manifest with `"permissions": "x"`), so guard the
    // node types first — a malformed manifest just skips the grant.
    let node_ok = |v: Option<&serde_json::Value>, want_array: bool| {
        v.map(|v| v.is_null() || v.is_object() || (want_array && v.is_array()))
            .unwrap_or(true)
    };
    let perms = manifest.get("permissions");
    let http = perms.and_then(|p| p.get("http"));
    let origins_node = http.and_then(|h| h.get("origins"));
    if !(node_ok(perms, false) && node_ok(http, false) && node_ok(origins_node, true)) {
        return vec![];
    }

    let mut origins: Vec<String> = origins_node
        .and_then(|o| o.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let mut added = vec![];
    for t in targets {
        if !origins.iter().any(|e| e.eq_ignore_ascii_case(&t)) {
            origins.push(t.clone());
            added.push(t);
        }
    }
    if !added.is_empty() {
        manifest["permissions"]["http"]["origins"] = serde_json::json!(origins);
    }
    added
}

#[tauri::command]
pub async fn approve_extension(app: tauri::AppHandle, id: String) -> Result<ExtensionEntry, AppError> {
    let dir = extensions_dir(&app)?;
    let mut records = read_extensions_json(&dir)?;
    let entry = records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("extension not found: {id}"))?;
    entry.trusted = true;

    // hostAllowlist consent merge — see fn doc. Best-effort by design: a read/
    // parse failure of the manifest must not block the approve itself (the
    // user just consented to the tier warning, which supersedes it), it only
    // skips the origin grant.
    let manifest_path = dir.join(&id).join("manifest.json");
    if let Ok(text) = fs::read_to_string(&manifest_path) {
        if let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&text) {
            let added = merge_collector_host_allowlist(&mut manifest);
            if !added.is_empty() {
                if let Ok(new_text) = serde_json::to_string_pretty(&manifest) {
                    if fs::write(&manifest_path, &new_text).is_ok() {
                        // Keep the TOFU integrity map honest for the file we
                        // just rewrote (the loader only verifies `main`, but a
                        // stale hash here would fail any future full audit).
                        entry
                            .integrity
                            .insert("manifest.json".into(), compute_hash(new_text.as_bytes()));
                        log::info!(
                            "[extension] approved {id}: granted collector hostAllowlist origins: {:?}",
                            added
                        );
                    }
                }
            }
        }
    }

    let updated = entry.clone();
    write_extensions_json(&dir, &records)?;

    app.emit("extension://approved", &updated)
        .map_err(|e| e.to_string())?;
    Ok(updated)
}

/// Return the full on-disk record for a extension (including `trusted` +
/// `integrity`), or an error if not installed. The trusted loader calls this
/// to read the TOFU gate state before `import()`.
#[tauri::command]
pub async fn get_extension_record(app: tauri::AppHandle, id: String) -> Result<ExtensionEntry, AppError> {
    let dir = extensions_dir(&app)?;
    let records = read_extensions_json(&dir)?;
    records
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("extension not found: {id}"))
        .map_err(AppError::from)
}

/// Read a file from `~/.folyn/extensions/<id>/<rel_path>` and return its contents
/// as a UTF-8 string. Used by the trusted loader to fetch the extension's `main`
/// JS bundle for blob-URL `import()`. Path traversal (`..`) is rejected.
#[tauri::command]
pub async fn read_extension_file(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<String, AppError> {
    if path.contains("..") {
        return Err("path traversal rejected".into());
    }
    let dir = extensions_dir(&app)?;
    let file = dir.join(&id).join(&path);
    let canonical = file
        .canonicalize()
        .map_err(|e| format!("file not found: {e}"))?;
    let root = dir.join(&id);
    let root = root.canonicalize().unwrap_or_else(|_| dir.join(&id));
    if !canonical.starts_with(&root) {
        return Err("path escapes extension dir".into());
    }
    fs::read_to_string(&canonical).map_err(|e| AppError::from(e.to_string()))
}

/// Flip the persisted `enabled` flag on a extension record and emit
/// `extension://state-changed` so every open Settings tab refreshes. The
/// in-memory `ExtensionHost` activate/deactivate is driven by the frontend
/// store; this command only owns the on-disk flag that survives restarts.
#[tauri::command]
pub async fn set_extension_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<ExtensionEntry, AppError> {
    let dir = extensions_dir(&app)?;
    let mut records = read_extensions_json(&dir)?;
    let entry = records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("extension not found: {id}"))?;
    entry.enabled = enabled;
    let updated = entry.clone();
    write_extensions_json(&dir, &records)?;

    app.emit("extension://state-changed", &updated)
        .map_err(|e| e.to_string())?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_prefixes_bare_domains_and_creates_missing_permissions() {
        let mut m = serde_json::json!({
            "contributes": { "collectors": [ { "hostAllowlist": ["api.github.com"] } ] }
        });
        let added = merge_collector_host_allowlist(&mut m);
        assert_eq!(added, vec!["https://api.github.com".to_string()]);
        assert_eq!(
            m["permissions"]["http"]["origins"],
            serde_json::json!(["https://api.github.com"])
        );
    }

    #[test]
    fn merge_is_idempotent_and_keeps_existing_origins() {
        let mut m = serde_json::json!({
            "permissions": { "http": { "origins": ["https://api.example.com"] } },
            "contributes": { "collectors": [
                { "hostAllowlist": ["api.example.com", "http://localhost:9200"] }
            ] }
        });
        let added = merge_collector_host_allowlist(&mut m);
        assert_eq!(added, vec!["http://localhost:9200".to_string()]);
        assert_eq!(
            m["permissions"]["http"]["origins"],
            serde_json::json!(["https://api.example.com", "http://localhost:9200"])
        );
        // Second run adds nothing.
        assert!(merge_collector_host_allowlist(&mut m).is_empty());
    }

    #[test]
    fn merge_is_a_noop_without_collector_hosts() {
        let mut m = serde_json::json!({ "contributes": { "collectors": [ { "hostAllowlist": [] } ] } });
        assert!(merge_collector_host_allowlist(&mut m).is_empty());
        assert!(m.get("permissions").is_none());
    }

    #[test]
    fn merge_skips_malformed_permissions_nodes_instead_of_panicking() {
        let mut m = serde_json::json!({
            "permissions": "not-an-object",
            "contributes": { "collectors": [ { "hostAllowlist": ["api.github.com"] } ] }
        });
        assert!(merge_collector_host_allowlist(&mut m).is_empty());
        assert_eq!(m["permissions"], serde_json::json!("not-an-object"));
    }
}

