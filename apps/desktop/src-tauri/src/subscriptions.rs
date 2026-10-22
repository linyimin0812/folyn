//! Trusted subscriptions: bounded public downloads and pinned vault IO.
use crate::extension_commands::{extensions_dir, is_valid_extension_id, read_extensions_json};
use crate::extension_security::compute_hash;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tauri::Manager;

pub(crate) fn authorize(app: &tauri::AppHandle, id: &str, capability: &str) -> Result<(), String> {
    if !is_valid_extension_id(id) {
        return Err("invalid extension id".into());
    }
    let dir = extensions_dir(app)?;
    let records = read_extensions_json(&dir)?;
    let record = records
        .iter()
        .find(|r| r.id == id && r.tier == "trusted" && r.trusted && r.enabled)
        .ok_or("subscriptions requires an approved, enabled trusted extension")?;
    let manifest_bytes = fs::read(dir.join(id).join("manifest.json")).map_err(|e| e.to_string())?;
    if record.integrity.get("manifest.json") != Some(&compute_hash(&manifest_bytes)) {
        return Err(
            "subscription manifest integrity changed; reinstall and approve the extension".into(),
        );
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes).map_err(|e| e.to_string())?;
    if manifest["tier"] != "trusted" || manifest["permissions"]["subscriptions"][capability] != true
    {
        return Err(format!(
            "permissions.subscriptions.{capability} is required"
        ));
    }
    Ok(())
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                // 198.18.0.0/15 is allowed: fake-ip DNS proxies (Clash/Surge) resolve
                // proxied domains there and the OS TUN routes them; real internal
                // networks never use the RFC 2544 benchmark range.
                || (a == 198 && b == 51)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v) => v
            .to_ipv4_mapped()
            .map(|v| public_ip(IpAddr::V4(v)))
            .unwrap_or_else(|| {
                let s = v.segments();
                // Only global unicast, excluding documentation/transition ranges.
                (s[0] & 0xe000) == 0x2000
                    && s[0] != 0x2002
                    && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
            }),
    }
}
pub(crate) fn validate_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err("only public HTTP(S) URLs without credentials are allowed".into());
    }
    Ok(url)
}
#[derive(Serialize)]
pub struct SubscriptionResponse {
    pub(crate) status: u16,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) body: String,
    pub(crate) url: String,
}
/// Resolve on a blocking worker; direct HTTP pins these exact public IPs.
/// Browser fallback can validate navigation DNS but its engine owns connection DNS.
pub(crate) async fn public_addresses(url: &reqwest::Url) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or("URL has no host")?
        .trim_matches(['[', ']'])
        .to_owned();
    let port = url.port_or_known_default().ok_or("URL has no port")?;
    let addresses = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|v| v.collect::<Vec<_>>())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("private/local network destinations are blocked".into());
    }
    Ok(addresses)
}
fn limited_decode(reader: impl std::io::Read, limit: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| format!("response decompression failed: {e}"))?;
    if out.len() > limit {
        return Err("decoded response exceeds size limit".into());
    }
    Ok(out)
}
fn decode_content(mut bytes: Vec<u8>, encoding: &str, limit: usize) -> Result<Vec<u8>, String> {
    for encoding in encoding
        .split(',')
        .rev()
        .map(|v| v.trim().to_ascii_lowercase())
    {
        bytes = match encoding.as_str() {
            "" | "identity" => bytes,
            "gzip" | "x-gzip" => {
                limited_decode(flate2::read::GzDecoder::new(bytes.as_slice()), limit)?
            }
            "br" => limited_decode(brotli::Decompressor::new(bytes.as_slice(), 4096), limit)?,
            "deflate" => limited_decode(flate2::read::ZlibDecoder::new(bytes.as_slice()), limit)
                .or_else(|_| {
                    limited_decode(flate2::read::DeflateDecoder::new(bytes.as_slice()), limit)
                })?,
            other => return Err(format!("unsupported response content encoding: {other}")),
        };
    }
    Ok(bytes)
}
fn charset_after(text: &str, key: &str) -> Option<&'static encoding_rs::Encoding> {
    let lower = text.to_ascii_lowercase();
    let start = lower.find(key)? + key.len();
    let label = lower[start..]
        .trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '=' || c == '\'' || c == '"')
        .split(|c: char| c.is_ascii_whitespace() || matches!(c, '\'' | '"' | '>' | '/' | ';' | '?'))
        .next()?;
    encoding_rs::Encoding::for_label(label.as_bytes())
}
fn decode_text(bytes: &[u8], content_type: &str) -> String {
    if let Some((encoding, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        return encoding.decode(&bytes[bom..]).0.into_owned();
    }
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(8192)]);
    let encoding = charset_after(content_type, "charset")
        .or_else(|| {
            let lower = prefix.to_ascii_lowercase();
            let start = lower.find("<?xml")?;
            let end = lower[start..].find("?>")? + start;
            charset_after(&prefix[start..end], "encoding")
        })
        .or_else(|| {
            let lower = prefix.to_ascii_lowercase();
            let mut offset = 0;
            while let Some(index) = lower[offset..].find("<meta") {
                let start = offset + index;
                let end = lower[start..].find('>')? + start;
                if let Some(enc) = charset_after(&prefix[start..end], "charset") {
                    return Some(enc);
                }
                offset = end + 1;
            }
            None
        })
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

