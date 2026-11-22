//! `net:*` on behalf of trusted extensions (`api.network.connect`): a TLS
//! connection to a host the extension declares, for protocols that are not
//! HTTP (IMAP, SMTP, …). The extension speaks the protocol; the host only
//! moves bytes.
//!
//! Which hosts is the extension's own declaration —
//! `permissions.net.hosts` (`"imap.gmail.com:993"`, or `"*:993"` for any host
//! on that port — a mail client reaching whatever server the user names),
//! listed in the consent dialog. JS fast-fails; `extension_net_connect` re-checks the on-disk
//! manifest. TLS only: certificates are verified against the Mozilla roots,
//! and the name verified is the declared host.
//!
//! A connection is a reader task that pushes received bytes to the extension
//! over an IPC channel, plus a write half kept here under an id. Closing (by
//! either side) ends the reader and drops the socket.

use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt, WriteHalf};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::{self, pki_types::ServerName};
use tokio_rustls::TlsConnector;

use crate::errors::AppError;
use crate::extension_commands::{extensions_dir, is_valid_extension_id};

/// Bound on connect + TLS handshake.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Most open connections one extension may hold at once.
const MAX_CONNECTIONS_PER_EXTENSION: usize = 8;

type Writer = WriteHalf<TlsStream<TcpStream>>;

struct Connection {
    extension_id: String,
    writer: Mutex<Writer>,
    /// Aborts the reader task (which owns the read half) on close.
    reader: tokio::task::AbortHandle,
}

/// Open connections, by id. Managed by Tauri.
#[derive(Default)]
pub struct NetConnections {
    next_id: AtomicU64,
    open: Mutex<HashMap<u64, Arc<Connection>>>,
}

/// What the reader task sends the extension. `data` is base64.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NetEvent {
    Data {
        data: String,
    },
    /// The peer closed, the read failed, or the connection was closed here.
    /// Always the last message.
    Closed {
        error: Option<String>,
    },
}

/// Open a TLS connection to `host:port`. Returns the connection id; received
/// bytes arrive on `on_event`.
#[tauri::command]
pub async fn extension_net_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, NetConnections>,
    extension_id: String,
    host: String,
    port: u16,
    on_event: tauri::ipc::Channel<NetEvent>,
) -> Result<u64, AppError> {
    let manifest = read_manifest(&app, &extension_id)?;
    check_net_host(&manifest, &host, port)?;
    {
        let open = state.open.lock().await;
        let held = open
            .values()
            .filter(|c| c.extension_id == extension_id)
            .count();
        if held >= MAX_CONNECTIONS_PER_EXTENSION {
            return Err(format!(
                "net:connect denied: {extension_id} already holds {held} connections"
            )
            .into());
        }
    }

    let stream = tokio::time::timeout(CONNECT_TIMEOUT, tls_connect(&host, port))
        .await
        .map_err(|_| format!("net:connect to {host}:{port} timed out"))??;
    let (mut read_half, write_half) = tokio::io::split(stream);

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let reader_events = on_event.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; 16 * 1024];
        let error = loop {
            match read_half.read(&mut buf).await {
                Ok(0) => break None,
                Ok(n) => {
                    let data = STANDARD.encode(&buf[..n]);
                    if reader_events.send(NetEvent::Data { data }).is_err() {
                        break None; // the page is gone
                    }
                }
                Err(e) => break Some(e.to_string()),
            }
        };
        let _ = reader_events.send(NetEvent::Closed { error });
    });
    let connection = Arc::new(Connection {
        extension_id: extension_id.clone(),
        writer: Mutex::new(write_half),
        reader: reader.inner().abort_handle(),
    });
    state.open.lock().await.insert(id, connection);
    Ok(id)
}

/// Send bytes (base64) on a connection this extension opened.
#[tauri::command]
pub async fn extension_net_write(
    state: tauri::State<'_, NetConnections>,
    extension_id: String,
    id: u64,
    data: String,
) -> Result<(), AppError> {
    let connection = owned(&state, &extension_id, id).await?;
    let bytes = STANDARD
        .decode(data)
        .map_err(|e| format!("net:write: data is not base64: {e}"))?;
    let mut writer = connection.writer.lock().await;
    writer
        .write_all(&bytes)
        .await
        .map_err(|e| format!("net:write failed: {e}"))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("net:write flush failed: {e}"))?;
    Ok(())
}

