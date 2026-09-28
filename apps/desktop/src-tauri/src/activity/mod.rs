//! Activity collection (design: folyn-activity-collection-design.md §4–§6).
//! Commands are stateless: the vault root is passed in by the frontend (same
//! contract as `scan_file_tree`), the SQLite connection is cached per DB path
//! (under `~/.folyn`, see `db::conn`).

pub mod db;
pub mod ingest;
pub mod query;
pub mod runs;

use crate::errors::AppError;
use ingest::{ActivityEventIn, PushOutcome};
use query::{
    DigestInput, EntityRow, EventRow, MetricRow, NeighborRow,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::net::ToSocketAddrs;

// ── collector exec (design §2.2 — collectors pull local sources) ──────────────
// Trusted blob modules cannot import `@tauri-apps/api` (bare specifiers don't
// resolve from a blob URL), and the shell plugin is sidecar-scoped — so the
// host hands collectors a tiny `ctx.exec` backed by this command.
// ponytail: program allowlist — exactly the binaries the reference collectors
// need. Extend the list when a collector legitimately needs another tool; a
// generic exec would be an unbounded code-execution surface for extension code.
const EXEC_ALLOWED_PROGRAMS: &[&str] = &["git"];

/// Result of `activity_exec` — stdout + stderr + exit code; the collector
/// decides what a non-zero exit means (git returns 128 on bad repo, etc.).
#[derive(Serialize, Debug)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Run an allowlisted program with separated args (no shell → no injection)
/// in `cwd`. Backs the `ctx.exec` the collector runtime passes to `collect()`.
#[tauri::command]
pub fn activity_exec(
    program: String,
    args: Vec<String>,
    cwd: String,
) -> Result<ExecOutput, AppError> {
    if !EXEC_ALLOWED_PROGRAMS.contains(&program.as_str()) {
        return Err(format!("activity_exec denied: program not allowlisted: {program}").into());
    }
    let out = std::process::Command::new(&program)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("activity_exec failed to run {program}: {e}"))?;
    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code().unwrap_or(-1),
    })
}

// ── Frontmost-window sampling (window-activity collector) ────────────────────
// ponytail: these are FIXED queries with no collector-controlled arguments —
// a fixed osascript on macOS, fixed FFI calls on Windows (same reasoning as
// the EXEC_ALLOWED_PROGRAMS allowlist above: exposing osascript/FFI with
// caller-chosen args would be an unbounded exec surface). Widening what this
// command returns means editing this file, not anything extension-side.

/// Result of `activity_front_window` — frontmost app + window title (title
/// null when the platform/window can't provide one).
#[derive(Serialize, Debug)]
pub struct FrontWindow {
    pub app: String,
    pub title: Option<String>,
}

/// Sample the frontmost window (app + title) for the window-activity
/// collector. `None` when unavailable (unsupported platform, permission
/// denied, no foreground window). On macOS the first call triggers the
/// system Automation-permission prompt — expected, documented in the
/// collector's manifest description.
#[tauri::command]
pub fn activity_front_window() -> Option<FrontWindow> {
    front_window()
}

