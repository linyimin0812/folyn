//! Core of `extension_http_download`: stream a response to disk, pick a safe
//! local name from untrusted response metadata, and publish the finished file
//! without ever overwriting an existing one. No Tauri dependency; the command
//! in `extension_fetch` adds the permission check and the directory.

use std::{
    collections::HashMap,
    fs, io,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use percent_encoding::percent_decode_str;
use serde::Serialize;

const FALLBACK_NAME: &str = "download";

/// Whole-space archives can take minutes, so only a stalled transfer times out.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Mirrors `ExtensionDownloadResult` in the SDK; `saved` is the discriminant.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum DownloadResult {
    Saved {
        saved: bool,
        status: u16,
        name: String,
        path: String,
        size: u64,
    },
    Rejected {
        saved: bool,
        status: u16,
        headers: HashMap<String, String>,
        body: String,
    },
}

/// Add method, headers and body to a request. Shared with `extension_http_fetch`.
pub fn build_request(
    client: &reqwest::Client,
    url: &str,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<reqwest::RequestBuilder, String> {
    let method_str = method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("invalid method {method_str}: {e}"))?;

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
    Ok(req)
}

pub fn response_headers(resp: &reqwest::Response) -> HashMap<String, String> {
    resp.headers()
        .iter()
        .filter_map(|(name, value)| {
            let value = value.to_str().ok()?;
            Some((name.as_str().to_ascii_lowercase(), value.to_string()))
        })
        .collect()
}

fn is_json(headers: &HashMap<String, String>) -> bool {
    headers
        .get("content-type")
        .is_some_and(|v| v.to_ascii_lowercase().starts_with("application/json"))
}

/// Progress emitted on the download channel: `{ received, total }`, where
/// `total` is only present when the server sent `Content-Length`.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Progress {
    pub received: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    /// Only the final message sets this, so a receiver moves the bar to 100%
    /// with the same content length it already has.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
}

// `Send` on the generic (not `dyn`) keeps the returned future `Send`, which a
// `#[tauri::command]` requires. A trait object would erase that bound.
async fn stream_to_file<F: FnMut(Progress) + Send>(
    resp: &mut reqwest::Response,
    file: &mut fs::File,
    total: Option<u64>,
    on_progress: &mut F,
) -> Result<u64, String> {
    let mut size = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("http:download body read failed: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        size += chunk.len() as u64;
        on_progress(Progress { received: size, total, done: None });
    }
    file.sync_all().map_err(|e| e.to_string())?;
    on_progress(Progress { received: size, total: Some(total.unwrap_or(size)), done: Some(true) });
    Ok(size)
}

/// Download `url` into `dir`. Redirects are not followed: reqwest only strips
/// standard auth headers on a cross-origin hop, so following one would send a
/// custom token header to an origin the manifest never declared. A redirect
/// comes back as a non-2xx `Rejected` result instead.
pub async fn download_to_dir<F: FnMut(Progress) + Send>(
    dir: &Path,
    url: &str,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    mut on_progress: F,
) -> Result<DownloadResult, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;
    let mut resp = build_request(&client, url, method, headers, body)?
        .send()
        .await
        .map_err(|e| format!("http:download request failed: {e}"))?;

    let status = resp.status();
    let out_headers = response_headers(&resp);
    if !status.is_success() || is_json(&out_headers) {
        let body = resp
            .text()
            .await
            .map_err(|e| format!("http:download body read failed: {e}"))?;
        return Ok(DownloadResult::Rejected {
            saved: false,
            status: status.as_u16(),
            headers: out_headers,
            body,
        });
    }

    let name = download_file_name(
        out_headers.get("content-disposition").map(String::as_str),
        resp.url().path(),
    );
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let (temp, mut file) = create_temp_file(dir).map_err(|e| e.to_string())?;
    let size = match stream_to_file(&mut resp, &mut file, total, &mut on_progress).await {
        Ok(size) => size,
        Err(error) => {
            drop(file);
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    };
    drop(file);
    let name = publish_download(&temp, dir, &name).map_err(|e| e.to_string())?;
    Ok(DownloadResult::Saved {
        saved: true,
        status: status.as_u16(),
        path: dir.join(&name).to_string_lossy().into_owned(),
        name,
        size,
    })
}