/// Close a connection this extension opened. Closing twice is a no-op.
#[tauri::command]
pub async fn extension_net_close(
    state: tauri::State<'_, NetConnections>,
    extension_id: String,
    id: u64,
) -> Result<(), AppError> {
    let removed = {
        let mut open = state.open.lock().await;
        match open.get(&id) {
            Some(c) if c.extension_id == extension_id => open.remove(&id),
            _ => None,
        }
    };
    if let Some(connection) = removed {
        let _ = connection.writer.lock().await.shutdown().await;
        connection.reader.abort();
    }
    Ok(())
}

async fn owned(
    state: &NetConnections,
    extension_id: &str,
    id: u64,
) -> Result<Arc<Connection>, AppError> {
    let open = state.open.lock().await;
    match open.get(&id) {
        Some(c) if c.extension_id == extension_id => Ok(Arc::clone(c)),
        _ => Err(format!("net: no open connection {id} for {extension_id}").into()),
    }
}

async fn tls_connect(host: &str, port: u16) -> Result<TlsStream<TcpStream>, AppError> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e| format!("net:connect: bad host name {host:?}: {e}"))?;
    let tcp = TcpStream::connect((host, port))
        .await
        .map_err(|e| format!("net:connect to {host}:{port} failed: {e}"))?;
    TlsConnector::from(Arc::new(config))
        .connect(server_name, tcp)
        .await
        .map_err(|e| format!("net:connect: TLS with {host} failed: {e}").into())
}

fn read_manifest(
    app: &tauri::AppHandle,
    extension_id: &str,
) -> Result<serde_json::Value, AppError> {
    // A bare id segment, so the read cannot leave the extensions dir and
    // borrow another extension's declaration.
    if !is_valid_extension_id(extension_id) {
        return Err(format!("net:connect denied: invalid extension id: {extension_id}").into());
    }
    let path = extensions_dir(app)?
        .join(extension_id)
        .join("manifest.json");
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read manifest for {extension_id}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| AppError::from(e.to_string()))
}

/// Trusted tier only, and `host:port` must be listed in
/// `permissions.net.hosts` (host compared case-insensitively), or the port
/// declared for any host as `*:port`. Pure.
fn check_net_host(manifest: &serde_json::Value, host: &str, port: u16) -> Result<(), String> {
    if manifest["tier"].as_str() != Some("trusted") {
        return Err("net:connect denied: trusted tier only".to_string());
    }
    let wanted = format!("{}:{port}", host.to_ascii_lowercase());
    let any_host = format!("*:{port}");
    let declared = manifest["permissions"]["net"]["hosts"]
        .as_array()
        .ok_or_else(|| "net:connect denied: no net.hosts declared".to_string())?;
    if !declared
        .iter()
        .filter_map(|v| v.as_str())
        .map(|h| h.to_ascii_lowercase())
        .any(|h| h == wanted || h == any_host)
    {
        return Err(format!(
            "net:connect denied: {host}:{port} not in net.hosts"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(hosts: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "tier": "trusted", "permissions": { "net": { "hosts": hosts } } })
    }

    #[test]
    fn allows_a_declared_host_and_port() {
        let m = manifest(serde_json::json!(["imap.gmail.com:993", "IMAP.QQ.com:993"]));
        assert!(check_net_host(&m, "imap.gmail.com", 993).is_ok());
        assert!(check_net_host(&m, "imap.qq.com", 993).is_ok());
        assert!(check_net_host(&m, "IMAP.GMAIL.COM", 993).is_ok());
    }

    #[test]
    fn denies_another_port_or_host() {
        let m = manifest(serde_json::json!(["imap.gmail.com:993"]));
        assert!(check_net_host(&m, "imap.gmail.com", 143).is_err());
        assert!(check_net_host(&m, "smtp.gmail.com", 993).is_err());
        assert!(check_net_host(&m, "imap.gmail.com.evil.com", 993).is_err());
    }

    #[test]
    fn a_port_wildcard_allows_any_host_on_that_port_only() {
        let m = manifest(serde_json::json!(["*:993"]));
        assert!(check_net_host(&m, "imap.example.org", 993).is_ok());
        assert!(check_net_host(&m, "imap.example.org", 143).is_err());
        assert!(check_net_host(&manifest(serde_json::json!(["*"])), "a.com", 993).is_err());
    }

    #[test]
    fn denies_without_a_declaration_or_on_the_sandbox_tier() {
        assert!(check_net_host(&serde_json::json!({ "tier": "trusted" }), "a.com", 993).is_err());
        assert!(check_net_host(&manifest(serde_json::json!("a.com:993")), "a.com", 993).is_err());
        let sandbox = serde_json::json!({ "tier": "sandbox", "permissions": { "net": { "hosts": ["a.com:993"] } } });
        assert!(check_net_host(&sandbox, "a.com", 993).is_err());
    }
}