#[cfg(target_os = "macos")]
fn front_window() -> Option<FrontWindow> {
    // System Events list output: "AppName, Window Title" / "AppName, missing value".
    let script = "tell application \"System Events\" to get {name, name of first window} of first application process whose frontmost is true";
    let out = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !out.status.success() {
        // Automation not granted yet (or AppleScript error): the app-only
        // script usually still works — same permission, weaker query.
        let fallback = "tell application \"System Events\" to get name of first application process whose frontmost is true";
        let out2 = std::process::Command::new("osascript")
            .args(["-e", fallback])
            .output()
            .ok()?;
        if !out2.status.success() {
            return None;
        }
        let app = String::from_utf8_lossy(&out2.stdout).trim().to_string();
        return (!app.is_empty()).then(|| FrontWindow { app, title: None });
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Titles can contain commas; app names can't contain ", " in practice —
    // split at the first separator so a comma'd title stays whole.
    let (app, title) = match line.split_once(", ") {
        Some((a, t)) => (a.trim().to_string(), t.trim()),
        None => (line, ""),
    };
    if app.is_empty() {
        return None;
    }
    let title = if title.is_empty() || title == "missing value" {
        None
    } else {
        Some(title.to_string())
    };
    Some(FrontWindow { app, title })
}

#[cfg(target_os = "windows")]
fn front_window() -> Option<FrontWindow> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            log::warn!("[activity] front_window: no foreground window");
            return None;
        }
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
        let title = if title_len > 0 {
            Some(String::from_utf16_lossy(&title_buf[..title_len as usize]))
        } else {
            None
        };
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            log::warn!("[activity] front_window: no pid for foreground window");
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            log::warn!("[activity] front_window: OpenProcess denied for pid {pid}");
            return None;
        }
        let mut path_buf = [0u16; 1024];
        let mut path_len = path_buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            path_buf.as_mut_ptr(),
            &mut path_len,
        );
        CloseHandle(process);
        if ok == 0 {
            log::warn!("[activity] front_window: QueryFullProcessImageNameW failed for pid {pid}");
            return None;
        }
        let image = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let app = exe_stem(&image).to_string();
        if app.is_empty() {
            log::warn!("[activity] front_window: empty image path for pid {pid}");
            return None;
        }
        // ponytail: UWP front windows are owned by ApplicationFrameHost —
        // resolving the real app needs IApplicationActivationManager; add if
        // UWP titles matter.
        Some(FrontWindow { app, title })
    }
}

