//! Plugin trust-boundary primitives: integrity hashing, optional Ed25519
//! signature verification, manifest validation, zip-slip / zip-bomb defenses,
//! and sandbox http:fetch origin checks.
//!
//! Extracted from `plugin_commands.rs` so the security-sensitive code lives
//! apart from install / URI-scheme / RPC business logic. Pure functions where
//! possible — no `AppHandle`, no I/O except `compute_integrity` (reads plugin
//! dir) and `extract_zip_filtered` (reads/writes staging).

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::errors::AppError;

/// Per-file size cap. A single entry larger than this hard-fails the install.
const ZIP_MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
/// Total uncompressed size cap across all entries (zip-bomb defense).
const ZIP_MAX_TOTAL_SIZE: u64 = 100 * 1024 * 1024;
/// Max number of file entries in a zip (zip-bomb defense).
const ZIP_MAX_FILE_COUNT: usize = 1000;

/// Extension whitelist for compiled-only zip install. Anything outside this
/// set is soft-skipped (not copied to staging). `manifest.json`, `LICENSE`,
/// and `README.md` are matched by basename regardless of extension.
const ALLOWED_EXTS: &[&str] = &[
    "html", "htm", "js", "mjs", "css", "svg", "png", "jpg", "jpeg", "gif", "ico", "woff",
    "woff2", "ttf", "wasm", "json", "md",
];

/// Path-component blacklist. The first component of an entry's relative path
/// matching any of these → hard-fail (source dir, dev tooling, venv, etc.).
const BLACKLIST_TOP_DIRS: &[&str] = &[
    "src",
    "node_modules",
    ".git",
    ".vscode",
    ".idea",
];

/// Basename blacklist. Files named exactly this (case-sensitive) anywhere in
/// the zip → hard-fail. Lockfiles + build configs that don't belong in a
/// shipped plugin package.
const BLACKLIST_BASENAMES_EXACT: &[&str] = &[
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "tsconfig.json",
    ".DS_Store",
    "Thumbs.db",
];

/// Basename prefix blacklist. Files whose basename starts with any of these
/// → hard-fail (`vite.config.*`, `webpack.config.*`, `rollup.config.*`,
/// `.env.*` to catch `.env.local` / `.env.production` etc.).
const BLACKLIST_BASENAME_PREFIXES: &[&str] = &[
    "vite.config.",
    "webpack.config.",
    "rollup.config.",
    ".env",
];

/// Extension blacklist. Files with these extensions anywhere in the zip →
/// hard-fail (TypeScript sources, sourcemaps, env files).
const BLACKLIST_EXTS: &[&str] = &["ts", "tsx", "jsx", "env", "map"];

// ── Integrity (TOFU gate) ────────────────────────────────────────────────────

/// Compute the SHA-256 hex digest of `bytes`. Pure — no I/O.
pub fn compute_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let result = hasher.finalize();
    // Format as lowercase hex.
    let mut out = String::with_capacity(64);
    for b in result {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// Walk `plugin_dir` recursively and return a map of relative-path → SHA-256
/// hex for every regular file. Relative paths use forward slashes. The
/// `plugins.json` file itself (if present in the dir) is skipped — it is not
/// plugin code and would self-reference.
pub fn compute_integrity(plugin_dir: &Path) -> Result<HashMap<String, String>, String> {
    let mut out = HashMap::new();
    walk_and_hash(plugin_dir, plugin_dir, &mut out)?;
    Ok(out)
}

fn walk_and_hash(
    base: &Path,
    current: &Path,
    out: &mut HashMap<String, String>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            // ponytail: skip node_modules — trusted bundles are self-contained
            // (no runtime imports), and pnpm's symlinked node_modules would
            // waste time hashing thousands of irrelevant files.
            if entry.file_name() == "node_modules" {
                continue;
            }
            walk_and_hash(base, &path, out)?;
        } else if ft.is_file() {
            let rel = path
                .strip_prefix(base)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            // Skip the on-disk registry — it's metadata, not plugin code.
            if rel == "plugins.json" {
                continue;
            }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            out.insert(rel, compute_hash(&bytes));
        }
    }
    Ok(())
}

/// Pure trust-gate check: does every path in `stored` match the corresponding
/// hash in `actual`? Returns `false` if any stored entry is missing from
/// `actual` or has a different hash. Extra entries in `actual` are ignored
/// (new files appearing post-install don't invalidate trust — but the loader
/// only verifies `main` in practice; this is the full-set verification used by
/// Rust-side diagnostics).
#[allow(dead_code)]
pub fn verify_integrity(
    stored: &HashMap<String, String>,
    actual: &HashMap<String, String>,
) -> bool {
    for (path, stored_hash) in stored {
        match actual.get(path) {
            Some(actual_hash) if actual_hash == stored_hash => {}
            _ => return false,
        }
    }
    true
}

