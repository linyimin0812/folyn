// File-path clipboard read for the "paste external files into the vault" flow
// (task 08-30-paste-external-files-with-folder-picker). Finder/Explorer place
// file references on the clipboard (NSPasteboard NSURL / CF_HDROP) that the
// webview's `navigator.clipboard.read()` cannot access — it only exposes
// text/plain and image/png. arboard's `Clipboard::get().file_list()` reads the
// real paths cross-platform; this command wraps it for the frontend.
//
// Returns an empty vec (NOT an error) when the clipboard has text/image but no
// file refs — the frontend treats empty as "fall through to normal text paste".

use arboard::Clipboard;

/// Read file paths from the system clipboard. Empty vec = no files on clipboard
/// (text/image only); the frontend falls through to the default paste handler.
///
/// ponytail: arboard locks the OS pasteboard briefly; the call site runs on a
/// blocking worker so the async command doesn't stall the tokio runtime. Mirrors
/// the voice.rs:1015 spawn_blocking pattern for clipboard access.
#[tauri::command]
pub async fn read_clipboard_files() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
        // file_list() returns ContentNotAvailable when the clipboard has no file
        // refs — that's a normal "no files, fall through" path, not an error.
        match cb.get().file_list() {
            Ok(paths) => Ok(paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()),
            Err(_) => Ok(Vec::new()),
        }
    })
    .await
    .map_err(|e| format!("clipboard join failed: {e}"))?
}