/// File name of a process image path without its extension, handling both
/// `\` and `/` separators. The extension is stripped from the last path
/// component only. `""` in → `""` out.
#[cfg(any(target_os = "windows", test))]
fn exe_stem(image_path: &str) -> &str {
    let name = image_path.rsplit(['\\', '/']).next().unwrap_or(image_path);
    match name.rfind('.') {
        // ".hidden" keeps its name: the leading dot isn't an extension.
        Some(0) | None => name,
        Some(i) => &name[..i],
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn front_window() -> Option<FrontWindow> {
    None
}

// ── Vault scan (file-activity collector) ──────────────────────────────────────

/// One file found by `activity_scan_vault` (serde camelCase for the JS side).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultFileEntry {
    /// Vault-root-relative path, forward slashes.
    pub path: String,
    pub mtime_ms: i64,
    pub size: u64,
}

/// Recursively list every file under `vault_root`. `.git` is always skipped
/// (repo internals are never user activity); any directory whose relative path
/// OR basename matches a trimmed non-empty exclude entry is skipped too.
/// `exclude_patterns` are the appearance「过滤文件/文件夹」globs: a dir OR file
/// is skipped when any segment of its relative path matches a pattern
/// (`*` = any chars, `?` = one char, otherwise exact segment match — mirrors
/// `src/utils/excludePattern.ts`). Sorted by path. Backs the `ctx.scanVault`
/// the collector runtime injects.
#[tauri::command]
pub fn activity_scan_vault(
    vault_root: String,
    exclude_dirs: Vec<String>,
    exclude_patterns: Vec<String>,
) -> Result<Vec<VaultFileEntry>, AppError> {
    let excludes: Vec<String> = exclude_dirs
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let patterns: Vec<String> = exclude_patterns
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let root = std::path::Path::new(&vault_root);
    if !root.is_dir() {
        return Err(format!("activity_scan_vault: not a directory: {vault_root}").into());
    }
    let mut out = Vec::new();
    walk_vault(root, "", &excludes, &patterns, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Glob match for one path segment: `*` = any run of chars, `?` = one char,
/// otherwise exact. Same semantics as `patternToRegExp` in
/// `src/utils/excludePattern.ts`. Char-based so `?` never splits a UTF-8 char.
fn wildcard_match(seg: &str, pat: &str) -> bool {
    fn go(s: &[char], p: &[char]) -> bool {
        if p.is_empty() {
            return s.is_empty();
        }
        match p[0] {
            '*' => (0..=s.len()).any(|i| go(&s[i..], &p[1..])),
            '?' => !s.is_empty() && go(&s[1..], &p[1..]),
            c => !s.is_empty() && s[0] == c && go(&s[1..], &p[1..]),
        }
    }
    let s: Vec<char> = seg.chars().collect();
    let p: Vec<char> = pat.chars().collect();
    go(&s, &p)
}

/// Does any path segment of `rel` match one of the patterns?
fn segment_matches_pattern(rel: &str, patterns: &[String]) -> bool {
    rel.split('/').any(|seg| {
        patterns.iter().any(|p| {
            if p.contains('*') || p.contains('?') {
                wildcard_match(seg, p)
            } else {
                seg == p
            }
        })
    })
}

/// Fixed recursive walk (std::fs only). Unreadable entries are skipped — a
/// scan is a snapshot, not a contract to enumerate everything.
fn walk_vault(
    dir: &std::path::Path,
    rel: &str,
    excludes: &[String],
    patterns: &[String],
    out: &mut Vec<VaultFileEntry>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let Ok(ft) = entry.file_type() else { continue };
        // Appearance「过滤文件/文件夹」patterns apply to files AND dirs.
        if segment_matches_pattern(&child_rel, patterns) {
            continue;
        }
        if ft.is_dir() {
            // .git skipped unconditionally: repo internals, never user activity.
            if name == ".git" {
                continue;
            }
            if excludes.iter().any(|e| child_rel == *e || name == *e) {
                continue;
            }
            walk_vault(&entry.path(), &child_rel, excludes, patterns, out);
        } else {
            let Ok(md) = entry.metadata() else { continue };
            let mtime_ms = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(VaultFileEntry { path: child_rel, mtime_ms, size: md.len() });
        }
    }
}

// ── Vault text-file read (file-activity collector content capture) ───────────

/// Read one vault text file, truncated, for the file collector's content /
/// diff capture. Backs the `ctx.readVaultFile` the collector runtime injects.
/// `None` for absolute paths, `..` traversal, files > 1 MB, binary (NUL byte
/// in the read window), invalid UTF-8, or any read failure.
#[tauri::command]
pub fn activity_read_text_file(
    vault_root: String,
    path: String,
    max_bytes: Option<usize>,
) -> Option<String> {
    read_text_file(&vault_root, &path, max_bytes)
}

fn read_text_file(vault_root: &str, path: &str, max_bytes: Option<usize>) -> Option<String> {
    let rel = std::path::Path::new(path);
    if rel.is_absolute() || path.split('/').any(|s| s == "..") {
        return None;
    }
    // ponytail: clamp instead of rejecting — a caller passing 0 or a huge cap
    // still gets a sane window, never an error worth surfacing.
    let cap = max_bytes.unwrap_or(8192).clamp(1, 65_536);
    let full = std::path::Path::new(vault_root).join(path);
    let len = std::fs::metadata(&full).ok().filter(|md| md.is_file())?.len();
    if len > 1_048_576 {
        return None; // huge files: skip entirely, no content for these
    }
    let bytes = std::fs::read(&full).ok()?;
    let window = &bytes[..bytes.len().min(cap)];
    if window.contains(&0u8) {
        return None; // binary sniff
    }
    std::str::from_utf8(window).ok().map(|s| s.to_string())
}

// ── IMAP fetch (email collector) ──────────────────────────────────────────────
// Same trust model as scanVault/readVaultFile: a FIXED protocol implementation
// (imap crate over rustls) where collector-controlled values are pure data —
// host, port, credentials, folder, time window, page size. No exec, no shell.
// TLS only (imaps, default 993) — plaintext/STARTTLS IMAP is not supported.

/// One message returned by `activity_imap_fetch` (serde camelCase for the JS side).
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImapFetchArgs {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: String,
    pub folder: Option<String>,
    /// Epoch-ms INTERNALDATE lower bound. SEARCH SINCE is day-granular, so one
    /// day of slack is subtracted here — callers still filter exactly.
    pub since_ms: i64,
    pub max: Option<usize>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImapMessage {
    pub uid: u32,
    pub message_id: Option<String>,
    pub subject: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    /// INTERNALDATE as epoch ms.
    pub date_ms: i64,
    /// First ~2KB of BODY[TEXT], only when it sniffs as plain text. Raw
    /// transfer-encoded bodies (base64/QP) are dropped, not garbled.
    pub snippet: Option<String>,
}

/// Fetch new mail over IMAPS for the email collector. Backs the `ctx.imapFetch`
/// the collector runtime injects. Async + spawn_blocking: the imap crate is
/// sync, and a network command must not sit on the main thread.
#[tauri::command]
pub async fn activity_imap_fetch(args: ImapFetchArgs) -> Result<Vec<ImapMessage>, AppError> {
    tauri::async_runtime::spawn_blocking(move || imap_fetch(args))
        .await
        .map_err(|e| AppError::Internal {
            detail: format!("imap task join failed: {e}"),
        })?
}

const IMAP_MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// Epoch ms → IMAP date "DD-Mon-YYYY" with one day of SINCE slack.
fn imap_since_date(since_ms: i64) -> String {
    let secs = since_ms.saturating_sub(86_400_000) / 1000;
    match time::OffsetDateTime::from_unix_timestamp(secs) {
        Ok(t) => format!("{:02}-{}-{}", t.day(), IMAP_MONTHS[(t.month() as usize - 1) % 12], t.year()),
        Err(_) => "01-Jan-1970".to_string(),
    }
}

/// Mailbox name → IMAP astring: atom as-is, quoted (with `"`/`\` escaped) when
/// it contains spaces/quotes. Control chars and non-ASCII are rejected — real
/// non-ASCII folders are IMAP-UTF7 on the wire and need a proper encoder.
/// ponytail: add UTF-7 encoding if non-ASCII folder names ever matter.
fn quote_mailbox(folder: &str) -> Result<String, AppError> {
    if folder.is_empty()
        || folder.chars().any(|c| c.is_ascii_control() || !c.is_ascii())
    {
        return Err(format!("activity_imap_fetch: invalid folder name: {folder:?}").into());
    }
    if folder.chars().any(|c| c == '"' || c == '\\' || c == ' ') {
        Ok(format!("\"{}\"", folder.replace('\\', "\\\\").replace('"', "\\\"")))
    } else {
        Ok(folder.to_string())
    }
}

/// Reject hosts with whitespace/control chars (IMAP command injection guard —
/// the values are spliced into protocol lines host-side).
fn valid_host(host: &str) -> bool {
    !host.is_empty() && !host.chars().any(|c| c.is_ascii_control() || c.is_whitespace())
}

fn lossy(bytes: Option<&[u8]>) -> Option<String> {
    bytes.map(|b| String::from_utf8_lossy(b).into_owned())
}

/// `mailbox@host` (+ display name when present) for one envelope address.
fn format_addr(a: &imap_proto::types::Address<'_>) -> String {
    let email = match (a.mailbox, a.host) {
        (Some(m), Some(h)) => format!("{}@{}", String::from_utf8_lossy(m), String::from_utf8_lossy(h)),
        (Some(m), None) => String::from_utf8_lossy(m).into_owned(),
        _ => String::new(),
    };
    match a.name {
        Some(n) if !n.is_empty() => format!("{} <{}>", String::from_utf8_lossy(n), email),
        _ => email,
    }
}

fn format_addrs(addrs: &Vec<imap_proto::types::Address<'_>>) -> Option<String> {
    let joined = addrs.iter().map(format_addr).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ");
    (!joined.is_empty()).then_some(joined)
}

/// Any wrapped line ≥40 chars of pure base64 alphabet → treat as encoded.
/// ponytail: heuristic, not decoding — quoted-printable slips through; add a
/// real decoder when body previews (not just subject/from) matter.
fn looks_base64(b: &[u8]) -> bool {
    b.split(|&c| c == b'\n' || c == b'\r').any(|line| {
        line.len() >= 40
            && line.iter().all(|&c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'=')
    })
}

/// Keep a body prefix only when it sniffs as plain text (binary and base64
/// dropped rather than garbled).
fn text_snippet(bytes: Option<&[u8]>) -> Option<String> {
    let b = bytes?;
    if b.is_empty() || looks_base64(b) {
        return None;
    }
    let printable = b.iter().filter(|&&c| c == b'\n' || c == b'\r' || c == b'\t' || (0x20..0x7f).contains(&c) || c >= 0x80).count();
    if printable * 10 < b.len() * 9 {
        return None;
    }
    Some(String::from_utf8_lossy(b).trim().to_string())
}

fn imap_fetch(args: ImapFetchArgs) -> Result<Vec<ImapMessage>, AppError> {
    let host = args.host.trim().to_string();
    if !valid_host(&host) {
        let raw = args.host.clone();
        return Err(format!("activity_imap_fetch: invalid host: {raw:?}").into());
    }
    let port = args.port.unwrap_or(993);
    let folder = quote_mailbox(args.folder.as_deref().unwrap_or("INBOX").trim())?;
    let max = args.max.unwrap_or(100).clamp(1, 200);

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls_config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = rustls::pki_types::ServerName::try_from(host.clone())
        .map_err(|e| format!("activity_imap_fetch: bad host name {host:?}: {e}"))?;

    let addr = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("activity_imap_fetch: resolving {host}: {e}"))?
        .next()
        .ok_or_else(|| AppError::Internal {
            detail: format!("activity_imap_fetch: no address for {host}"),
        })?;
    let tcp = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(15))
        .map_err(|e| format!("activity_imap_fetch: connect {host}:{port} failed: {e}"))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))
        .map_err(|e| format!("activity_imap_fetch: set timeout: {e}"))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))
        .map_err(|e| format!("activity_imap_fetch: set timeout: {e}"))?;
    let tls_client = rustls::ClientConnection::new(std::sync::Arc::new(tls_config), server_name)
        .map_err(|e| format!("activity_imap_fetch: TLS setup for {host} failed: {e}"))?;
    let conn = rustls::StreamOwned::new(tls_client, tcp);

    let mut client = imap::Client::new(conn);
    client
        .read_greeting()
        .map_err(|e| format!("activity_imap_fetch: greeting from {host} failed: {e}"))?;
    let mut session = client
        .login(&args.username, &args.password)
        .map_err(|(e, _)| format!("activity_imap_fetch: login to {host} failed: {e}"))?;

    let result = (|| -> Result<Vec<ImapMessage>, AppError> {
        session
            .examine(&folder)
            .map_err(|e| format!("activity_imap_fetch: examine {folder} failed: {e}"))?;
        let mut uids: Vec<u32> = session
            .uid_search(format!("SINCE {}", imap_since_date(args.since_ms)))
            .map_err(|e| format!("activity_imap_fetch: search failed: {e}"))?
            .into_iter()
            .collect();
        uids.sort_unstable();
        if uids.len() > max {
            uids = uids.split_off(uids.len() - max); // newest by ascending UID
        }
        if uids.is_empty() {
            return Ok(Vec::new());
        }
        let set = uids.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let fetches = session
            .uid_fetch(set, "(UID ENVELOPE INTERNALDATE BODY.PEEK[TEXT]<0.2048>)")
            .map_err(|e| format!("activity_imap_fetch: fetch failed: {e}"))?;
        let mut out = Vec::with_capacity(fetches.len());
        for f in fetches.iter() {
            // INTERNALDATE is the timeline anchor; a message without one is unusable here.
            let Some(date_ms) = f.internal_date().map(|d| d.timestamp_millis()) else {
                continue;
            };
            let env = f.envelope();
            out.push(ImapMessage {
                uid: f.uid.unwrap_or(0),
                message_id: lossy(env.and_then(|e| e.message_id)),
                subject: lossy(env.and_then(|e| e.subject)),
                from: env.and_then(|e| e.from.as_ref()).and_then(format_addrs),
                to: env.and_then(|e| e.to.as_ref()).and_then(format_addrs),
                date_ms,
                snippet: text_snippet(f.text()),
            });
        }
        Ok(out)
    })();

    // Best-effort logout — errors after a successful fetch are not worth failing on.
    let _ = session.logout();
    result
}