// ── Ed25519 signature verification (PR4 scaffolding) ────────────────────────
//
// MVP INTEGRITY MODEL: SHA-256 per-file integrity (computed at install, verified
// on load by the trusted loader) is the *gate*. Ed25519 signatures are OPTIONAL
// scaffolding: a plugin MAY carry `signature` + `publisherPublicKey` (base64)
// in its manifest/plugins.json. When present, `verify_plugin_signature` checks
// the signature over the canonicalized manifest. When absent, verification is a
// no-op (Ok(())). This lets a future marketplace require signatures without a
// breaking change — see `docs/plugin-development.md` "Integrity upgrade path".
//
// The signature is over the canonicalized manifest JSON (serde_json with sorted
// keys, no whitespace) — NOT over individual files. Per-file integrity is
// already covered by SHA-256; the signature proves *publisher identity + manifest
// authorship*, not byte-for-byte file integrity (a signed manifest with tampered
// files still fails the SHA-256 check at load).

/// Decode a standard base64 string into bytes. Returns `Err` on malformed input.
pub fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| format!("invalid base64: {e}"))
}

/// Canonicalize a manifest JSON value for signing: serialize with sorted keys
/// and no whitespace. The same input always produces the same bytes, so a
/// publisher can sign the canonical form and any host can re-derive it.
pub fn canonicalize_manifest(manifest: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(manifest).map_err(|e| format!("manifest canonicalize failed: {e}"))
}

/// Verify an optional ed25519 signature over the canonicalized manifest.
///
/// Returns `Ok(())` when:
///   - `signature` is `None` (MVP: signatures not required; SHA-256 is the gate)
///   - `signature` + `public_key` are both present AND verify against the
///     canonicalized manifest bytes
///
/// Returns `Err` when:
///   - only one of `signature` / `public_key` is present (incomplete)
///   - the signature is malformed, the key is malformed, or verification fails
///
/// This is a pure function — no I/O, no app handle — so it is unit-testable
/// without a running Tauri instance.
pub fn verify_plugin_signature(
    manifest: &serde_json::Value,
    signature: Option<&str>,
    public_key: Option<&str>,
) -> Result<(), String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey, PUBLIC_KEY_LENGTH};

    let (sig, key) = match (signature, public_key) {
        (None, None) => return Ok(()), // MVP: no signature = no check
        (None, Some(_)) => {
            return Err("publisherPublicKey present but signature missing".into());
        }
        (Some(_), None) => {
            return Err("signature present but publisherPublicKey missing".into());
        }
        (Some(s), Some(k)) => (s, k),
    };

    let sig_bytes = decode_base64(sig)?;
    let key_bytes = decode_base64(key)?;
    if sig_bytes.len() != ed25519_dalek::SIGNATURE_LENGTH {
        return Err(format!(
            "signature must be {} bytes, got {}",
            ed25519_dalek::SIGNATURE_LENGTH,
            sig_bytes.len()
        ));
    }
    if key_bytes.len() != PUBLIC_KEY_LENGTH {
        return Err(format!(
            "public key must be {} bytes, got {}",
            PUBLIC_KEY_LENGTH,
            key_bytes.len()
        ));
    }

    let key_array: [u8; PUBLIC_KEY_LENGTH] = key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "public key length mismatch".to_string())?;
    let sig_array: [u8; ed25519_dalek::SIGNATURE_LENGTH] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "signature length mismatch".to_string())?;

    let verifying_key = VerifyingKey::from_bytes(&key_array)
        .map_err(|e| format!("invalid public key: {e}"))?;
    let signature = Signature::from_bytes(&sig_array);
    let message = canonicalize_manifest(manifest)?;

    verifying_key
        .verify(message.as_bytes(), &signature)
        .map(|_| ())
        .map_err(|e| format!("signature verification failed: {e}"))
}

// ── Manifest validation (pure) ───────────────────────────────────────────────

/// Validate a raw manifest JSON value. Checks the same invariants as the
/// TypeScript `PluginHost.validateManifest`: kebab-case id, version present,
/// tier ∈ {sandbox, trusted}, `main` present, sandbox requires `html`.
pub fn validate_manifest(manifest: &serde_json::Value) -> Result<(), String> {
    let id = manifest["id"]
        .as_str()
        .ok_or_else(|| "manifest.id is required and must be a string".to_string())?;
    if !is_kebab_case(id) {
        return Err(format!("manifest.id must be kebab-case, got: {id}"));
    }

    let version = manifest["version"]
        .as_str()
        .ok_or_else(|| "manifest.version is required".to_string())?;
    if version.is_empty() {
        return Err("manifest.version must not be empty".into());
    }

    let tier = manifest["tier"]
        .as_str()
        .ok_or_else(|| "manifest.tier is required".to_string())?;
    if tier != "sandbox" && tier != "trusted" {
        return Err(format!("manifest.tier must be 'sandbox' or 'trusted', got: {tier}"));
    }

    let main = manifest["main"]
        .as_str()
        .ok_or_else(|| "manifest.main is required".to_string())?;
    if main.is_empty() {
        return Err("manifest.main must not be empty".into());
    }

    if tier == "sandbox" {
        let html = manifest["html"]
            .as_str()
            .ok_or_else(|| "sandbox plugins require manifest.html".to_string())?;
        if html.is_empty() {
            return Err("sandbox plugins require manifest.html".into());
        }
    }

    Ok(())
}

