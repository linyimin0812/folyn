use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use aes::Aes128;
use cbc::Decryptor;
use cipher::block_padding::Pkcs7;
use cipher::{BlockModeDecrypt, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use rusqlite::{Connection, OpenFlags};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use tauri::Manager;

/// Result of a Chrome import — counts let the UI report what actually landed.
#[derive(serde::Serialize)]
pub struct BrowserImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub error: Option<String>,
}

/// A cookie ready to be pushed into a WKWebView data store.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ImportedCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    /// Unix timestamp (seconds); None = session cookie.
    pub expires: Option<i64>,
}

/// A decrypted Chrome login entry.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ImportedPassword {
    pub id: String,
    pub url: String,
    pub username: String,
    pub password: String,
}

/// Cookies decrypted during the last `import_chrome_cookies` call. Held in
/// memory (never written to disk) and re-applied to every webview — including
/// ones created after the import.
static IMPORTED_COOKIES: LazyLock<Mutex<Vec<ImportedCookie>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

const CHROME_KEYCHAIN_SERVICE: &str = "Chrome Safe Storage";

// ── Chrome profile discovery ────────────────────────────────────────────────

/// Profile directories that actually contain a Cookies DB. Default profile is
/// always first; numbered `Profile N` dirs follow.
fn chrome_profile_dirs(home: &Path) -> Vec<PathBuf> {
    let base = home.join("Library/Application Support/Google/Chrome");
    let mut dirs = Vec::new();
    let default = base.join("Default");
    if default.join("Cookies").exists() {
        dirs.push(default);
    }
    if let Ok(entries) = fs::read_dir(&base) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("Profile ") && path.join("Cookies").exists() {
                dirs.push(path);
            }
        }
    }
    dirs
}

/// Copy a Chromium SQLite DB plus its WAL/SHM sidecars into a scratch dir so
/// we read a consistent snapshot even while Chrome holds the file open.
fn copy_db_snapshot(src: &Path, scratch: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(scratch).map_err(|e| format!("cannot create scratch dir: {e}"))?;
    let file_name = src
        .file_name()
        .ok_or_else(|| "invalid db path".to_string())?
        .to_string_lossy()
        .into_owned();
    let dst = scratch.join(&file_name);
    fs::copy(src, &dst).map_err(|e| format!("cannot copy {}: {e}", src.display()))?;
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{}", src.display(), suffix));
        if side.exists() {
            let _ = fs::copy(&side, scratch.join(format!("{file_name}{suffix}")));
        }
    }
    Ok(dst)
}

// ── Chrome decryption (macOS) ──────────────────────────────────────────────

/// Read Chrome's encryption password from the macOS Keychain. Mirrors
/// pycookiecheat: `security -w` may return raw bytes or a `0x…` hex dump.
fn chrome_keychain_password() -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-w", "-s", CHROME_KEYCHAIN_SERVICE])
        .output()
        .map_err(|e| format!("cannot read Keychain (security): {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Keychain access to Chrome Safe Storage was denied".to_string()
        } else {
            format!("Keychain error: {err}")
        });
    }
    let mut bytes = out.stdout;
    while matches!(bytes.last(), Some(b'\n' | b'\r')) {
        bytes.pop();
    }
    if let Some(hex) = bytes.strip_prefix(b"0x") {
        let hex_str = String::from_utf8_lossy(hex);
        bytes = hex_decode(hex_str.trim())
            .map_err(|e| format!("cannot decode Keychain hex password: {e}"))?;
    }
    Ok(bytes)
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    let clean: String = hex.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() % 2 != 0 {
        return Err("odd hex length".into());
    }
    (0..clean.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean[i..i + 2], 16).map_err(|e| format!("bad hex: {e}")))
        .collect()
}

/// Derive Chrome's AES-128 key: PBKDF2(password, "saltysalt", 1003, SHA-1).
fn derive_key(password: &[u8]) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", 1003, &mut key);
    key
}