fn with_conn<T>(vault_root: &str, f: impl FnOnce(&Connection) -> T) -> Result<T, AppError> {
    let shared = db::conn(vault_root)?;
    let guard = shared.lock().map_err(|_| AppError::Internal {
        detail: "activity db lock poisoned".into(),
    })?;
    Ok(f(&guard))
}

fn with_conn_mut<T>(vault_root: &str, f: impl FnOnce(&mut Connection) -> T) -> Result<T, AppError> {
    let shared = db::conn(vault_root)?;
    let mut guard = shared.lock().map_err(|_| AppError::Internal {
        detail: "activity db lock poisoned".into(),
    })?;
    Ok(f(&mut guard))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn activity_push_events(
    vault_root: String,
    collector_id: String,
    declared_types: Option<Vec<String>>,
    events: Vec<ActivityEventIn>,
) -> Result<PushOutcome, AppError> {
    let declared = declared_types.as_deref();
    with_conn_mut(&vault_root, |conn| {
        ingest::push_events(conn, &collector_id, declared, &events)
    })
}

#[tauri::command]
pub fn activity_get_cursor(vault_root: String, collector_id: String) -> Result<Option<String>, AppError> {
    with_conn(&vault_root, |conn| ingest::get_cursor(conn, &collector_id))
}

#[tauri::command]
pub fn activity_set_cursor(vault_root: String, collector_id: String, cursor: String) -> Result<(), AppError> {
    with_conn(&vault_root, |conn| ingest::set_cursor(conn, &collector_id, &cursor))
}

#[tauri::command]
pub fn activity_list_events(
    vault_root: String,
    from: Option<i64>,
    to: Option<i64>,
    types: Option<Vec<String>>,
    source: Option<String>,
    actor_entity_id: Option<String>,
    limit: Option<i64>,
    sources: Option<Vec<String>>,
) -> Result<Vec<EventRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::list_events(
            conn,
            from,
            to,
            types.as_deref(),
            source.as_deref(),
            actor_entity_id.as_deref(),
            limit,
            sources.as_deref(),
        )
    })
}

