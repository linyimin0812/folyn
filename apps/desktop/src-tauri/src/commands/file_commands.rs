use std::fs;
use serde::Serialize;

use crate::errors::AppError;

#[tauri::command]
pub async fn open_file(path: String) -> Result<String, AppError> {
    fs::read_to_string(&path).map_err(AppError::from)
}

#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), AppError> {
    fs::write(&path, content).map_err(AppError::from)
}

#[derive(Serialize)]
pub struct UrlCheckResult {
    pub reachable: bool,
    pub error: String,
}

/// Check if a URL is reachable using the system curl command.
/// Uses a GET request (not HEAD) because many servers reject HEAD requests.
/// Only downloads headers (-o /dev/null) to avoid fetching the full body.
#[tauri::command]
pub async fn check_url(url: String) -> UrlCheckResult {
    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time", "8",
            "--location",
            "-o", "/dev/null",
            "-w", "%{http_code}",
            &url,
        ])
        .output();

    match output {
        Ok(out) => {
            let status_str = String::from_utf8_lossy(&out.stdout);
            let status: u16 = status_str.trim().parse().unwrap_or(0);
            // Consider reachable if we got any HTTP response (even 4xx/5xx).
            // Only status 0 means a network-level failure (DNS, connection refused, etc.).
            if status > 0 {
                UrlCheckResult { reachable: true, error: String::new() }
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                UrlCheckResult { reachable: false, error: stderr }
            }
        }
        Err(e) => UrlCheckResult { reachable: false, error: e.to_string() },
    }
}

// ────────────────────────────────────────────────────────────────────────────
// OS "Open With" / file-association launch buffering.
//
// Sources push paths here AND emit `app://open-external-file`:
//   - `RunEvent::Opened` (macOS Launch Services routing to the running app)
//   - single-instance callback (macOS + Windows second-instance argv)
//   - cold-launch argv capture in `run()` (macOS + Windows Launch
//     Services / Explorer positional args) — populated BEFORE
//     `Builder::build()` starts loading the webview so a mount-time drain
//     can never race the argv read.
// The frontend registers its listener FIRST, then drains once on mount
// (closing the cold-launch race where the emit fires before the React
// listener registers); `openFile` is idempotent on the tab id, so a path
// delivered both ways just re-activates the tab.
// ────────────────────────────────────────────────────────────────────────────

/// Backend-side buffer of OS file-association launch paths (managed on the
/// Builder chain like `PetSizeState` — see lib.rs). `Mutex` guards the Vec
/// because pushes come from the main/event-loop thread (`RunEvent::Opened`,
/// the Windows single-instance callback) while the drain invoke arrives from
/// the webview's IPC thread.
#[derive(Default)]
pub struct PendingOpenFiles(pub std::sync::Mutex<Vec<String>>);

impl PendingOpenFiles {
    /// Cold-launch constructor: capture `std::env::args_os()` NOW (before
    /// the Builder is built / webviews start loading) so a mount-time drain
    /// can never miss the paths. On both macOS and Windows, Launch Services
    /// / Explorer passes the "Open With" file path(s) as positional argv —
    /// this is the deterministic cold-launch channel, independent of
    /// `RunEvent::Opened` timing. argv[0] is the exe path and `-`/`--`
    /// flags are dropped by `filter_argv_paths`.
    pub fn from_process_args() -> Self {
        let args: Vec<String> = std::env::args_os()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let paths = filter_argv_paths(&args);
        crate::startup_log(format!(
            "[open-external] argv captured {} pending path(s)",
            paths.len()
        ));
        Self(std::sync::Mutex::new(paths))
    }

    /// Append OS-launch paths to the buffer. Non-fatal on a poisoned lock —
    /// a poisoned mutex must never drop a user's file open.
    pub fn push(&self, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        if let Ok(mut buf) = self.0.lock() {
            buf.extend(paths);
        }
    }

    /// Drain (take-and-clear) the buffered paths. Returns an empty vec on a
    /// poisoned lock so the frontend's mount-time drain never panics.
    pub fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut buf| std::mem::take(&mut *buf))
            .unwrap_or_default()
    }
}

/// Keep only positional file paths from a process argv: drop `argv[0]` (the
/// executable path) and any flag-looking argument (`-` / `--` prefix, e.g.
/// `--single-instance` or `-psn_...` on macOS). Extracted as a pure function
/// so the Windows argv parsing is unit-testable on every platform.
pub fn filter_argv_paths(args: &[String]) -> Vec<String> {
    args.iter()
        .enumerate()
        .filter(|(i, arg)| *i > 0 && !arg.starts_with('-') && !arg.trim().is_empty())
        .map(|(_, arg)| arg.clone())
        .collect()
}

/// Return and clear any OS-launch file paths buffered before the frontend
/// registered its `app://open-external-file` listener. Invoked once on App
/// mount BEFORE the listener is registered, so the cold-launch race is
/// closed: whatever the OS handed Folyn before React mounted is returned
/// here; everything after is delivered by the event listener.
#[tauri::command]
pub fn drain_pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    let drained = state.drain();
    if !drained.is_empty() {
        crate::startup_log(format!(
            "[open-external] drained {} pending path(s): {drained:?}",
            drained.len()
        ));
    }
    drained
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Buffer round-trip: a single push → drain returns it AND clears it
    /// (a second drain is empty).
    #[test]
    fn pending_open_files_push_drain_roundtrip() {
        let buf = PendingOpenFiles::default();
        buf.push(vec!["/tmp/a.md".to_string()]);
        assert_eq!(buf.drain(), vec!["/tmp/a.md"]);
        assert!(buf.drain().is_empty());
    }

    /// Multiple pushes accumulate; drain returns all in order and clears.
    #[test]
    fn pending_open_files_multiple_pushes_drain_all() {
        let buf = PendingOpenFiles::default();
        buf.push(vec!["C:\\a.md".to_string(), "C:\\b.md".to_string()]);
        buf.push(vec!["/tmp/c.md".to_string()]);
        assert_eq!(buf.drain(), vec!["C:\\a.md", "C:\\b.md", "/tmp/c.md"]);
        assert!(buf.drain().is_empty());
    }

    /// argv filter: skips the exe path and `-`/`--` flags, keeps file paths
    /// (including paths with spaces).
    #[test]
    fn filter_argv_paths_skips_exe_and_flags_keeps_files() {
        let args = vec![
            "C:\\Program Files\\Folyn\\folyn.exe".to_string(),
            "C:\\docs\\a.md".to_string(),
            "--single-instance".to_string(),
            "C:\\docs\\b markdown.md".to_string(),
            "-psn_0_12345".to_string(),
        ];
        assert_eq!(
            filter_argv_paths(&args),
            vec!["C:\\docs\\a.md", "C:\\docs\\b markdown.md"]
        );
    }

    /// argv filter: a lone exe (normal launch, no associated file) yields
    /// nothing, so a normal cold start never opens a spurious tab.
    #[test]
    fn filter_argv_paths_empty_when_only_exe() {
        let args = vec!["/Applications/Folyn.app/Contents/MacOS/folyn".to_string()];
        assert!(filter_argv_paths(&args).is_empty());
    }
}