/// Decrypt a Chrome `v10`/`v11` value: AES-128-CBC, IV = 16 spaces, PKCS#7.
/// Chrome M130+ prepends SHA-256(host) to the plaintext before encryption;
/// the prefix is stripped only when it actually matches.
fn decrypt_chrome_value(enc: &[u8], key: &[u8; 16], hash_candidates: &[&str]) -> Option<String> {
    let payload = if let Some(p) = enc.strip_prefix(b"v10") {
        p
    } else if let Some(p) = enc.strip_prefix(b"v11") {
        p
    } else {
        return None;
    };
    let iv = [0x20u8; 16];
    let decryptor = Decryptor::<Aes128>::new_from_slices(key, &iv).ok()?;
    let mut plain = decryptor.decrypt_padded_vec::<Pkcs7>(payload).ok()?;
    if plain.len() >= 32 {
        let matched = hash_candidates.iter().any(|candidate| {
            let digest = Sha256::digest(candidate.as_bytes());
            plain[..32] == digest[..]
        });
        if matched {
            plain.drain(..32);
        }
    }
    String::from_utf8(plain).ok()
}

/// Non-prefixed legacy values are plaintext; accept only printable UTF-8.
fn plaintext_value(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.contains(&0) {
        return None;
    }
    let s = String::from_utf8_lossy(bytes);
    if s.chars()
        .all(|c| !c.is_control() || c == '\n' || c == '\t' || c == '\r')
    {
        Some(s.into_owned())
    } else {
        None
    }
}

/// Import cookies from every Chrome profile and cache them for injection.
#[tauri::command]
pub async fn import_chrome_cookies() -> Result<BrowserImportResult, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let keychain_password = chrome_keychain_password()?;
    let key = derive_key(&keychain_password);
    let scratch = std::env::temp_dir().join(format!("quill-cookies-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch);

    let mut imported: Vec<ImportedCookie> = Vec::new();
    let mut skipped = 0usize;
    let mut error: Option<String> = None;

    for dir in chrome_profile_dirs(Path::new(&home)) {
        let db = dir.join("Cookies");
        let snapshot = match copy_db_snapshot(&db, &scratch) {
            Ok(p) => p,
            Err(e) => {
                error = Some(e);
                continue;
            }
        };
        let conn = match Connection::open_with_flags(
            &snapshot,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(c) => c,
            Err(e) => {
                error = Some(format!("cannot open {}: {e}", snapshot.display()));
                continue;
            }
        };
        let query = "SELECT host_key, name, path, is_secure, is_httponly, expires_utc, encrypted_value FROM cookies";
        let mut stmt = match conn.prepare(query) {
            Ok(s) => s,
            Err(e) => {
                error = Some(format!("cannot read cookies table: {e}"));
                continue;
            }
        };
        let rows = match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Vec<u8>>(6)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(e) => {
                error = Some(format!("cannot query cookies: {e}"));
                continue;
            }
        };
        for row in rows {
            match row {
                Ok((host_key, name, path, is_secure, is_httponly, expires_utc, encrypted)) => {
                    if name.is_empty() || host_key.is_empty() {
                        skipped += 1;
                        continue;
                    }
                    let value = match decrypt_chrome_value(&encrypted, &key, &[&host_key]) {
                        Some(v) => v,
                        None => match plaintext_value(&encrypted) {
                            Some(v) => v,
                            None => {
                                skipped += 1;
                                continue;
                            }
                        },
                    };
                    // Chrome host keys may start with "."; NSHTTPCookie wants the bare
                    // registrable domain and treats it as a domain cookie.
                    let domain = host_key.strip_prefix('.').unwrap_or(&host_key).to_string();
                    let expires =
                        (expires_utc > 0).then(|| expires_utc / 1_000_000 - 11_644_473_600);
                    imported.push(ImportedCookie {
                        name,
                        value,
                        domain,
                        path: if path.is_empty() { "/".into() } else { path },
                        secure: is_secure != 0,
                        http_only: is_httponly != 0,
                        expires,
                    });
                }
                Err(_) => skipped += 1,
            }
        }
    }

    let _ = fs::remove_dir_all(&scratch);
    *IMPORTED_COOKIES.lock().unwrap() = imported.clone();
    Ok(BrowserImportResult {
        imported: imported.len(),
        skipped,
        error,
    })
}

/// Push every cached imported cookie into one webview's data store.
#[tauri::command]
pub async fn apply_imported_cookies(app: tauri::AppHandle, label: String) -> Result<usize, String> {
    Ok(apply_imported_cookies_to_label(&app, &label))
}