fn request_error(error: reqwest::Error) -> String {
    use std::error::Error;
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(error) = source {
        message.push_str(": ");
        message.push_str(&error.to_string());
        source = error.source();
    }
    message
}
async fn download(raw: String, binary: bool) -> Result<SubscriptionResponse, String> {
    let mut url = validate_url(&raw)?;
    for _ in 0..=8 {
        let host = url
            .host_str()
            .ok_or("URL has no host")?
            .trim_matches(['[', ']'])
            .to_owned();
        let addresses = public_addresses(&url).await?;
        // Resolve once and pin addresses; no proxy or DNS-rebinding bypass.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(request_error)?;
        let mut response = client
            .get(url.clone())
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")
            .header("Accept", "text/html,application/xhtml+xml,application/xml,application/feed+json,application/json;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header("Accept-Encoding", "gzip, deflate, br")
            .send()
            .await
            .map_err(request_error)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .ok_or("redirect missing location")?
                .to_str()
                .map_err(|e| e.to_string())?;
            url = validate_url(url.join(location).map_err(|e| e.to_string())?.as_str())?;
            continue;
        }
        let limit = if binary {
            20 * 1024 * 1024
        } else {
            8 * 1024 * 1024
        };
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err("download exceeds size limit".into());
        }
        let status = response.status().as_u16();
        let mut headers: HashMap<String, String> = response
            .headers()
            .iter()
            .filter_map(|(k, v)| {
                v.to_str()
                    .ok()
                    .map(|v| (k.as_str().to_owned(), v.to_owned()))
            })
            .collect();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(request_error)? {
            if bytes.len() + chunk.len() > limit {
                return Err("download exceeds size limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let content_encoding = headers.get("content-encoding").cloned().unwrap_or_else(|| {
            // Sitemaps are often .xml.gz files without a Content-Encoding header.
            if !binary && bytes.starts_with(&[0x1f, 0x8b]) {
                "gzip".into()
            } else {
                String::new()
            }
        });
        let content_type = headers.get("content-type").cloned().unwrap_or_default();
        let body = tauri::async_runtime::spawn_blocking(move || {
            let bytes = decode_content(bytes, &content_encoding, limit)?;
            Ok::<String, String>(if binary {
                STANDARD.encode(bytes)
            } else {
                decode_text(&bytes, &content_type)
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        headers.remove("content-encoding");
        headers.remove("content-length");
        return Ok(SubscriptionResponse {
            status,
            headers,
            body,
            url: url.to_string(),
        });
    }
    Err("too many redirects".into())
}
#[tauri::command]
pub async fn subscription_fetch(
    app: tauri::AppHandle,
    extension_id: String,
    url: String,
    binary: bool,
    request_id: Option<String>,
) -> Result<SubscriptionResponse, String> {
    let gate_app = app.clone();
    let gate_id = extension_id.clone();
    tauri::async_runtime::spawn_blocking(move || authorize(&gate_app, &gate_id, "network"))
        .await
        .map_err(|e| e.to_string())??;
    let direct = tokio::time::timeout(Duration::from_secs(30), download(url.clone(), binary))
        .await
        .map_err(|_| "download timed out".to_string())
        .and_then(|result| result);
    let direct_error = match direct {
        Ok(response) if !binary || !matches!(response.status, 403 | 429) => return Ok(response),
        Ok(response) => format!("image HTTP {}", response.status),
        Err(error) if !binary => return Err(error),
        Err(error) => error,
    };
    // The optional ID is provided/tracked only for activations with render grant.
    // Native render_image independently rechecks both grants and all navigation.
    let Some(request_id) = request_id else {
        return Err(direct_error);
    };
    crate::subscription_render::render_image(app, extension_id, request_id, url)
        .await
        .map_err(|error| format!("{direct_error}; browser image fallback: {error}"))
}

fn scoped_path(root: &str, relative: &str, create_parent: bool) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || rel.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("vault path must be relative without traversal".into());
    }
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let target = root.join(rel);
    // Validate each existing component before creating directories, rejecting symlink escapes.
    let mut cursor = root.clone();
    let parts: Vec<_> = rel.components().collect();
    for (i, part) in parts.iter().enumerate() {
        cursor.push(part.as_os_str());
        match fs::symlink_metadata(&cursor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err("symlinks are not allowed in subscription vault paths".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if create_parent && i + 1 < parts.len() {
                    match fs::create_dir(&cursor) {
                        Ok(()) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                            // Another save may have created this parent after our
                            // lookup. Accept only a real directory, never a link.
                            let metadata =
                                fs::symlink_metadata(&cursor).map_err(|e| e.to_string())?;
                            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                                return Err(
                                    "subscription parent path must be a directory without symlinks"
                                        .into(),
                                );
                            }
                        }
                        Err(e) => return Err(e.to_string()),
                    }
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(target)
}
fn atomic_write(path: &Path, bytes: &[u8], exclusive: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("missing parent directory")?;
    let mut file = None;
    let mut temp = PathBuf::new();
    for n in 0..100 {
        temp = parent.join(format!(
            ".folyn-subscription-{}-{}-{n}.tmp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos()
        ));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
        {
            Ok(f) => {
                file = Some(f);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    let result = (|| {
        let mut file = file.ok_or("failed to create temporary file")?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if exclusive {
            fs::hard_link(&temp, path).map_err(|e| e.to_string())?;
        } else {
            fs::rename(&temp, path).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_file(&temp);
    result
}
// The caller first validates the full path with scoped_path. Recheck the final
// entry without following links, including entries replaced since validation.
fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        return Err("symlinks are not allowed in subscription vault paths".into());
    }
    // remove_dir_all unlinks symlinks inside the tree without following them.
    let result = if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
fn safe_vault_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn ensure_real_directory(path: &Path) -> Result<(), String> {
    match fs::create_dir(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("subscription data directory must not contain symlinks".into());
    }
    Ok(())
}
fn app_data_root(home: &Path, vault_id: &str) -> Result<PathBuf, String> {
    if !safe_vault_id(vault_id) {
        return Err("invalid vault id for subscription data".into());
    }
    let home = fs::canonicalize(home).map_err(|e| e.to_string())?;
    let mut root = home.clone();
    for part in [".folyn", "subscriptions", vault_id] {
        root.push(part);
        ensure_real_directory(&root)?;
        let canonical = fs::canonicalize(&root).map_err(|e| e.to_string())?;
        if !canonical.starts_with(&home) {
            return Err("subscription data escaped the Folyn data directory".into());
        }
        root = canonical;
    }
    Ok(root)
}
fn subscription_io(
    root: &str,
    path: &str,
    operation: &str,
    content: Option<String>,
) -> Result<serde_json::Value, String> {
    let writing = matches!(operation, "writeText" | "writeBinary" | "createText");
    let path = scoped_path(root, path, writing)?;
    match operation {
        "readText" => fs::read_to_string(path)
            .map(serde_json::Value::String)
            .map_err(|e| e.to_string()),
        "readBinary" => fs::read(path)
            .map(|v| serde_json::Value::String(STANDARD.encode(v)))
            .map_err(|e| e.to_string()),
        "exists" => Ok(serde_json::Value::Bool(path.exists())),
        "assetPath" => {
            if !path.is_file() {
                return Err("subscription asset is not a file".into());
            }
            Ok(serde_json::Value::String(
                path.to_string_lossy().into_owned(),
            ))
        }
        "remove" => remove_path(&path).map(|_| serde_json::Value::Null),
        "writeText" | "createText" | "writeBinary" => {
            let content = content.ok_or("missing content")?;
            let bytes = if operation == "writeBinary" {
                STANDARD.decode(content).map_err(|e| e.to_string())?
            } else {
                content.into_bytes()
            };
            atomic_write(&path, &bytes, operation == "createText")?;
            Ok(serde_json::Value::Null)
        }
        _ => Err("unknown subscription data operation".into()),
    }
}
#[tauri::command]
pub async fn subscription_data_io(
    app: tauri::AppHandle,
    extension_id: String,
    vault_id: String,
    path: String,
    operation: String,
    content: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorize(&app, &extension_id, "vault")?;
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        let root = app_data_root(&home, &vault_id)?;
        subscription_io(
            root.to_str().ok_or("invalid application data path")?,
            &path,
            &operation,
            content,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn subscription_vault_io(
    app: tauri::AppHandle,
    extension_id: String,
    root: String,
    path: String,
    operation: String,
    content: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorize(&app, &extension_id, "vault")?;
        subscription_io(&root, &path, &operation, content)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn application_data_roots_are_vault_partitioned_and_reject_unsafe_ids() {
        let home = std::env::temp_dir().join(format!("folyn-data-root-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        // temp_dir may sit behind a symlink (/var -> /private/var on macOS); app_data_root canonicalizes.
        let home = fs::canonicalize(&home).unwrap();
        let a = app_data_root(&home, "vault-a").unwrap();
        let b = app_data_root(&home, "vault-b").unwrap();
        assert_ne!(a, b);
        assert!(a.starts_with(home.join(".folyn/subscriptions")));
        for unsafe_id in ["../escape", "/tmp", "", ".", "vault/a"] {
            assert!(app_data_root(&home, unsafe_id).is_err());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let other = home.join("other");
            fs::create_dir_all(&other).unwrap();
            let _ = fs::remove_dir_all(home.join(".folyn"));
            symlink(&other, home.join(".folyn")).unwrap();
            assert!(app_data_root(&home, "vault-c").is_err());
        }
        let _ = fs::remove_dir_all(home);
    }
    #[test]
    fn rejects_local_addresses_and_credentials() {
        for value in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
        ] {
            assert!(!public_ip(value.parse().unwrap()), "{value}");
        }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        // fake-ip proxy range must stay reachable (Clash/Surge DNS mode)
        assert!(public_ip("198.18.0.1".parse().unwrap()));
        assert!(!public_ip("198.51.100.1".parse().unwrap()));
        assert!(validate_url("https://user:pass@example.com").is_err());
        assert!(validate_url("file:///tmp/a").is_err());
    }
    #[test]
    fn compressed_content_and_declared_charsets_are_decoded_with_limits() {
        let text = "订阅博客";
        let (gbk, _, _) = encoding_rs::GBK.encode(text);
        assert_eq!(decode_text(&gbk, "text/html; charset=gbk"), text);
        let html = [b"<meta charset=gbk>".as_slice(), gbk.as_ref()].concat();
        assert!(decode_text(&html, "text/html").contains(text));
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(text.as_bytes()).unwrap();
        let compressed = gzip.finish().unwrap();
        assert_eq!(
            decode_content(compressed.clone(), "gzip", 1024).unwrap(),
            text.as_bytes()
        );
        assert!(decode_content(compressed, "gzip", 2).is_err());
        assert!(decode_content(vec![1, 2, 3], "unknown", 1024).is_err());
    }
    #[test]
    fn concurrent_saves_can_create_the_same_parent_directory() {
        let root = std::env::temp_dir().join(format!("folyn-parent-race-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(32));
        let workers: Vec<_> = (0..32)
            .map(|n| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let path = scoped_path(
                        root.to_str().unwrap(),
                        &format!("Articles/assets/{n}.png"),
                        true,
                    )?;
                    atomic_write(&path, b"complete", true)
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap().unwrap();
        }
        assert_eq!(
            fs::read_dir(root.join("Articles/assets")).unwrap().count(),
            32
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn removing_cache_trees_and_missing_paths_is_idempotent() {
        let root = std::env::temp_dir().join(format!("folyn-remove-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("images/article/nested")).unwrap();
        fs::create_dir_all(root.join("Notes")).unwrap();
        fs::write(root.join("images/article/nested/one.png"), b"cached").unwrap();
        fs::write(root.join("Notes/user.md"), b"user note").unwrap();
        for relative in ["images/article", "images/article", "bodies/not-cached/v1"] {
            let path = scoped_path(root.to_str().unwrap(), relative, false).unwrap();
            remove_path(&path).unwrap();
            assert!(!path.exists());
        }
        let file = root.join("cached.json");
        fs::write(&file, b"cache").unwrap();
        remove_path(&file).unwrap();
        remove_path(&file).unwrap();
        assert!(!file.exists());
        assert_eq!(fs::read(root.join("Notes/user.md")).unwrap(), b"user note");
        // An invalid parent is a genuine IO error, not an absent cache entry.
        fs::write(root.join("not-a-directory"), b"file").unwrap();
        assert!(remove_path(&root.join("not-a-directory/child")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn removing_cache_does_not_follow_symlinks() {
        let root = std::env::temp_dir().join(format!("folyn-remove-links-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("cache")).unwrap();
        fs::create_dir_all(root.join("user-notes")).unwrap();
        fs::write(root.join("user-notes/note.md"), b"preserved").unwrap();
        std::os::unix::fs::symlink(root.join("user-notes"), root.join("linked")).unwrap();
        assert!(scoped_path(root.to_str().unwrap(), "linked", false).is_err());
        assert!(scoped_path(root.to_str().unwrap(), "linked/note.md", false).is_err());
        assert!(remove_path(&root.join("linked")).is_err());
        std::os::unix::fs::symlink(root.join("user-notes"), root.join("cache/linked")).unwrap();
        let path = scoped_path(root.to_str().unwrap(), "cache", false).unwrap();
        remove_path(&path).unwrap();
        assert_eq!(
            fs::read(root.join("user-notes/note.md")).unwrap(),
            b"preserved"
        );
        assert!(!root.join("cache").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn exclusive_create_never_overwrites() {
        let dir =
            std::env::temp_dir().join(format!("folyn-subscription-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("entry.md");
        let _ = fs::remove_file(&path);
        atomic_write(&path, b"first", true).unwrap();
        assert!(atomic_write(&path, b"second", true).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"first");
        fs::remove_dir_all(&dir).unwrap();
    }
}