/// `sources`: include-list of collector ids (None = no filtering; Some(empty)
/// = match nothing). Disabled collectors hide their already-collected content.
#[tauri::command]
pub fn activity_aggregate_metrics(
    vault_root: String,
    from: Option<i64>,
    to: Option<i64>,
    sources: Option<Vec<String>>,
) -> Result<Vec<MetricRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::aggregate_metrics(conn, from, to, sources.as_deref())
    })
}

#[tauri::command]
pub fn activity_list_entities(
    vault_root: String,
    entity_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<EntityRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::list_entities(conn, entity_type.as_deref(), limit)
    })
}

#[tauri::command]
pub fn activity_get_entity(vault_root: String, id: String) -> Result<Option<EntityRow>, AppError> {
    with_conn(&vault_root, |conn| query::get_entity(conn, &id))
}

/// `sources` semantics as on `activity_aggregate_metrics`. `from`/`to`
/// (epoch ms) bound the relations the same way the timeline bounds events.
#[tauri::command]
pub fn activity_get_entity_neighbors(
    vault_root: String,
    entity_id: String,
    sources: Option<Vec<String>>,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<Vec<NeighborRow>, AppError> {
    with_conn(&vault_root, |conn| {
        query::get_entity_neighbors(conn, &entity_id, now_ms(), sources.as_deref(), from, to)
    })
}

/// `sources` semantics as on `activity_aggregate_metrics`.
#[tauri::command]
pub fn activity_daily_digest_input(
    vault_root: String,
    date: String,
    sources: Option<Vec<String>>,
) -> Result<Option<DigestInput>, AppError> {
    with_conn(&vault_root, |conn| {
        query::daily_digest_input(conn, &date, sources.as_deref())
    })
}

#[tauri::command]
pub fn activity_get_event_summary(vault_root: String, event_id: String) -> Result<Option<String>, AppError> {
    with_conn(&vault_root, |conn| query::get_event_summary(conn, &event_id))
}

#[tauri::command]
pub fn activity_set_event_summary(
    vault_root: String,
    event_id: String,
    summary: String,
) -> Result<bool, AppError> {
    with_conn(&vault_root, |conn| {
        query::set_event_summary(conn, &event_id, &summary)
    })
}

/// Append one collect-run history record (采集记录) — see `runs.rs`.
#[tauri::command]
pub fn activity_insert_collect_run(
    vault_root: String,
    run: runs::CollectRunIn,
) -> Result<(), AppError> {
    with_conn_mut(&vault_root, |conn| runs::insert_collect_run(conn, &run))?
}

/// All collect-run records (≤ 100), newest-first.
#[tauri::command]
pub fn activity_list_collect_runs(vault_root: String) -> Result<Vec<runs::CollectRunRow>, AppError> {
    with_conn(&vault_root, runs::list_collect_runs)
}

#[cfg(test)]
mod read_text_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn tmp() -> (TempDir, String) {
        let t = TempDir::new().unwrap();
        let root = t.path().to_string_lossy().into_owned();
        (t, root)
    }

    #[test]
    fn reads_file_content() {
        let (t, root) = tmp();
        fs::write(t.path().join("a.md"), "hello\nworld").unwrap();
        assert_eq!(
            activity_read_text_file(root, "a.md".into(), None),
            Some("hello\nworld".into())
        );
    }

    #[test]
    fn truncates_at_cap() {
        let (t, root) = tmp();
        fs::write(t.path().join("a.md"), "abcdefghij").unwrap();
        assert_eq!(
            activity_read_text_file(root.clone(), "a.md".into(), Some(4)),
            Some("abcd".into())
        );
        // Cap is clamped to at least 1, never 0.
        assert_eq!(
            activity_read_text_file(root, "a.md".into(), Some(0)),
            Some("a".into())
        );
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let (t, root) = tmp();
        fs::write(t.path().join("a.md"), "x").unwrap();
        assert_eq!(activity_read_text_file(root.clone(), "../a.md".into(), None), None);
        assert_eq!(activity_read_text_file(root.clone(), "notes/../../a.md".into(), None), None);
        assert_eq!(activity_read_text_file(root.clone(), "/etc/hosts".into(), None), None);
        // Missing file → None, not an error.
        assert_eq!(activity_read_text_file(root, "nope.md".into(), None), None);
    }

    #[test]
    fn nul_byte_is_binary_none() {
        let (t, root) = tmp();
        fs::write(t.path().join("bin.dat"), b"ab\x00cd").unwrap();
        assert_eq!(activity_read_text_file(root, "bin.dat".into(), None), None);
    }

    #[test]
    fn oversized_file_is_none() {
        let (t, root) = tmp();
        let big = vec![b'a'; 1_048_577];
        fs::write(t.path().join("big.md"), &big).unwrap();
        assert_eq!(activity_read_text_file(root, "big.md".into(), None), None);
    }
}