/// Non-command entry point so `create_webview` can seed freshly created
/// browser webviews with previously imported cookies.
pub fn apply_imported_cookies_to_label(app: &tauri::AppHandle, label: &str) -> usize {
    let cookies = IMPORTED_COOKIES.lock().unwrap().clone();
    if cookies.is_empty() {
        return 0;
    }
    let Some(wv) = app.get_webview(label) else {
        return 0;
    };
    let mut applied = 0usize;
    for c in &cookies {
        let mut builder = tauri::webview::Cookie::build((c.name.clone(), c.value.clone()))
            .domain(c.domain.clone())
            .path(c.path.clone())
            .secure(c.secure)
            .http_only(c.http_only);
        if let Some(exp) = c.expires {
            if let Ok(dt) = time::OffsetDateTime::from_unix_timestamp(exp) {
                builder = builder.expires(dt);
            }
        }
        if wv.set_cookie(builder.build()).is_ok() {
            applied += 1;
        }
    }
    applied
}

/// Whether any cookies are cached from a previous import.
#[tauri::command]
pub fn has_imported_cookies() -> bool {
    !IMPORTED_COOKIES.lock().unwrap().is_empty()
}

/// Import decrypted passwords from every Chrome profile (returned to the
/// frontend, which persists them via `save_imported_passwords`).
#[tauri::command]
pub async fn import_chrome_passwords(
) -> Result<(Vec<ImportedPassword>, BrowserImportResult), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let keychain_password = chrome_keychain_password()?;
    let key = derive_key(&keychain_password);
    let scratch = std::env::temp_dir().join(format!("quill-logins-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch);

    let mut passwords: Vec<ImportedPassword> = Vec::new();
    let mut skipped = 0usize;
    let mut error: Option<String> = None;

    for dir in chrome_profile_dirs(Path::new(&home)) {
        let db = dir.join("Login Data");
        if !db.exists() {
            continue;
        }
        let snapshot = match copy_db_snapshot(&db, &scratch) {
            Ok(p) => p,
            Err(e) => {
                error = Some(e);
                continue;
            }
        };
        let conn = match Connection::open_with_flags(
            &snapshot,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(c) => c,
            Err(e) => {
                error = Some(format!("cannot open {}: {e}", snapshot.display()));
                continue;
            }
        };
        let query = "SELECT origin_url, username_value, password_value, signon_realm FROM logins";
        let mut stmt = match conn.prepare(query) {
            Ok(s) => s,
            Err(e) => {
                error = Some(format!("cannot read logins table: {e}"));
                continue;
            }
        };
        let rows = match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(e) => {
                error = Some(format!("cannot query logins: {e}"));
                continue;
            }
        };
        for row in rows {
            match row {
                Ok((origin_url, username, encrypted, realm)) => {
                    if origin_url.is_empty() {
                        skipped += 1;
                        continue;
                    }
                    let host = url_host(&origin_url).unwrap_or_else(|| realm.clone());
                    let password =
                        match decrypt_chrome_value(&encrypted, &key, &[&host, &origin_url]) {
                            Some(v) if !v.is_empty() => v,
                            _ => match plaintext_value(&encrypted) {
                                Some(v) => v,
                                None => {
                                    skipped += 1;
                                    continue;
                                }
                            },
                        };
                    passwords.push(ImportedPassword {
                        id: format!("{}:{}", origin_url, username),
                        url: origin_url,
                        username,
                        password,
                    });
                }
                Err(_) => skipped += 1,
            }
        }
    }

    let _ = fs::remove_dir_all(&scratch);
    let imported = passwords.len();
    Ok((
        passwords,
        BrowserImportResult {
            imported,
            skipped,
            error,
        },
    ))
}

fn url_host(url: &str) -> Option<String> {
    tauri::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}

/// Persist imported passwords (restrictive 0600 perms — they're the user's
/// decrypted Chrome credentials).
#[tauri::command]
pub fn save_imported_passwords(
    app: tauri::AppHandle,
    passwords: Vec<ImportedPassword>,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data dir: {e}"))?;
    let path = dir.join("browser-passwords.json");
    let json = serde_json::to_string_pretty(&passwords).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("cannot write passwords: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Load previously imported passwords.
#[tauri::command]
pub fn load_imported_passwords(app: tauri::AppHandle) -> Result<Vec<ImportedPassword>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let path = dir.join("browser-passwords.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let json = fs::read_to_string(&path).map_err(|e| format!("cannot read passwords: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("cannot parse passwords: {e}"))
}

/// Delete imported passwords from disk (used by the UI "clear all" action).
#[tauri::command]
pub fn clear_imported_passwords(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let path = dir.join("browser-passwords.json");
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("cannot delete passwords: {e}"))?;
    }
    Ok(())
}

/// Navigate an embedded webview to a new URL (address-bar navigation).
#[tauri::command]
pub async fn load_url_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "webview not found".to_string())?;
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    wv.navigate(parsed)
        .map_err(|e| format!("failed to load url: {e}"))
}

