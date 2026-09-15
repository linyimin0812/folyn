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
#[tauri::command]
pub async fn approve_extension(app: tauri::AppHandle, id: String) -> Result<ExtensionEntry, AppError> {
    let dir = extensions_dir(&app)?;
    let mut records = read_extensions_json(&dir)?;
    let entry = records
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("extension not found: {id}"))?;
    entry.trusted = true;
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