#[cfg(test)]
mod exe_stem_tests {
    use super::*;

    #[test]
    fn strips_last_component_and_extension() {
        assert_eq!(exe_stem(r"C:\Program Files\Code.exe"), "Code");
        assert_eq!(exe_stem(r"C:\apps\foo.bar\Weird.Sig.exe"), "Weird.Sig");
        assert_eq!(exe_stem("/usr/bin/code"), "code");
        assert_eq!(exe_stem("Code.exe"), "Code");
        assert_eq!(exe_stem("noext"), "noext");
    }

    #[test]
    fn edge_cases() {
        assert_eq!(exe_stem(r"C:\dir\.hidden"), ".hidden");
        assert_eq!(exe_stem("."), ".");
        assert_eq!(exe_stem(""), "");
    }
}

#[cfg(test)]
mod imap_tests {
    use super::*;

    #[test]
    fn since_date_formats_with_day_slack() {
        // 2026-09-28T00:00:00Z → one day back → 27-Sep-2026.
        assert_eq!(imap_since_date(1_790_553_600_000), "27-Sep-2026");
        // Pre-epoch input stays valid (no panic), just lands before the epoch.
        assert_eq!(imap_since_date(-100), "31-Dec-1969");
    }

    #[test]
    fn mailbox_quoting() {
        assert_eq!(quote_mailbox("INBOX").unwrap(), "INBOX");
        assert_eq!(quote_mailbox("Sent Items").unwrap(), "\"Sent Items\"");
        assert_eq!(quote_mailbox("we\"ird").unwrap(), "\"we\\\"ird\"");
        assert!(quote_mailbox("a\\b").is_ok()); // backslash gets escaped, not rejected
        assert_eq!(quote_mailbox("a\\b").unwrap(), "\"a\\\\b\"");
        assert!(quote_mailbox("中文").is_err()); // non-ASCII rejected (needs IMAP-UTF7)
        assert!(quote_mailbox("bad\nname").is_err()); // control chars rejected
        assert!(quote_mailbox("").is_err());
    }

