//! Plugin install paths: recursive directory copy + zip extraction → install.
//!
//! `install_plugin` copies an **unpacked folder** as the source (dev/debug path).
//! `install_plugin_zip` extracts a compiled-only `.zip` archive (no `src/`,
//! `*.ts`, `package*.json`, etc.) and is the main distribution path; see
//! "Distributing as a .zip" in `docs/plugin-development.md`.
//!
//! Both emit `plugin://installed` on success and upsert the entry in the
//! on-disk registry (`plugins.json`) maintained by `plugin_commands`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use tauri::Emitter;

use crate::errors::AppError;
use crate::plugin_commands::{
    PluginEntry, plugins_dir, read_plugins_json, upsert_record, write_plugins_json,
};
use crate::plugin_security::{
    compute_integrity, extract_zip_filtered, validate_manifest, verify_plugin_signature,
};

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
        // ponytail: skip node_modules (dev-only; trusted bundles are
        // self-contained per the rendering contract, no bare-specifier
        // imports at runtime) and any symlinks (pnpm's node_modules layout
        // uses them heavily and fs::copy fails on symlink→dir with
        // "neither a regular file nor a symlink to a regular file").
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if name == "node_modules" {
                continue;
            }
            fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_inner(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Zip extraction (compiled-only distribution) ──────────────────────────────

/// Install a plugin from a compiled-only `.zip` archive. Extracts to a
/// staging dir under `~/.mochi/plugins/.staging/`, filters forbidden files
/// (source/lockfiles/configs), validates the manifest, then atomically
/// renames into `~/.mochi/plugins/<id>/` and emits `plugin://installed`.
///
/// Hard-fails on: zip-slip (`..`, absolute, drive-letter), symlink entries,
/// blacklisted files (src/, *.ts, package*.json, etc.), per-file > 50 MB,
/// total > 100 MB, > 1000 entries, manifest mismatch. Soft-skips (does NOT
/// copy) files whose extension is outside the whitelist.
#[tauri::command]
pub async fn install_plugin_zip(
    app: tauri::AppHandle,
    id: String,
    zip_path: String,
) -> Result<PluginEntry, AppError> {
    let zp = PathBuf::from(&zip_path);
    if !zp.is_file() {
        return Err(format!("zip_path must be an existing file: {zip_path}").into());
    }

    let dir = plugins_dir(&app)?;
    let staging_root = dir.join(".staging");
    fs::create_dir_all(&staging_root).map_err(|e| format!("staging root create failed: {e}"))?;

    // Unique staging dir derived from `id` + pid + monotonic nanos. No `uuid`
    // crate dep — keeps Cargo.toml lean; collisions are practically
    // impossible (same-pid re-entry would still differ by nanos).
    let unique = unique_staging_suffix();
    let staging = staging_root.join(format!("{id}-{unique}"));
    fs::create_dir_all(&staging).map_err(|e| format!("staging create failed: {e}"))?;

    // Best-effort cleanup on any error path: drop staging then propagate.
    // Closure captures `staging` by reference and accepts the `AppError`
    // shape all error sites convert to before passing in.
    let cleanup = |e: AppError| -> AppError {
        let _ = fs::remove_dir_all(&staging);
        e
    };

    let (rejected_slip, rejected_blacklist, skipped) =
        match extract_zip_filtered(&zp, &staging) {
            Ok(v) => v,
            Err(e) => return Err(cleanup(e)),
        };
    if !skipped.is_empty() {
        // ponytail: stderr diagnostic, not a fatal error — mirrors the
        // signature-check warning pattern. The diagnostics UI picks up
        // stderr; surfacing this in the install return type would force an
        // API shape change for a non-blocking warning.
        eprintln!(
            "[plugin_commands] install_plugin_zip: skipped {n} file(s) with non-allowlisted extensions: {files}",
            n = skipped.len(),
            files = skipped.join(", ")
        );
    }
    if !rejected_blacklist.is_empty() || !rejected_slip.is_empty() {
        let mut offenders: Vec<String> = Vec::new();
        offenders.extend(rejected_blacklist);
        offenders.extend(rejected_slip);
        offenders.sort();
        offenders.dedup();
        return Err(cleanup(
            format!("plugin contains forbidden files: {}", offenders.join(", ")).into(),
        ));
    }

    // Read + validate manifest from staging.
    let manifest_path = staging.join("manifest.json");
    if !manifest_path.exists() {
        return Err(cleanup("zip is missing manifest.json at the root".into()));
    }
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest.json: {e}"))
        .map_err(|e| cleanup(e.into()))?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("manifest.json parse failed: {e}"))
        .map_err(|e| cleanup(e.into()))?;
    if let Err(e) = validate_manifest(&manifest) {
        return Err(cleanup(format!("manifest validation failed: {e}").into()));
    }
    let manifest_id = manifest["id"]
        .as_str()
        .ok_or_else(|| "manifest.id missing".to_string())
        .map_err(|e| cleanup(e.into()))?
        .to_string();
    if manifest_id != id {
        return Err(cleanup(
            format!("manifest.id ({manifest_id}) does not match requested id ({id})").into(),
        ));
    }

    // Replace any existing plugin dir with the same id (matches the folder
    // install path's `copy_dir_recursive` behavior — re-install = wipe + new).
    let plugin_dir = dir.join(&id);
    if plugin_dir.exists() {
        fs::remove_dir_all(&plugin_dir)
            .map_err(|e| format!("failed to remove existing plugin dir: {e}"))
            .map_err(|e| cleanup(e.into()))?;
    }
    // Rename staging → plugin_dir. Same filesystem (both under ~/.mochi), so
    // this is atomic + instant. Fall back to a recursive copy if rename
    // refuses (cross-filesystem edge case on exotic setups).
    if let Err(e) = fs::rename(&staging, &plugin_dir) {
        eprintln!("[plugin_commands] install_plugin_zip: rename failed ({e}), falling back to copy");
        if let Err(copy_err) = copy_dir_recursive(&staging, &plugin_dir) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("rename+copy fallback failed: rename {e}; copy {copy_err}").into());
        }
        let _ = fs::remove_dir_all(&staging);
    }

    let integrity = compute_integrity(&plugin_dir).unwrap_or_default();

    let signature = manifest["signature"].as_str().map(|s| s.to_string());
    let publisher_public_key = manifest["publisherPublicKey"].as_str().map(|s| s.to_string());
    if let Err(e) = verify_plugin_signature(&manifest, signature.as_deref(), publisher_public_key.as_deref()) {
        eprintln!("[plugin_commands] install_plugin_zip: signature check warning for {id}: {e}");
    }

    let entry = PluginEntry {
        id: id.clone(),
        name: manifest["name"].as_str().unwrap_or(&id).to_string(),
        version: manifest["version"].as_str().unwrap_or("0.0.0").to_string(),
        tier: manifest["tier"].as_str().unwrap_or("sandbox").to_string(),
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

/// Build a unique short suffix for a staging dir name. Combines the pid +
/// monotonic nanos from `SystemTime` so two concurrent installs of the same
/// plugin id can't clobber each other.
fn unique_staging_suffix() -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{pid}-{nanos}")
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Install a plugin from an unpacked source folder. Copies the folder to
/// `~/.mochi/plugins/<id>/`, reads + validates `manifest.json`, upserts the
/// entry in `plugins.json`, and emits `plugin://installed`.
///
/// MVP: `source_path` must be an existing directory containing `manifest.json`.
/// Zip extraction is deferred to PR4.
#[tauri::command]
pub async fn install_plugin(
    app: tauri::AppHandle,
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

    // Use the id declared in the manifest (not the folder name).
    let id = manifest["id"]
        .as_str()
        .ok_or_else(|| "manifest.id missing".to_string())?
        .to_string();

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
