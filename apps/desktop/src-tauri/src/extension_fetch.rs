//! Network fetch on behalf of extensions + catalog refresh.
//!
//! `extension_http_fetch` is the sandbox-tier `http:fetch`: routes the request
//! through `reqwest` to bypass the host webview's CSP `connect-src`, and
//! re-checks the extension manifest's `permissions.http.origins` allowlist as
//! defense-in-depth behind the JS-side `isOriginAllowed` fast-fail.
//!
//! `extension_http_download` applies the same check but streams the body to the
//! extension's downloads directory; see `extension_download`.
//!
//! `fetch_url` is the ungated host-allowlisted GET used for catalog refresh
//! (models.dev / openrouter.ai) — the webview cannot `fetch()` these
//! directly due to CORS.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use crate::errors::AppError;
use crate::extension_commands::{is_valid_extension_id, extensions_dir};
use crate::extension_download::{build_request, download_to_dir, response_headers, safe_file_name, DownloadResult, Progress};
use crate::extension_security::check_http_origin;

// ── sandbox http:fetch (CSP bypass via Rust) ─────────────────────────────────
//
// Sandbox-tier `http:fetch` used to run `fetch()` in the host webview realm,
// which is gated by the main page's CSP `connect-src 'self' ipc: http://ipc.localhost`.
// Any extension-declared origin (e.g. `https://api.example.com`) is blocked by CSP
// in release (dev does not inject CSP, so the bug was invisible locally). The
// fix: route `http:fetch` to this Rust command, which performs the request with
// `reqwest` (no CSP) and re-checks the manifest's `permissions.http.origins`
// allowlist as defense-in-depth behind the JS-side `isOriginAllowed` fast-fail.
//
// Contract (matches the old JS `fetch()` return shape so rpcBridge is unchanged):
//   request:  { extensionId, url, method?, headers?, body? }
//   response: { status: u16, headers: HashMap<String,String>, body: String }

/// One saved download, as `extension_downloads_list` reports it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DownloadedFile {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the epoch, so the UI can order by recency.
    #[serde(rename = "modifiedMs")]
    pub modified: u64,
}

/// Response shape returned by `extension_http_fetch`. Mirrors the object the old
/// JS `fetch()` branch returned so the rpcBridge caller is unchanged.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Response shape returned by `extension_http_fetch_bytes`: the body is
/// base64, so binary content (images) survives the JSON IPC hop intact.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HttpBytesResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Host allowlist for the ungated `fetch_url` command. The webview cannot
/// `fetch()` these directly (CORS / preflight 404 from openrouter), so we
/// proxy via reqwest. Limited to the catalog refresh use case — adding a
/// host here means any webview code can GET from it.
///
/// `raw.githubusercontent.com` serves the extension-store catalog JSON from
/// the `folyn-extensions` repo (the catalog lives in its own repo, not the
/// app repo, so the webview cannot reach it via the app's own assets).
const FETCH_URL_ALLOWED_HOSTS: &[&str] = &["models.dev", "openrouter.ai", "raw.githubusercontent.com"];

/// Shared reqwest implementation used by `extension_http_fetch` (gated by
/// extension manifest) and `fetch_url` (gated by host allowlist).
async fn reqwest_fetch(
    url: &str,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;

    let resp = build_request(&client, url, method, headers, body)?
        .send()
        .await
        .map_err(|e| format!("http:fetch request failed: {e}"))?;

    let status = resp.status().as_u16();
    let out_headers = response_headers(&resp);
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

/// Ungated HTTP GET for catalog refresh (models.dev / openrouter.ai). The
/// webview can't fetch these directly due to CORS, so we proxy via reqwest.
/// Host-restricted to `FETCH_URL_ALLOWED_HOSTS` to prevent SSRF — adding a
/// caller-supplied URL with a different host returns an error before any
/// network call.
#[tauri::command]
pub async fn fetch_url(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<HttpResponse, AppError> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "url missing host".to_string())?;
    if !FETCH_URL_ALLOWED_HOSTS.contains(&host) {
        return Err(format!("fetch_url denied: host not allowlisted: {host}").into());
    }
    reqwest_fetch(&url, None, headers, None)
        .await
        .map_err(AppError::from)
}