/// One parameter of a `Content-Disposition` value; `;` inside quotes is data.
fn disposition_param(header: &str, key: &str) -> Option<String> {
    let mut parts = Vec::new();
    let (mut quoted, mut start) = (false, 0);
    for (i, c) in header.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => {
                parts.push(&header[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&header[start..]);
    parts.iter().find_map(|part| {
        let (name, value) = part.split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case(key)
            .then(|| value.trim().trim_matches('"').to_string())
    })
}

/// Reduce an untrusted name to one safe path segment, or `None` if nothing
/// usable remains. Decoding must happen first so `%2e%2e%2f` cannot survive.
pub fn safe_file_name(raw: &str) -> Option<String> {
    let last = raw.rsplit(['/', '\\']).next()?;
    let name: String = last
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let name = name.trim().trim_start_matches('.').trim_end_matches(['.', ' ']);
    (!name.is_empty()).then(|| name.to_string())
}

/// The local name for a response: RFC 5987 `filename*`, then `filename`, then
/// the URL's last segment. Servers also percent-encode plain `filename`.
pub fn download_file_name(disposition: Option<&str>, url_path: &str) -> String {
    let from_header = disposition.and_then(|header| {
        disposition_param(header, "filename*")
            .and_then(|value| value.splitn(3, '\'').nth(2).map(str::to_string))
            .or_else(|| disposition_param(header, "filename"))
    });
    let raw = from_header.unwrap_or_else(|| url_path.rsplit('/').next().unwrap_or("").to_string());
    safe_file_name(&percent_decode_str(&raw).decode_utf8_lossy())
        .unwrap_or_else(|| FALLBACK_NAME.to_string())
}

/// Create the hidden file a download streams into.
pub fn create_temp_file(dir: &Path) -> io::Result<(PathBuf, fs::File)> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_nanos();
    let path = dir.join(format!(".download-{}-{nanos}.part", std::process::id()));
    let file = fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
    Ok((path, file))
}

fn numbered_name(name: &str, n: u32) -> String {
    if n == 0 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem} ({n}).{ext}"),
        _ => format!("{name} ({n})"),
    }
}

