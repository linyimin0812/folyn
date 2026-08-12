use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{LazyLock, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::Emitter;

/// A live PTY-backed terminal session.
struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    shell_path: String,
}

/// Global registry of terminal sessions keyed by frontend-assigned id.
/// A global (rather than managed state) so `terminal_kill_all` can run from
/// the app-exit handler without an `AppHandle`.
static TERMINALS: LazyLock<Mutex<HashMap<String, TerminalSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Spawn a PTY-backed shell and start streaming its output to the frontend
/// via the `terminal-output` event (base64 payloads so arbitrary bytes round
/// trip intact). Returns the resolved shell path so the UI can label the tab
/// with the actual shell (e.g. `zsh`). `terminal-exit` fires when the shell
/// process ends.
#[tauri::command]
pub fn terminal_create(
    app: tauri::AppHandle,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    theme: Option<String>,
) -> Result<String, String> {
    // Reopening a collapsed terminal must preserve the original shell, not
    // spawn a fresh one. If a session with this id is still alive, return it
    // untouched; if its child has exited, drop it and respawn below.
    if let Some(shell_path) = {
        let mut guard = TERMINALS.lock().unwrap();
        guard.get_mut(&id).and_then(|session| match session.child.try_wait() {
            Ok(Some(_)) => None,
            _ => Some(session.shell_path.clone()),
        })
    } {
        return Ok(shell_path);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let shell_path = shell.unwrap_or_else(|| {
        // ponytail: macOS/Linux expose the user's shell via $SHELL; Windows has
        // no SHELL env var — fall back to COMSPEC (cmd.exe) or a final
        // hard-coded cmd.exe. PowerShell users can pass `shell` explicitly.
        if cfg!(target_os = "windows") {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        }
    });
    let mut cmd = CommandBuilder::new(&shell_path);
    // Interactive shells only load the user's rc files / prompt theme when the
    // shell believes it is interactive. Without `-i`, zsh falls back to its
    // bare `%` prompt and skips oh-my-zsh entirely. Known Unix shells get `-i`;
    // Windows cmd.exe / powershell don't recognize `-i` (cmd uses /Q for echo
    // off, powershell uses -NoLogo).
    let shell_base = shell_path
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("")
        .to_string();
    if matches!(shell_base.as_str(), "zsh" | "bash" | "sh" | "dash" | "ksh") {
        cmd.arg("-i");
    } else if matches!(shell_base.as_str(), "cmd.exe" | "cmd") {
        cmd.arg("/Q");
    } else if shell_base == "powershell.exe" || shell_base == "powershell" {
        cmd.arg("-NoLogo");
    }
    if let Some(dir) = cwd {
        // Vault base paths are stored as `~/...` (resolveBasePath notation);
        // the PTY's chdir needs an absolute path, so expand the tilde here.
        let dir = expand_tilde(&dir);
        if !dir.is_empty() {
            cmd.cwd(dir);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env(
        "LANG",
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
    );
    // sobole (the user's oh-my-zsh theme) colors its caret `»` white when
    // SOBOLE_THEME_MODE=dark and black otherwise — without this, the caret is
    // invisible on the app's dark background. Other themes ignore the var.
    if let Some(theme) = theme {
        cmd.env(
            "SOBOLE_THEME_MODE",
            if theme == "dark" { "dark" } else { "light" },
        );
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    TERMINALS.lock().unwrap().insert(
        id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            child,
            shell_path: shell_path.clone(),
        },
    );

    // Reader thread: blocks on the pty and forwards output chunks. Ends when
    // the pty hits EOF (shell exited) and emits the exit event.
    let emit_app = app.clone();
    let emit_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = base64_encode(&buf[..n]);
                    let _ = emit_app.emit(
                        "terminal-output",
                        serde_json::json!({ "id": emit_id, "data": data }),
                    );
                }
            }
        }
        let _ = emit_app.emit("terminal-exit", serde_json::json!({ "id": emit_id }));
    });

    Ok(shell_path)
}

/// Forward a chunk of input to the session's pty. xterm input is UTF-8 text
/// (keystrokes/IME), so it is written raw — only output is base64-encoded.
#[tauri::command]
pub fn terminal_write(id: String, data: String) -> Result<(), String> {
    let mut guard = TERMINALS.lock().unwrap();
    let session = guard
        .get_mut(&id)
        .ok_or_else(|| "terminal not found".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("pty write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("pty flush failed: {e}"))?;
    Ok(())
}

/// Resize the pty (cols/rows from the xterm FitAddon).
#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let guard = TERMINALS.lock().unwrap();
    let session = guard
        .get(&id)
        .ok_or_else(|| "terminal not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize failed: {e}"))
}

/// Kill a session's shell and drop it from the registry.
#[tauri::command]
pub fn terminal_kill(id: String) -> Result<(), String> {
    if let Some(mut session) = TERMINALS.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Kill every live session — called from the app-exit handler so shells don't
/// outlive the process.
pub fn terminal_kill_all() {
    let sessions: Vec<String> = TERMINALS.lock().unwrap().keys().cloned().collect();
    for id in sessions {
        let _ = terminal_kill(id);
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Expand a leading `~` / `~/` to the user's home directory (no-op otherwise).
/// macOS/Linux use HOME; Windows has no HOME so falls back to USERPROFILE.
fn expand_tilde(path: &str) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        return path.to_string();
    }
    if path == "~" {
        return home;
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return format!("{home}/{rest}");
    }
    path.to_string()
}

#[cfg(test)]
mod tilde_tests {
    use super::expand_tilde;

    #[test]
    fn expands_tilde_prefix() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("~/quill/default_vault"), format!("{home}/quill/default_vault"));
        assert_eq!(expand_tilde("/abs/path"), "/abs/path");
        assert_eq!(expand_tilde("relative/path"), "relative/path");
    }
}