/// Perform an HTTP request on behalf of a sandbox extension. The origin is
/// re-checked against the extension's on-disk `manifest.json`
/// `permissions.http.origins` (defense-in-depth behind the JS-side fast-fail).
/// Uses `reqwest` to bypass the host webview's CSP `connect-src`. Returns a
/// buffered `{status, headers, body}` matching the old JS `fetch()` shape.
#[tauri::command]
pub async fn extension_http_fetch(
    app: tauri::AppHandle,
    extension_id: String,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, AppError> {
    check_extension_origin(&app, &extension_id, &url)?;
    reqwest_fetch(&url, method, headers, body).await.map_err(AppError::from)
}

/// `extension_http_fetch` for binary responses: same origin check, but the body
/// is returned as base64 instead of being decoded as text. For small files an
/// extension shows inline (an image a document references); large files go
/// through `extension_http_download`, which streams to disk.
#[tauri::command]
pub async fn extension_http_fetch_bytes(
    app: tauri::AppHandle,
    extension_id: String,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpBytesResponse, AppError> {
    check_extension_origin(&app, &extension_id, &url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        // Not followed, as in `extension_http_download`: a custom token header
        // would reach an origin the manifest never declared.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;
    let resp = build_request(&client, &url, method, headers, body)?
        .send()
        .await
        .map_err(|e| format!("http:fetchBytes request failed: {e}"))?;
    let status = resp.status().as_u16();
    let out_headers = response_headers(&resp);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("http:fetchBytes body read failed: {e}"))?;
    Ok(HttpBytesResponse {
        status,
        headers: out_headers,
        body: STANDARD.encode(&bytes),
    })
}

/// Load the extension's manifest from disk and re-check the origin allowlist.
/// The JS side already fast-fails on non-allowlisted origins; this is the
/// defense-in-depth layer that holds even if the JS bridge is bypassed.
fn check_extension_origin(app: &tauri::AppHandle, extension_id: &str, url: &str) -> Result<(), AppError> {
    // Reject path-traversal/path-separator chars in `extension_id` so a caller
    // cannot point at another extension's manifest and read its declared origins.
    // `extension_id` is a bare id segment (`<id>`, not a path).
    validate_extension_id(extension_id, "http:fetch")?;
    let dir = extensions_dir(app)?;
    let manifest_path = dir.join(extension_id).join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest for {extension_id}: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    check_http_origin(&manifest, url)?;
    Ok(())
}

/// `~/.folyn/extension-data/<id>/downloads`. Deliberately outside
/// `~/.folyn/extensions/<id>/`, which reinstalling or updating wipes.
fn extension_downloads_dir(app: &tauri::AppHandle, extension_id: &str) -> Result<PathBuf, AppError> {
    validate_extension_id(extension_id, "http:download")?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".folyn").join("extension-data").join(extension_id).join("downloads"))
}

/// Ids the extension APIs accept: no '.', '/' or '\\', so a resolved path can
/// never leave the directory the id is joined onto.
fn validate_extension_id(extension_id: &str, capability: &str) -> Result<(), AppError> {
    if is_valid_extension_id(extension_id) {
        return Ok(());
    }
    Err(format!("{capability} denied: invalid extension id: {extension_id}").into())
}

/// Stream a remote file into the extension's downloads directory, under the
/// same origin check as `extension_http_fetch`. Progress goes to `on_progress`.
#[tauri::command]
pub async fn extension_http_download(
    app: tauri::AppHandle,
    extension_id: String,
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    on_progress: tauri::ipc::Channel<Progress>,
) -> Result<DownloadResult, AppError> {
    check_extension_origin(&app, &extension_id, &url)?;
    let dir = extension_downloads_dir(&app, &extension_id)?;
    download_to_dir(&dir, &url, method, headers, body, |progress| {
        // A failed send means the page is gone; the download itself continues.
        let _ = on_progress.send(progress);
    })
    .await
    .map_err(AppError::from)
}

/// Reveal a file from the extension's downloads directory in the system file
/// manager. `name` must be a bare file name, so nothing outside it is reachable.
#[tauri::command]
pub async fn extension_reveal_download(
    app: tauri::AppHandle,
    extension_id: String,
    name: String,
) -> Result<(), AppError> {
    let path = downloaded_file(&app, &extension_id, &name)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Absolute path of one downloaded file. The render path needs it: the host
/// reads and renders the file itself.
#[tauri::command]
pub async fn extension_download_path(
    app: tauri::AppHandle,
    extension_id: String,
    name: String,
) -> Result<String, AppError> {
    let path = downloaded_file(&app, &extension_id, &name)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Files in the extension's downloads directory, newest first. The extension
/// lists remote files, so it needs this to know which ones it already saved and
/// to offer opening them instead of downloading again.
#[tauri::command]
pub async fn extension_downloads_list(
    app: tauri::AppHandle,
    extension_id: String,
) -> Result<Vec<DownloadedFile>, AppError> {
    let dir = extension_downloads_dir(&app, &extension_id)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // A fresh extension has not downloaded anything yet.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string().into()),
    };
    let mut files: Vec<DownloadedFile> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            // A `.part` file is a download still in flight, never a saved one.
            if name.starts_with('.') {
                return None;
            }
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(DownloadedFile { name, size: metadata.len(), modified })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

/// Absolute path of one downloaded file. `name` must be a bare file name that
/// `download` could have produced, so nothing outside the directory is reachable.
fn downloaded_file(app: &tauri::AppHandle, extension_id: &str, name: &str) -> Result<PathBuf, AppError> {
    validate_extension_id(extension_id, "http:download")?;
    if safe_file_name(name).as_deref() != Some(name) {
        return Err(format!("http:download denied: invalid file name: {name}").into());
    }
    let path = extension_downloads_dir(app, extension_id)?.join(name);
    if !path.is_file() {
        return Err(format!("http:download: no downloaded file named {name}").into());
    }
    Ok(path)
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
}
