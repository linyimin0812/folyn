//! Plugin CRUD lifecycle commands: list / uninstall / approve (TOFU-pin) /
//! get-record / read-file / grant-capabilities / verify-signature.
//!
//! All commands operate on the on-disk registry in `~/.folyn/plugins/`
//! (`plugins.json` + per-plugin dirs) maintained by `plugin_commands`.
//! `approve_plugin` is the explicit user consent that flips the TOFU trust
//! flag the trusted loader checks before `import()`.

use std::fs;

use tauri::{Emitter, Manager};

use crate::errors::AppError;
use crate::plugin_commands::{
    PluginEntry, plugins_dir, read_plugins_json, remove_record, write_plugins_json,
};
use crate::plugin_security::verify_plugin_signature;

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

/// Read a file from `~/.folyn/plugins/<id>/<rel_path>` and return its contents
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
