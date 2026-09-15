//! Extension install paths: recursive directory copy + zip extraction → install.
//!
//! `install_extension` copies an **unpacked folder** as the source (dev/debug path).
//! `install_extension_zip` extracts a compiled-only `.zip` archive (no `src/`,
//! `*.ts`, `package*.json`, etc.) and is the main distribution path; see
//! "Distributing as a .zip" in `docs/extension-development.md`.
//!
//! Both emit `extension://installed` on success and upsert the entry in the
//! on-disk registry (`extensions.json`) maintained by `extension_commands`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::Emitter;

use crate::errors::AppError;
use crate::extension_commands::{
    ExtensionEntry, extensions_dir, read_extensions_json, upsert_record, write_extensions_json,
};
use crate::extension_security::{
    compute_integrity, extract_zip_filtered, read_manifest_id_from_zip, validate_manifest,
};

// ── Recursive directory copy ─────────────────────────────────────────────────

/// Recursively copy `src` to `dst`. If `dst` exists, it is removed first
/// (re-install / update path). Creates parent dirs as needed.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if dst.exists() {
        fs::remove_dir_all(dst).map_err(|e| format!("failed to remove existing extension dir: {e}"))?;
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

/// Install a extension from a compiled-only `.zip` archive. Extracts to a
/// staging dir under `~/.folyn/extensions/.staging/`, filters forbidden files
/// (source/lockfiles/configs), validates the manifest, then atomically
/// renames into `~/.folyn/extensions/<id>/` and emits `extension://installed`.
///
/// Hard-fails on: zip-slip (`..`, absolute, drive-letter), symlink entries,
/// blacklisted files (src/, *.ts, package*.json, etc.), per-file > 50 MB,
/// total > 100 MB, > 1000 entries, manifest mismatch. Soft-skips (does NOT
/// copy) files whose extension is outside the whitelist.
#[tauri::command]
pub async fn install_extension_zip(
    app: tauri::AppHandle,
    id: String,
    zip_path: String,
) -> Result<ExtensionEntry, AppError> {
    let zp = PathBuf::from(&zip_path);
    if !zp.is_file() {
        return Err(format!("zip_path must be an existing file: {zip_path}").into());
    }

    let dir = extensions_dir(&app)?;
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
        // Non-fatal stderr diagnostic — the diagnostics UI picks up stderr.
        // Surfacing this in the install return type would force an API shape
        // change for a non-blocking warning (files with non-allowlisted
        // extensions are soft-skipped, not copied).
        eprintln!(
            "[extension_commands] install_extension_zip: skipped {n} file(s) with non-allowlisted extensions: {files}",
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
            format!("extension contains forbidden files: {}", offenders.join(", ")).into(),
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

    // Replace any existing extension dir with the same id (matches the folder
    // install path's `copy_dir_recursive` behavior — re-install = wipe + new).
    let extension_dir = dir.join(&id);
    if extension_dir.exists() {
        fs::remove_dir_all(&extension_dir)
            .map_err(|e| format!("failed to remove existing extension dir: {e}"))
            .map_err(|e| cleanup(e.into()))?;
    }
    // Rename staging → extension_dir. Same filesystem (both under ~/.folyn), so
    // this is atomic + instant. Fall back to a recursive copy if rename
    // refuses (cross-filesystem edge case on exotic setups).
    if let Err(e) = fs::rename(&staging, &extension_dir) {
        eprintln!("[extension_commands] install_extension_zip: rename failed ({e}), falling back to copy");
        if let Err(copy_err) = copy_dir_recursive(&staging, &extension_dir) {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("rename+copy fallback failed: rename {e}; copy {copy_err}").into());
        }
        let _ = fs::remove_dir_all(&staging);
    }

    let integrity = compute_integrity(&extension_dir).unwrap_or_default();

    let entry = ExtensionEntry {
        id: id.clone(),
        name: manifest["name"].as_str().unwrap_or(&id).to_string(),
        version: manifest["version"].as_str().unwrap_or("0.0.0").to_string(),
        tier: manifest["tier"].as_str().unwrap_or("sandbox").to_string(),
        trusted: false,
        integrity,
        enabled: true,
    };

    let records = read_extensions_json(&dir)?;
    let records = upsert_record(records, entry.clone());
    write_extensions_json(&dir, &records)?;

    app.emit("extension://installed", &entry)
        .map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Build a unique short suffix for a staging dir name. Combines the pid +
/// monotonic nanos from `SystemTime` so two concurrent installs of the same
/// extension id can't clobber each other.
fn unique_staging_suffix() -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{pid}-{nanos}")
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Install a extension from an unpacked source folder. Copies the folder to
/// `~/.folyn/extensions/<id>/`, reads + validates `manifest.json`, upserts the
/// entry in `extensions.json`, and emits `extension://installed`.
///
/// MVP: `source_path` must be an existing directory containing `manifest.json`.
/// Zip extraction is deferred to PR4.
#[tauri::command]
pub async fn install_extension(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<ExtensionEntry, AppError> {
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

    let dir = extensions_dir(&app)?;
    let extension_dir = dir.join(&id);
    copy_dir_recursive(&src, &extension_dir)?;

    // Compute per-file SHA-256 integrity for the TOFU trust gate. Stored in
    // extensions.json; the trusted loader recomputes `main`'s hash before
    // `import()` and compares against this.
    let integrity = compute_integrity(&extension_dir).unwrap_or_default();

    let entry = ExtensionEntry {
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
        enabled: true,
    };

    let records = read_extensions_json(&dir)?;
    let records = upsert_record(records, entry.clone());
    write_extensions_json(&dir, &records)?;

    app.emit("extension://installed", &entry)
        .map_err(|e| e.to_string())?;
    Ok(entry)
}

/// Install a extension from a GitHub Releases download URL. The extension store
/// (Settings → Extensions → Store) calls this with a catalog entry's
/// `downloadUrl` (a `github.com/.../releases/download/<tag>/<id>-<ver>.zip`).
///
/// Downloads the zip bytes with `reqwest` (the webview can't fetch a binary
/// blob — `fetch_url` returns `text()`), writes them to a staging file, then
/// delegates to {@link install_extension_zip} so the unzip / filter / manifest
/// validate / integrity / registry / event-emit path is reused verbatim.
///
/// SSRF guard: only `github.com` is permitted (Release assets redirect to
/// `objects.githubusercontent.com`, which reqwest follows via the limited
/// redirect policy — the host check is on the *initial* URL only). The temp
/// zip is removed on both success and error paths.
#[tauri::command]
pub async fn install_extension_from_url(
    app: tauri::AppHandle,
    id: String,
    url: String,
) -> Result<ExtensionEntry, AppError> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("invalid download url: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "download url missing host".to_string())?;
    if host != "github.com" {
        return Err(format!("install_extension_from_url denied: host not github.com: {host}").into());
    }

    let dir = extensions_dir(&app)?;
    let staging_root = dir.join(".staging");
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("staging root create failed: {e}"))?;
    // When the caller has only a URL (the "install from URL" path), `id` is
    // empty and we resolve it from the zip's manifest after download. Use a
    // placeholder for the staging filename in that case.
    let id_or_placeholder = if id.is_empty() { "from-url" } else { &id };
    let temp_zip = staging_root.join(format!("{id_or_placeholder}-dl-{}.zip", unique_staging_suffix()));

    // Closure that always removes the temp zip before mapping the error.
    let cleanup = |e: AppError| -> AppError {
        let _ = fs::remove_file(&temp_zip);
        e
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))
        .map_err(|e| cleanup(e.into()))?;
    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))
        .map_err(|e| cleanup(e.into()))?
        .error_for_status()
        .map_err(|e| format!("download bad status: {e}"))
        .map_err(|e| cleanup(e.into()))?
        .bytes()
        .await
        .map_err(|e| format!("download body read failed: {e}"))
        .map_err(|e| cleanup(e.into()))?;

    let mut f = fs::File::create(&temp_zip)
        .map_err(|e| format!("temp zip create failed: {e}"))
        .map_err(|e| cleanup(e.into()))?;
    f.write_all(&bytes)
        .map_err(|e| format!("temp zip write failed: {e}"))
        .map_err(|e| cleanup(e.into()))?;
    drop(f);

    // "Install from URL" path: caller passed an empty id, so the id must be
    // read from the downloaded zip's manifest (the manifest's id is the
    // truth — guessing from the filename is unreliable). `install_extension_zip`
    // then validates this id against the manifest it re-reads during extraction.
    let id = if id.is_empty() {
        read_manifest_id_from_zip(&temp_zip).map_err(|e| cleanup(e.into()))?
    } else {
        id
    };

    let entry = install_extension_zip(app, id, temp_zip.to_string_lossy().into_owned())
        .await
        .map_err(cleanup)?;
    let _ = fs::remove_file(&temp_zip);
    Ok(entry)
}
