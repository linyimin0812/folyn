//! Network fetch on behalf of plugins + catalog refresh.
//!
//! `plugin_http_fetch` is the sandbox-tier `http:fetch`: routes the request
//! through `reqwest` to bypass the host webview's CSP `connect-src`, and
//! re-checks the plugin manifest's `permissions.http.origins` allowlist as
//! defense-in-depth behind the JS-side `isOriginAllowed` fast-fail.
//!
//! `fetch_url` is the ungated host-allowlisted GET used for catalog refresh
//! (models.dev / openrouter.ai) — the webview cannot `fetch()` these
//! directly due to CORS.

use std::collections::HashMap;
use std::fs;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::errors::AppError;
use crate::plugin_commands::{is_valid_plugin_id, plugins_dir};
use crate::plugin_security::check_http_origin;

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

/// Host allowlist for the ungated `fetch_url` command. The webview cannot
/// `fetch()` these directly (CORS / preflight 404 from openrouter), so we
/// proxy via reqwest. Limited to the catalog refresh use case — adding a
/// host here means any webview code can GET from it.
const FETCH_URL_ALLOWED_HOSTS: &[&str] = &["models.dev", "openrouter.ai"];

/// Shared reqwest implementation used by `plugin_http_fetch` (gated by
/// plugin manifest) and `fetch_url` (gated by host allowlist).
async fn reqwest_fetch(
    url: &str,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let method_str = method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("invalid method {method_str}: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;

    let mut req = client.request(method, url);
    if let Some(headers) = headers {
        for (k, v) in headers {
            // Silently skip headers reqwest rejects (e.g. forbidden header
            // names like `Host`); a malformed header must not abort the whole
            // call.
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

    reqwest_fetch(&url, method, headers, body).await.map_err(AppError::from)
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