    #[test]
    fn snippet_sniffs_printable_text() {
        let text = b"hello world\nsecond line".as_slice();
        assert_eq!(text_snippet(Some(text)).as_deref(), Some("hello world\nsecond line"));
        // base64-wrapped body → dropped, not garbled.
        let b64 = b"SGVsbG8gd29ybGQgZnJvbSB0aGUgZW1haWwgY29sbGVjdG9y\nSGVsbG8gd29ybGQgZnJvbSB0aGUgZW1haWwgY29sbGVjdG9y";
        assert_eq!(text_snippet(Some(b64.as_slice())), None);
        assert_eq!(text_snippet(None), None);
        assert_eq!(text_snippet(Some(b"")), None);
    }

    #[test]
    fn host_validation() {
        assert!(valid_host("imap.qq.com"));
        assert!(!valid_host(""));
        assert!(!valid_host("imap.qq.com rm -rf"));
        assert!(!valid_host("bad\nhost"));
    }
}

#[cfg(test)]
mod scan_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn scan_walks_recursively_and_applies_excludes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::write(root.join("notes/sub/b.md"), "yyy").unwrap();
        // .git always skipped.
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref").unwrap();
        // Excluded by basename and by relative path; blank entries ignored.
        fs::create_dir_all(root.join("junk")).unwrap();
        fs::write(root.join("junk/c.md"), "x").unwrap();
        fs::create_dir_all(root.join("notes/secret")).unwrap();
        fs::write(root.join("notes/secret/d.md"), "x").unwrap();

        let entries = activity_scan_vault(
            root.to_string_lossy().into_owned(),
            vec!["junk".into(), "notes/secret".into(), "  ".into(), String::new()],
            vec![],
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "notes/sub/b.md"]);
        assert!(entries.iter().all(|e| e.size > 0 && e.mtime_ms > 0));
    }

    #[test]
    fn scan_applies_exclude_patterns() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("app.log"), "x").unwrap();
        fs::create_dir_all(root.join("notes/sub")).unwrap();
        fs::write(root.join("notes/debug.log"), "x").unwrap();
        // Segment pattern prunes the whole nested dir.
        fs::create_dir_all(root.join("notes/__wiki__/deep")).unwrap();
        fs::write(root.join("notes/__wiki__/deep/b.md"), "x").unwrap();
        // Exact file-name segment pattern.
        fs::write(root.join("notes/secret.md"), "x").unwrap();
        // `?` wildcard: one char.
        fs::write(root.join("notes/draft-1.md"), "x").unwrap();

        let entries = activity_scan_vault(
            root.to_string_lossy().into_owned(),
            vec![],
            vec![
                "*.log".into(),
                "__wiki__".into(),
                "secret.md".into(),
                "draft-?.md".into(),
            ],
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md"]);
    }

    #[test]
    fn scan_non_directory_is_an_error() {
        let err =
            activity_scan_vault("/definitely/not/a/dir".into(), vec![], vec![]).unwrap_err();
        assert!(err.to_string().contains("not a directory"));
    }
}