fn is_kebab_case(s: &str) -> bool {
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return false;
    }
    // Must not start/end with '-', must have at least one hyphen-separated segment pair.
    // Matches the TS regex: ^[a-z0-9]+(-[a-z0-9]+)+$
    regex_lite(s)
}

/// Lightweight kebab-case check matching `^[a-z0-9]+(-[a-z0-9]+)+$` without
/// pulling in the `regex` crate.
fn regex_lite(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    // First segment: [a-z0-9]+
    let seg_start = i;
    while i < bytes.len() && (bytes[i].is_ascii_lowercase() || bytes[i].is_ascii_digit()) {
        i += 1;
    }
    if i == seg_start {
        return false;
    }
    // At least one (-[a-z0-9]+)+
    let mut got_hyphen_seg = false;
    while i < bytes.len() {
        if bytes[i] != b'-' {
            return false;
        }
        i += 1;
        let seg_start = i;
        while i < bytes.len() && (bytes[i].is_ascii_lowercase() || bytes[i].is_ascii_digit()) {
            i += 1;
        }
        if i == seg_start {
            return false; // '-' not followed by alnum
        }
        got_hyphen_seg = true;
    }
    got_hyphen_seg
}

/// Pure size/count check factored out for unit-testability without having
/// to write a real >50MB temp file. Returns `Err(message)` when the new
/// entry would exceed per-file, total, or count caps. ponytail: pure fn so
/// tests run in microseconds — the real path also short-circuits the same way.
fn check_size(uncompressed: u64, cumulative: u64, count: usize) -> Result<(), String> {
    if uncompressed > ZIP_MAX_FILE_SIZE {
        return Err(format!(
            "zip entry uncompressed size {uncompressed} exceeds per-file limit {ZIP_MAX_FILE_SIZE}"
        ));
    }
    if cumulative + uncompressed > ZIP_MAX_TOTAL_SIZE {
        return Err(format!(
            "zip total uncompressed size would exceed limit {ZIP_MAX_TOTAL_SIZE}"
        ));
    }
    if count > ZIP_MAX_FILE_COUNT {
        return Err(format!(
            "zip entry count {count} exceeds limit {ZIP_MAX_FILE_COUNT}"
        ));
    }
    Ok(())
}

/// Is `rel` (path relative to the zip root) a forbidden file that should
/// hard-fail the install? Checks: top dir ∈ BLACKLIST_TOP_DIRS; basename ∈
/// BLACKLIST_BASENAMES_EXACT; basename starts with BLACKLIST_BASENAME_PREFIXES;
/// extension ∈ BLACKLIST_EXTS. Pure — no I/O.
fn is_blacklisted_path(rel: &Path) -> bool {
    // First path component (`src`, `node_modules`, ...).
    if let Some(top) = rel.components().next() {
        if let std::path::Component::Normal(s) = top {
            if let Some(name) = s.to_str() {
                if BLACKLIST_TOP_DIRS.contains(&name) {
                    return true;
                }
            }
        }
    }
    let basename = rel.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if BLACKLIST_BASENAMES_EXACT.contains(&basename) {
        return true;
    }
    if BLACKLIST_BASENAME_PREFIXES.iter().any(|p| basename.starts_with(p)) {
        return true;
    }
    if let Some(ext) = rel.extension().and_then(|s| s.to_str()) {
        if BLACKLIST_EXTS.contains(&ext) {
            return true;
        }
    }
    false
}

/// Should this entry be soft-skipped (extension outside the whitelist)?
/// `manifest.json`, `LICENSE`, `README.md` are always allowed by basename.
fn is_unknown_ext(rel: &Path) -> bool {
    let basename = rel.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if basename == "manifest.json" || basename == "LICENSE" || basename == "README.md" {
        return false;
    }
    match rel.extension().and_then(|s| s.to_str()) {
        Some(ext) => !ALLOWED_EXTS.contains(&ext),
        None => true, // no extension and not in the basename allowlist
    }
}

