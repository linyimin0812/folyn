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
/// ponytail: MUST run on the macOS main thread. arboard's
/// `Clipboard::get().file_list()` calls `NSPasteboard::readObjectsForClasses:`
/// via objc2 `msg_send!`; on a background (spawn_blocking) thread this hits
/// `-[NSPasteboard _updateTypeCacheIfNeeded]` → `objc_msgSend` EXC_BAD_ACCESS /
/// pointer-authentication failure when the pasteboard holds a Chrome-copied
/// image (the lazy-loaded item data crosses process/thread boundaries with the
/// wrong ownership timing). arboard marks `Clipboard` as `Send+Sync`, but that
/// is an unsound assertion for the NSPasteboard item-data path. Mirrors the
/// `pet_rebuild_app_menu` / `voice_insert_text` `run_on_main_thread` pattern.
/// The main-thread read blocks the UI for only the brief pasteboard lock;
/// preferable to aborting the whole process.
#[tauri::command]
pub async fn read_clipboard_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use std::sync::mpsc::channel;
    let (tx, rx) = channel::<Result<Vec<String>, String>>();
    app.run_on_main_thread(move || {
        let res = (|| -> Result<Vec<String>, String> {
            let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
            // file_list() returns ContentNotAvailable when the clipboard has no
            // file refs — that's a normal "no files, fall through" path.
            match cb.get().file_list() {
                Ok(paths) => Ok(paths
                    .into_iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect()),
                Err(_) => Ok(Vec::new()),
            }
        })();
        let _ = tx.send(res);
    })
    .map_err(|e| format!("clipboard main-thread dispatch failed: {e}"))?;
    rx.recv().map_err(|e| format!("clipboard result channel closed: {e}"))?
}