/// Move a finished temp file to `name`, adding ` (n)` when taken. `hard_link`
/// fails on an existing target, so concurrent downloads cannot clobber a file.
/// Returns the final name; the temp file is gone either way.
pub fn publish_download(temp: &Path, dir: &Path, name: &str) -> io::Result<String> {
    let result = (0..10_000)
        .find_map(|n| {
            let candidate = numbered_name(name, n);
            match fs::hard_link(temp, dir.join(&candidate)) {
                Ok(()) => Some(Ok(candidate)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => None,
                Err(e) => Some(Err(e)),
            }
        })
        .unwrap_or_else(|| Err(io::Error::new(io::ErrorKind::AlreadyExists, "no free download name")));
    let _ = fs::remove_file(temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_extended_filename() {
        let header = "attachment; filename=\"fallback.zip\"; filename*=UTF-8''%E5%B7%A5%E4%BD%9C%E5%8C%BA.zip";
        assert_eq!(download_file_name(Some(header), "/x"), "工作区.zip");
    }

    #[test]
    fn decodes_plain_percent_encoded_filename() {
        let header = "attachment; filename=%E7%A0%94%E5%8F%91.pdf";
        assert_eq!(download_file_name(Some(header), "/x"), "研发.pdf");
    }

    #[test]
    fn keeps_semicolon_inside_quotes() {
        assert_eq!(download_file_name(Some("attachment; filename=\"a;b.md\""), "/x"), "a;b.md");
    }

    #[test]
    fn keeps_a_literal_percent() {
        assert_eq!(download_file_name(Some("attachment; filename=\"100%.md\""), "/x"), "100%.md");
    }

    #[test]
    fn falls_back_to_url_then_constant() {
        assert_eq!(download_file_name(None, "/files/a%20b.txt"), "a b.txt");
        assert_eq!(download_file_name(None, "/"), "download");
    }

    #[test]
    fn traversal_cannot_leave_the_directory() {
        for header in [
            "attachment; filename=\"../../etc/passwd\"",
            "attachment; filename=\"..\\..\\etc\\passwd\"",
            "attachment; filename=%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "attachment; filename*=UTF-8''..%2F..%2Fetc%2Fpasswd",
        ] {
            assert_eq!(download_file_name(Some(header), "/x"), "passwd", "{header}");
        }
        for header in ["attachment; filename=\"..\"", "attachment; filename=\"../\""] {
            assert_eq!(download_file_name(Some(header), "/x"), "download", "{header}");
        }
    }

    #[test]
    fn safe_file_name_is_stable_for_published_names() {
        for name in ["工作区.zip", "a (1).zip", "a;b.md"] {
            assert_eq!(safe_file_name(name).as_deref(), Some(name));
        }
        for name in ["../a", "a/b", ".hidden", "..", ""] {
            assert_ne!(safe_file_name(name).as_deref(), Some(name));
        }
    }

    #[test]
    fn numbers_a_taken_name_and_keeps_the_original() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.zip"), "old").unwrap();
        let (temp, _file) = create_temp_file(dir.path()).unwrap();
        fs::write(&temp, "new").unwrap();

        assert_eq!(publish_download(&temp, dir.path(), "a.zip").unwrap(), "a (1).zip");
        assert_eq!(fs::read_to_string(dir.path().join("a.zip")).unwrap(), "old");
        assert_eq!(fs::read_to_string(dir.path().join("a (1).zip")).unwrap(), "new");
        assert!(!temp.exists());
    }

    #[test]
    fn numbers_names_without_an_extension() {
        assert_eq!(numbered_name("README", 2), "README (2)");
    }

    /// Serve one raw HTTP response on a local port and return its URL.
    fn serve_once(response: Vec<u8>) -> String {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(&response);
        });
        format!("http://127.0.0.1:{port}/openapi/v1/file/download")
    }

    fn entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(dir)
            .map(|items| items.map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        names.sort();
        names
    }

    #[tokio::test]
    async fn saves_binary_bytes_unchanged() {
        let bytes = [0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xfe];
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*=UTF-8''%E7%A9%BA%E9%97%B4.zip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            bytes.len()
        )
        .into_bytes();
        response.extend_from_slice(&bytes);
        let dir = tempfile::tempdir().unwrap();
        let downloads = dir.path().join("nested/downloads");

        let result = download_to_dir(&downloads, &serve_once(response), Some("POST".into()), None, Some("{}".into()), |_| {})
            .await
            .unwrap();

        let DownloadResult::Saved { name, size, .. } = result else { panic!("not saved: {result:?}") };
        assert_eq!((name.as_str(), size), ("空间.zip", 7));
        assert_eq!(fs::read(downloads.join("空间.zip")).unwrap(), bytes);
        assert_eq!(entries(&downloads), ["空间.zip"]);
    }

    #[tokio::test]
    async fn json_business_error_is_returned_not_saved() {
        let body = r#"{"result":500,"msg":"nope"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json;charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let dir = tempfile::tempdir().unwrap();

        let result = download_to_dir(dir.path(), &serve_once(response.into_bytes()), None, None, None, |_| {})
            .await
            .unwrap();

        let DownloadResult::Rejected { body: text, status, .. } = result else { panic!("saved: {result:?}") };
        assert_eq!((text.as_str(), status), (body, 200));
        assert!(entries(dir.path()).is_empty());
    }

    #[tokio::test]
    async fn redirect_is_not_followed() {
        let response = b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec();
        let dir = tempfile::tempdir().unwrap();

        let result = download_to_dir(dir.path(), &serve_once(response), None, None, None, |_| {}).await.unwrap();

        assert!(matches!(result, DownloadResult::Rejected { status: 302, .. }), "{result:?}");
        assert!(entries(dir.path()).is_empty());
    }

    #[tokio::test]
    async fn truncated_body_leaves_no_file() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 100\r\nConnection: close\r\n\r\nshort".to_vec();
        let dir = tempfile::tempdir().unwrap();

        let result = download_to_dir(dir.path(), &serve_once(response), None, None, None, |_| {}).await;

        assert!(result.is_err(), "{result:?}");
        assert!(entries(dir.path()).is_empty());
    }

    #[tokio::test]
    async fn reports_progress_and_finishes_with_the_content_length() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello".to_vec();
        let dir = tempfile::tempdir().unwrap();
        let mut seen = Vec::new();

        download_to_dir(dir.path(), &serve_once(response), None, None, None, |p| seen.push(p)).await.unwrap();

        assert_eq!(seen.first(), Some(&Progress { received: 5, total: Some(5), done: None }));
        assert_eq!(seen.last(), Some(&Progress { received: 5, total: Some(5), done: Some(true) }));
    }

    /// `#[tauri::command]` rejects a handler whose future is not `Send`. The
    /// progress sink must therefore stay a generic with a `Send` bound rather
    /// than a `&mut dyn FnMut`.
    #[test]
    fn download_future_is_send() {
        fn assert_send<T: Send>(_: T) {}
        assert_send(download_to_dir(Path::new("/tmp"), "http://127.0.0.1/", None, None, None, |_| {}));
    }

    #[test]
    fn progress_omits_an_unknown_total() {
        let json = serde_json::to_value(Progress { received: 3, total: None, done: None }).unwrap();
        assert_eq!(json, serde_json::json!({ "received": 3 }));
    }

    #[test]
    fn saved_result_serializes_to_the_sdk_shape() {
        let saved = DownloadResult::Saved { saved: true, status: 200, name: "a".into(), path: "/d/a".into(), size: 1 };
        assert_eq!(
            serde_json::to_value(saved).unwrap(),
            serde_json::json!({ "saved": true, "status": 200, "name": "a", "path": "/d/a", "size": 1 })
        );
    }
}