/// Reject zip-slip + symlink + Windows-drive entries. Returns `None` if the
/// name is unsafe; the caller collects it into `rejected_slip`.
///
/// We re-implement the `enclosed_name` normalisation by hand (strip leading
/// `/`, reject any `..` component or Windows `C:\`/`C:/` prefix) because in
/// `zip` 2.x it's a method on `ZipFile`, not a free function — and we want
/// to short-circuit before opening the file for read.
fn safe_zip_path(name: &str) -> Option<PathBuf> {
    if name.starts_with('/') {
        return None;
    }
    let bytes = name.as_bytes();
    if bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.get(2) == Some(&b'\\') || bytes.get(2) == Some(&b'/'))
    {
        return None;
    }
    let path = PathBuf::from(name);
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::Normal(s) => out.push(s),
            std::path::Component::CurDir => {} // `.`
            std::path::Component::ParentDir => return None, // `..`
            std::path::Component::RootDir => return None,   // leading `/`
            std::path::Component::Prefix(_) => return None, // Windows `C:`
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Extract a zip to `staging`, applying compiled-only filtering.
///
/// Returns `(rejected_slip, rejected_blacklist, skipped_unknown_ext)` — the
/// caller is responsible for surfacing these in the final error or install
/// result. Hard-fails (with cleanup by the caller) when a file exceeds the
/// size/count caps. The blacklist + slip checks are collected, not abort-
/// early, so the user sees ALL offenders in one error message.
pub(crate) fn extract_zip_filtered(zip_path: &Path, staging: &Path) -> Result<(Vec<String>, Vec<String>, Vec<String>), AppError> {
    let file = fs::File::open(zip_path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("failed to read zip: {e}"))?;

    let mut rejected_slip: Vec<String> = Vec::new();
    let mut rejected_blacklist: Vec<String> = Vec::new();
    let mut skipped_unknown_ext: Vec<String> = Vec::new();
    let mut total_uncompressed: u64 = 0;
    let mut count: usize = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry {i} read failed: {e}"))?;
        let raw_name = entry.name().to_string();
        // Symlink entries are a slip vector — reject them outright. `zip`
        // 2.x surfaces them as entries where `is_symlink()` returns true.
        if entry.is_symlink() {
            rejected_slip.push(raw_name.clone());
            continue;
        }
        let Some(rel) = safe_zip_path(&raw_name) else {
            rejected_slip.push(raw_name.clone());
            continue;
        };
        let uncompressed = entry.size();
        // Pure size/count check (factored out so tests cover the limits
        // without writing a real 50MB+ blob).
        if let Err(e) = check_size(uncompressed, total_uncompressed, count + 1) {
            return Err(format!("zip bomb defense tripped: {e}").into());
        }

        // Directory entry — create it; no file content to write.
        if entry.is_dir() {
            if is_blacklisted_path(&rel) {
                rejected_blacklist.push(raw_name.clone());
                continue;
            }
            // Don't bother soft-skipping empty unknown-extension dirs; the
            // files inside will be filtered individually.
            let target = staging.join(&rel);
            fs::create_dir_all(&target).map_err(|e| format!("mkdir failed for {raw_name}: {e}"))?;
            total_uncompressed += uncompressed;
            count += 1;
            continue;
        }

        // File entry.
        if is_blacklisted_path(&rel) {
            rejected_blacklist.push(raw_name.clone());
            // Still drain the entry so the archive cursor advances cleanly.
            // `enclosed_name` already validated the path — reading is safe.
            continue;
        }
        if is_unknown_ext(&rel) {
            skipped_unknown_ext.push(raw_name.clone());
            continue;
        }

        let target = staging.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed for {raw_name}: {e}"))?;
        }
        let mut out = fs::File::create(&target).map_err(|e| format!("create failed for {raw_name}: {e}"))?;
        // Limit the read to ZIP_MAX_FILE_SIZE bytes as defense-in-depth: even
        // though we checked `uncompressed_size()` above, a maliciously-crafted
        // archive could lie about its size in the central directory.
        let mut written: u64 = 0;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf).map_err(|e| format!("read failed for {raw_name}: {e}"))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > ZIP_MAX_FILE_SIZE {
                return Err(format!(
                    "zip entry {raw_name} exceeded per-file limit while extracting"
                ).into());
            }
            out.write_all(&buf[..n]).map_err(|e| format!("write failed for {raw_name}: {e}"))?;
        }
        total_uncompressed += uncompressed;
        count += 1;
    }

    Ok((rejected_slip, rejected_blacklist, skipped_unknown_ext))
}

/// Extract the origin (`scheme://host[:port]`) from a URL string.
///
/// `host` includes the port if present. The host is lowercased (RFC 3986 §3.2.2
/// says host is case-insensitive); scheme is lowercased too. Returns `None` for
/// malformed URLs or URLs without a host (e.g. `file:///...` has no host → the
/// sandbox http allowlist is origin-based, so hostless URLs are rejected).
pub fn extract_origin(url: &str) -> Option<String> {
    // Hand-rolled parser: `scheme://host[:port]/...` or `scheme://host[:port]?...`.
    // We avoid pulling the `url` crate (not currently a direct dep) for a tiny
    // parse. This mirrors the TS `extractOrigin` using `new URL()`.
    let scheme_end = url.find("://")?;
    let scheme = url[..scheme_end].to_ascii_lowercase();
    // Scheme must be non-empty and start with a letter (per RFC 3986).
    if scheme.is_empty()
        || !scheme
            .chars()
            .next()
            .map(|c| c.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        return None;
    }
    let rest = &url[scheme_end + 3..];
    // Authority runs until the first '/', '?', or '#'.
    let authority_end = rest
        .find(['/', '?', '#'])
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return None; // no host
    }
    // Strip userinfo (user:pass@) if present.
    let host_port = match authority.rfind('@') {
        Some(at) => &authority[at + 1..],
        None => authority,
    };
    if host_port.is_empty() {
        return None;
    }
    // Lowercase the host (and port — harmless for digits). Host is everything
    // up to the last colon that is NOT inside an IPv6 literal `[...]`. ASCII
    // lowercasing is safe for both reg-names and IPv6 hex digits/colons.
    let host_port_lower = host_port.to_ascii_lowercase();
    Some(format!("{scheme}://{host_port_lower}"))
}