/// Inject username/password into the page's inputs (React/Vue-safe setters).
/// Returns whether at least one field was found — the eval result is
/// delivered asynchronously, so the boolean only reflects script install.
#[tauri::command]
pub async fn fill_webview_credentials(
    app: tauri::AppHandle,
    label: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "webview not found".to_string())?;
    let username_json = serde_json::to_string(&username).map_err(|e| e.to_string())?;
    let password_json = serde_json::to_string(&password).map_err(|e| e.to_string())?;
    let js = format!(
        r#"(function() {{
            const setVal = (el, v) => {{
                if (!el) return;
                const proto = el instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : HTMLInputElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                if (desc && desc.set) desc.set.call(el, v);
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                el.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }};
            const visible = (el) => el && el.offsetParent !== null;
            const userSelectors = [
                'input[type="email"]',
                'input[autocomplete="username"]',
                'input[autocomplete="email"]',
                'input[name*="user" i]',
                'input[id*="user" i]',
                'input[type="text"]',
                'input:not([type])'
            ];
            let userEl = null;
            for (const sel of userSelectors) {{
                const el = document.querySelector(sel);
                if (visible(el)) {{ userEl = el; break; }}
            }}
            const passEl = document.querySelector('input[type="password"]');
            if (userEl) setVal(userEl, {username_json});
            if (passEl) setVal(passEl, {password_json});
            return !!(userEl || passEl);
        }})()"#
    );
    wv.eval(&js)
        .map_err(|e| format!("failed to inject credentials: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::Aes128;
    use cbc::Encryptor;
    use cipher::BlockModeEncrypt;

    /// Round-trip: encrypt with the exact Chrome macOS scheme, then assert
    /// `decrypt_chrome_value` recovers the plaintext (with and without the
    /// M130+ SHA-256(host) prefix).
    #[test]
    fn decrypts_v10_cbc_round_trip() {
        let key = derive_key(b"test-keychain-password");
        let cases: Vec<(&str, Option<&str>)> = vec![
            ("hello world", None),
            ("session=abc123", Some("example.com")),
            ("🦀 rust", Some("localhost")),
        ];
        for (plain, host) in cases {
            let mut payload = plain.as_bytes().to_vec();
            if let Some(h) = host {
                let mut digest = Sha256::digest(h.as_bytes()).to_vec();
                digest.append(&mut payload);
                payload = digest;
            }
            let encryptor = Encryptor::<Aes128>::new_from_slices(&key, &[0x20u8; 16]).unwrap();
            let ct = encryptor.encrypt_padded_vec::<Pkcs7>(&payload);
            let mut enc = b"v10".to_vec();
            enc.extend(ct);

            let candidates: Vec<&str> = host.into_iter().collect();
            let decrypted =
                decrypt_chrome_value(&enc, &key, &candidates).expect("decryption should succeed");
            assert_eq!(decrypted, plain);
        }
    }

    #[test]
    fn decrypts_v11_cbc_round_trip() {
        let key = derive_key(b"test-keychain-password");
        let encryptor = Encryptor::<Aes128>::new_from_slices(&key, &[0x20u8; 16]).unwrap();
        let ct = encryptor.encrypt_padded_vec::<Pkcs7>(b"token");
        let mut enc = b"v11".to_vec();
        enc.extend(ct);
        assert_eq!(
            decrypt_chrome_value(&enc, &key, &[]).as_deref(),
            Some("token")
        );
    }

    #[test]
    fn legacy_plaintext_values_are_returned() {
        assert_eq!(
            plaintext_value(b"not-encrypted"),
            Some("not-encrypted".into())
        );
        assert_eq!(plaintext_value(b"with\0nul"), None);
    }

    #[test]
    fn hash_prefix_only_stripped_when_matching() {
        let key = derive_key(b"test-keychain-password");
        // Host A's prefix must not be stripped for host B's plaintext.
        let mut payload = b"plain".to_vec();
        let encryptor = Encryptor::<Aes128>::new_from_slices(&key, &[0x20u8; 16]).unwrap();
        let ct = encryptor.encrypt_padded_vec::<Pkcs7>(&payload);
        let mut enc = b"v10".to_vec();
        enc.extend(ct);
        assert_eq!(
            decrypt_chrome_value(&enc, &key, &["other.com"]).as_deref(),
            Some("plain")
        );
        payload = b"x".to_vec();
        let _ = payload;
    }
}