/// Check whether a URL's origin is in the declared allowlist. Pure — no I/O.
///
/// Origins are compared as `scheme://host[:port]` (host lowercased). A
/// subdomain is NOT matched by a bare apex entry (e.g. `https://api.example.com`
/// does NOT match `https://example.com`) — exact origin match only, matching
/// the JS-side `isOriginAllowed` semantics.
pub fn is_origin_allowed(url: &str, allowed_origins: &[String]) -> bool {
    if allowed_origins.is_empty() {
        return false;
    }
    let Some(origin) = extract_origin(url) else {
        return false;
    };
    allowed_origins
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&origin))
}

/// Defense-in-depth origin check against a plugin manifest. Reads
/// `permissions.http.origins` from the manifest JSON value and calls
/// {@link is_origin_allowed}. Pure — no I/O, no app handle — so it is
/// unit-testable without a live reqwest or AppHandle.
pub fn check_http_origin(manifest: &serde_json::Value, url: &str) -> Result<(), String> {
    let origins = manifest["permissions"]["http"]["origins"]
        .as_array()
        .ok_or_else(|| "http:fetch denied: no http.origins declared".to_string())?;
    let allowed: Vec<String> = origins
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    if !is_origin_allowed(url, &allowed) {
        return Err(format!("http:fetch denied: origin not allowed: {url}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── validate_manifest ──

    #[test]
    fn manifest_valid_sandbox() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "name": "My Plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn manifest_valid_trusted() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "name": "My Plugin",
            "version": "1.0.0",
            "tier": "trusted",
            "main": "index.js",
        });
        assert!(validate_manifest(&m).is_ok());
    }

    #[test]
    fn manifest_rejects_bad_id() {
        let m = serde_json::json!({
            "id": "BadId",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_sandbox_without_html() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "main": "index.js",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_unknown_tier() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "wat",
            "main": "index.js",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }

    #[test]
    fn manifest_rejects_missing_main() {
        let m = serde_json::json!({
            "id": "my-plugin",
            "version": "1.0.0",
            "tier": "sandbox",
            "html": "index.html",
        });
        assert!(validate_manifest(&m).is_err());
    }


    // ── is_kebab_case ──

    #[test]
    fn kebab_valid() {
        assert!(is_kebab_case("my-plugin"));
        assert!(is_kebab_case("a-b-c"));
        assert!(is_kebab_case("pdf-tools-3"));
    }

    #[test]
    fn kebab_invalid() {
        assert!(!is_kebab_case("myplugin")); // no hyphen
        assert!(!is_kebab_case("My-Plugin")); // uppercase
        assert!(!is_kebab_case("-my-plugin")); // leading -
        assert!(!is_kebab_case("my-plugin-")); // trailing -
        assert!(!is_kebab_case("my--plugin")); // double hyphen
        assert!(!is_kebab_case(""));
    }


    // ── Integrity / TOFU gate ──

    #[test]
    fn compute_hash_is_stable_sha256_hex() {
        let h = compute_hash(b"hello");
        // Known SHA-256 of "hello"
        assert_eq!(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        assert_eq!(h.len(), 64);
    }

    #[test]
    fn compute_hash_empty_input() {
        let h = compute_hash(b"");
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn verify_integrity_matches_when_identical() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"console.log(1);"));
        stored.insert("style.css".into(), compute_hash(b"body{}"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"console.log(1);"));
        actual.insert("style.css".into(), compute_hash(b"body{}"));
        assert!(verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_rejects_mismatch() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"original"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"tampered"));
        assert!(!verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_rejects_missing_file() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"code"));
        let actual: HashMap<String, String> = HashMap::new();
        assert!(!verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_ignores_extra_files_in_actual() {
        let mut stored = HashMap::new();
        stored.insert("index.js".into(), compute_hash(b"code"));
        let mut actual = HashMap::new();
        actual.insert("index.js".into(), compute_hash(b"code"));
        actual.insert("extra.js".into(), compute_hash(b"new"));
        assert!(verify_integrity(&stored, &actual));
    }

    #[test]
    fn verify_integrity_empty_stored_is_true() {
        let stored: HashMap<String, String> = HashMap::new();
        let actual: HashMap<String, String> = HashMap::new();
        assert!(verify_integrity(&stored, &actual));
    }


    // ── decode_base64 ──

    #[test]
    fn decode_base64_valid() {
        let bytes = decode_base64("aGVsbG8=").unwrap(); // "hello"
        assert_eq!(bytes, b"hello");
    }

    #[test]
    fn decode_base64_rejects_malformed() {
        assert!(decode_base64("!!!not-base64!!!").is_err());
    }

    #[test]
    fn decode_base64_trims_whitespace() {
        let bytes = decode_base64("  aGVsbG8=  \n").unwrap();
        assert_eq!(bytes, b"hello");
    }


    // ── canonicalize_manifest ──

    #[test]
    fn canonicalize_manifest_is_stable() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "sandbox" });
        let a = canonicalize_manifest(&m).unwrap();
        let b = canonicalize_manifest(&m).unwrap();
        assert_eq!(a, b);
    }


    // ── verify_plugin_signature (ed25519 scaffolding) ──

    #[test]
    fn signature_absent_returns_ok() {
        // MVP: no signature = no check. SHA-256 integrity is the gate.
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, None, None).is_ok());
    }

    #[test]
    fn signature_without_key_is_err() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, Some("sig"), None).is_err());
        assert!(verify_plugin_signature(&m, None, Some("key")).is_err());
    }

    #[test]
    fn signature_malformed_base64_is_err() {
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        assert!(verify_plugin_signature(&m, Some("!!!bad-b64!!!"), Some("aGVsbG8=")).is_err());
    }

    #[test]
    fn signature_wrong_length_is_err() {
        use base64::Engine;
        let m = serde_json::json!({ "id": "x", "version": "1.0.0" });
        // 32-byte key but 1-byte signature — both wrong length.
        let key = base64::engine::general_purpose::STANDARD.encode([0u8; 32]);
        let sig = base64::engine::general_purpose::STANDARD.encode([0u8; 1]);
        assert!(verify_plugin_signature(&m, Some(&sig), Some(&key)).is_err());
    }

    #[test]
    fn signature_valid_key_invalid_signature_is_err() {
        // Valid-length key + valid-length signature, but the signature does not
        // actually verify against the canonicalized manifest (it's over the
        // wrong message).
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};
        use rand::rngs::OsRng;
        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        let key_bytes = verifying_key.to_bytes();
        // A signature over the WRONG message — should fail verification.
        let bad_sig = signing_key.sign(b"not the manifest");
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(bad_sig.to_bytes());
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key_bytes);
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "trusted" });
        assert!(verify_plugin_signature(&m, Some(&sig_b64), Some(&key_b64)).is_err());
    }

    #[test]
    fn signature_valid_verifies_ok() {
        // End-to-end: sign the canonicalized manifest with a real key, then
        // verify. Proves the scaffolding wiring is correct.
        use base64::Engine;
        use ed25519_dalek::{SigningKey, Signer};
        use rand::rngs::OsRng;
        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        let m = serde_json::json!({ "id": "x", "version": "1.0.0", "tier": "trusted" });
        let canonical = canonicalize_manifest(&m).unwrap();
        let sig = signing_key.sign(canonical.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(verifying_key.to_bytes());
        assert!(verify_plugin_signature(&m, Some(&sig_b64), Some(&key_b64)).is_ok());
    }


    // ── extract_origin / is_origin_allowed (sandbox http:fetch) ──

    #[test]
    fn extract_origin_https_host() {
        assert_eq!(
            extract_origin("https://api.example.com/data?q=1"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_with_port() {
        assert_eq!(
            extract_origin("http://localhost:3000/api"),
            Some("http://localhost:3000".into())
        );
    }

    #[test]
    fn extract_origin_strips_userinfo() {
        assert_eq!(
            extract_origin("https://user:pass@api.example.com/path"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_lowercases_host() {
        assert_eq!(
            extract_origin("https://API.Example.COM/Path"),
            Some("https://api.example.com".into())
        );
    }

    #[test]
    fn extract_origin_rejects_malformed() {
        assert!(extract_origin("not-a-url").is_none());
        assert!(extract_origin("://no-scheme").is_none());
        assert!(extract_origin("https://").is_none()); // no host
        assert!(extract_origin("file:///etc/passwd").is_none()); // hostless
    }

    #[test]
    fn is_origin_allowed_exact_match() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_case_insensitive_host() {
        let allow = vec!["https://API.Example.COM".to_string()];
        assert!(is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_different_origin() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(!is_origin_allowed("https://evil.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_subdomain_not_in_list() {
        // A bare apex entry does NOT match a subdomain — exact origin only.
        let allow = vec!["https://example.com".to_string()];
        assert!(!is_origin_allowed("https://api.example.com/data", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_port_mismatch() {
        let allow = vec!["http://localhost:3000".to_string()];
        assert!(!is_origin_allowed("http://localhost:8080/api", &allow));
    }

    #[test]
    fn is_origin_allowed_denies_malformed_url() {
        let allow = vec!["https://api.example.com".to_string()];
        assert!(!is_origin_allowed("not-a-url", &allow));
    }

    #[test]
    fn is_origin_allowed_empty_allowlist_denies() {
        assert!(!is_origin_allowed("https://api.example.com/data", &[]));
    }


    // ── check_http_origin (manifest defense-in-depth) ──

    #[test]
    fn check_http_origin_allows_declared_origin() {
        let m = serde_json::json!({
            "permissions": { "http": { "origins": ["https://api.example.com"] } }
        });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_ok());
    }

    #[test]
    fn check_http_origin_denies_undeclared_origin() {
        let m = serde_json::json!({
            "permissions": { "http": { "origins": ["https://api.example.com"] } }
        });
        assert!(check_http_origin(&m, "https://evil.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_no_http_permissions() {
        let m = serde_json::json!({ "permissions": { "fs": { "scope": ["data/**"] } } });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_origins_not_array() {
        let m = serde_json::json!({ "permissions": { "http": { "origins": "oops" } } });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }

    #[test]
    fn check_http_origin_denies_when_no_permissions_key() {
        let m = serde_json::json!({ "id": "x" });
        assert!(check_http_origin(&m, "https://api.example.com/x").is_err());
    }


    // ── install_plugin_zip: pure helpers ──

    #[test]
    fn check_size_accepts_within_limits() {
        assert!(check_size(0, 0, 0).is_ok());
        assert!(check_size(50 * 1024 * 1024, 0, 1).is_ok());
        assert!(check_size(1, 99 * 1024 * 1024, 999).is_ok());
    }

    #[test]
    fn check_size_rejects_per_file_limit() {
        let err = check_size(50 * 1024 * 1024 + 1, 0, 1).unwrap_err();
        assert!(err.contains("per-file limit"), "{err}");
    }

    #[test]
    fn check_size_rejects_total_limit() {
        let err = check_size(1, 100 * 1024 * 1024, 1).unwrap_err();
        assert!(err.contains("total uncompressed"), "{err}");
    }

    #[test]
    fn check_size_rejects_count_limit() {
        let err = check_size(1, 0, 1001).unwrap_err();
        assert!(err.contains("entry count"), "{err}");
    }

    #[test]
    fn is_blacklisted_path_catches_src_and_node_modules() {
        assert!(is_blacklisted_path(Path::new("src/index.ts")));
        assert!(is_blacklisted_path(Path::new("node_modules/react/index.js")));
        assert!(is_blacklisted_path(Path::new(".git/config")));
        assert!(is_blacklisted_path(Path::new(".vscode/settings.json")));
        assert!(is_blacklisted_path(Path::new(".idea/workspace.xml")));
    }

    #[test]
    fn is_blacklisted_path_catches_lockfiles_and_configs() {
        assert!(is_blacklisted_path(Path::new("package.json")));
        assert!(is_blacklisted_path(Path::new("package-lock.json")));
        assert!(is_blacklisted_path(Path::new("yarn.lock")));
        assert!(is_blacklisted_path(Path::new("pnpm-lock.yaml")));
        assert!(is_blacklisted_path(Path::new("tsconfig.json")));
        assert!(is_blacklisted_path(Path::new("vite.config.ts")));
        assert!(is_blacklisted_path(Path::new("webpack.config.js")));
        assert!(is_blacklisted_path(Path::new("rollup.config.mjs")));
    }

    #[test]
    fn is_blacklisted_path_catches_source_exts_and_dotfiles() {
        assert!(is_blacklisted_path(Path::new("dist/index.ts")));
        assert!(is_blacklisted_path(Path::new("comp/index.tsx")));
        assert!(is_blacklisted_path(Path::new("comp/thing.jsx")));
        assert!(is_blacklisted_path(Path::new(".env")));
        assert!(is_blacklisted_path(Path::new("dist/app.js.map")));
        assert!(is_blacklisted_path(Path::new(".DS_Store")));
        assert!(is_blacklisted_path(Path::new("Thumbs.db")));
    }

    #[test]
    fn is_blacklisted_path_allows_built_artifacts() {
        assert!(!is_blacklisted_path(Path::new("dist/index.js")));
        assert!(!is_blacklisted_path(Path::new("dist/index.mjs")));
        assert!(!is_blacklisted_path(Path::new("assets/style.css")));
        assert!(!is_blacklisted_path(Path::new("index.html")));
        assert!(!is_blacklisted_path(Path::new("manifest.json")));
        assert!(!is_blacklisted_path(Path::new("LICENSE")));
        assert!(!is_blacklisted_path(Path::new("README.md")));
        assert!(!is_blacklisted_path(Path::new("assets/icon.svg")));
    }

    #[test]
    fn is_unknown_ext_soft_skips_non_whitelisted() {
        assert!(is_unknown_ext(Path::new("data.bin")));
        assert!(is_unknown_ext(Path::new("assets/font.otf")));
        assert!(is_unknown_ext(Path::new("README.txt")));
        assert!(!is_unknown_ext(Path::new("dist/index.js")));
        assert!(!is_unknown_ext(Path::new("manifest.json")));
        assert!(!is_unknown_ext(Path::new("LICENSE")));
        assert!(!is_unknown_ext(Path::new("README.md")));
    }

    #[test]
    fn safe_zip_path_rejects_slip_vectors() {
        assert!(safe_zip_path("../escape.txt").is_none());
        assert!(safe_zip_path("../../etc/passwd").is_none());
        assert!(safe_zip_path("/etc/passwd").is_none());
        assert!(safe_zip_path("C:\\Windows\\System32\\config").is_none());
        assert!(safe_zip_path("C:/Windows/System32").is_none());
        assert!(safe_zip_path("dir/../escape.txt").is_none());
    }

    #[test]
    fn safe_zip_path_accepts_normal_relative() {
        assert_eq!(
            safe_zip_path("dist/index.js").unwrap(),
            PathBuf::from("dist/index.js")
        );
        assert_eq!(
            safe_zip_path("manifest.json").unwrap(),
            PathBuf::from("manifest.json")
        );
    }


    // ── install_plugin_zip: extract_zip_filtered end-to-end ──
    //
    // We build in-memory zips with `zip::ZipWriter` over a `Cursor<Vec<u8>>`,
    // write them to a temp file, and call `extract_zip_filtered` against a
    // tempdir staging dir. No AppHandle needed — `extract_zip_filtered` is
    // the post-validation core; the command wrapper only adds manifest
    // validation + registry I/O on top.

    use std::io::Cursor;

    /// Write a zip to a temp file and return its path. Caller owns the temp
    /// file (it's written under a `tempfile::TempDir`'s lifetime scope).
    fn write_zip_to_temp(entries: &[(String, Vec<u8>)]) -> (tempfile::TempDir, PathBuf) {
        use zip::ZipWriter;
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("plugin.zip");
        let file = std::fs::File::create(&path).expect("create zip file");
        let mut zip = ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(name, opts).expect("start_file");
            std::io::Write::write_all(&mut zip, bytes).expect("write bytes");
        }
        zip.finish().expect("finish zip");
        (dir, path)
    }

    fn manifest_json() -> Vec<u8> {
        b"{\"id\":\"test-plugin\",\"name\":\"T\",\"version\":\"1.0.0\",\"tier\":\"sandbox\",\"main\":\"index.html\",\"html\":\"index.html\"}"
            .to_vec()
    }

    #[test]
    fn test_zip_slip_rejected() {
        let (dir, zip_path) = write_zip_to_temp(&[
            ("../escape.txt".to_string(), b"evil".to_vec()),
            ("manifest.json".to_string(), manifest_json()),
        ]);
        let staging = dir.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let result = extract_zip_filtered(&zip_path, &staging);
        let (slip, blacklist, _skip) = result.expect("extract succeeds — slip is collected, not aborted");
        assert!(slip.iter().any(|s| s == "../escape.txt"), "slip list: {slip:?}");
        // The slip entry must NOT have been extracted.
        assert!(!staging.join("escape.txt").exists());
        assert!(!staging.join("../escape.txt").exists());
        assert!(blacklist.is_empty());
    }

    #[test]
    fn test_blacklist_hard_fail() {
        let (dir, zip_path) = write_zip_to_temp(&[
            ("src/index.ts".to_string(), b"console.log(1)".to_vec()),
            ("manifest.json".to_string(), manifest_json()),
        ]);
        let staging = dir.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let (_, blacklist, _) = extract_zip_filtered(&zip_path, &staging).expect("extract ok");
        assert!(
            blacklist.iter().any(|s| s == "src/index.ts"),
            "blacklist: {blacklist:?}"
        );
        // Blacklisted entry must not have been written.
        assert!(!staging.join("src/index.ts").exists());
    }

    #[test]
    fn test_unknown_ext_soft_skip() {
        let (dir, zip_path) = write_zip_to_temp(&[
            ("data.bin".to_string(), b"\x00\x01\x02".to_vec()),
            ("dist/index.js".to_string(), b"console.log(1);".to_vec()),
            ("manifest.json".to_string(), manifest_json()),
        ]);
        let staging = dir.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let (_, _, skipped) = extract_zip_filtered(&zip_path, &staging).expect("extract ok");
        assert!(
            skipped.iter().any(|s| s == "data.bin"),
            "skipped: {skipped:?}"
        );
        // Soft-skipped: not on disk.
        assert!(!staging.join("data.bin").exists());
        // Whitelisted: on disk.
        assert!(staging.join("dist/index.js").exists());
        assert!(staging.join("manifest.json").exists());
    }

    #[test]
    fn test_symlink_entry_rejected() {
        // Build a zip with a symlink entry via `ZipWriter::add_symlink`
        // (which sets the S_IFLNK bit in the central directory's external
        // attributes — `unix_permissions()` alone masks the upper bits
        // away, so it does NOT mark the entry as a symlink).
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("plugin.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default();
        zip.add_symlink("link.txt", "/etc/passwd", opts)
            .expect("add_symlink");
        // A normal entry too, so the archive is not just the symlink.
        zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut zip, &manifest_json()).unwrap();
        zip.finish().unwrap();

        let staging = dir.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        let (slip, _, _) = extract_zip_filtered(&zip_path, &staging).expect("extract ok");
        assert!(!slip.is_empty(), "expected symlink entry to be rejected; slip: {slip:?}");
        assert!(slip.iter().any(|s| s == "link.txt"), "slip: {slip:?}");
        // And it must not have been written to disk.
        assert!(!staging.join("link.txt").exists());
    }

}
