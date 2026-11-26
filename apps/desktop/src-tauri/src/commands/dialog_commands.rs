//! `pick_external_paths` opens an NSOpenPanel that accepts files AND folders
//! in the same selection. tauri-plugin-dialog (rfd 0.16) hardwires the two
//! modes as mutually exclusive (`directory: true` → setCanChooseFiles(false),
//! `false` → setCanChooseDirectories(false)), so this command drives AppKit
//! directly. Mirrors rfd's own usage in
//! `rfd-0.16.0/src/backend/macos/file_dialog/panel_ffi.rs`:
//! openPanel(mtm) + setCanChooseFiles(true) + setCanChooseDirectories(true)
//! + setAllowsMultipleSelection(true), then runModal() == NSModalResponseOK
//! and collect `path()` from every URL in `URLs()`.
//!
//! objc2/objc2-app-kit/objc2-foundation are already transitive deps via rfd;
//! they are declared directly here to pin the import path (same versions as
//! the lock: objc2 0.6.4, app-kit 0.3.2, foundation 0.3.2).
//!
//! Non-macOS builds register the same command but return Err; the JS caller
//! (`editorIoService.openExternalFile`) falls back to the plugin's
//! files-only dialog, which is the pre-existing behavior on Windows.

#[cfg(target_os = "macos")]
use objc2_06::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_06::rc::{autoreleasepool, Retained};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel, NSSavePanel};

#[cfg(target_os = "macos")]
fn pick_paths_on_main_thread() -> Vec<String> {
    // All bindings below are generated as SAFE functions by objc2-app-kit
    // 0.3.2 (they only rely on being called from the main thread, which
    // MainThreadMarker::new() proves here — guaranteed by run_on_main_thread).
    // `URLs()`/`path()` may return autoreleased objects — collected inside an
    // autoreleasepool and converted to owned Strings before leaving it.
    let mtm = MainThreadMarker::new().expect("run_on_main_thread guarantees the main thread");
    let panel: Retained<NSOpenPanel> = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(true);
    panel.setAllowsMultipleSelection(true);
    // runModal lives on NSSavePanel (superclass); upcast a reference.
    let save_panel: Retained<NSSavePanel> = panel.clone().into_super();
    if save_panel.runModal() != NSModalResponseOK {
        return Vec::new();
    }
    let urls = panel.URLs();
    autoreleasepool(|_| {
        urls.iter()
            .filter_map(|url| url.path())
            .map(|path| path.to_string())
            .collect()
    })
}

/// Returns the absolute paths of the picked files AND folders (possibly
/// mixed), or `None` if the user cancelled. The modal panel must run on the
/// main thread (AppKit requirement); this async command blocks on a channel
/// until the panel closes — the same pattern tauri-plugin-dialog uses.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pick_external_paths(app: tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
    app.run_on_main_thread(move || {
        let _ = tx.send(pick_paths_on_main_thread());
    })
    .map_err(|e| e.to_string())?;
    let paths = rx.recv().map_err(|e| e.to_string())?;
    Ok(if paths.is_empty() { None } else { Some(paths) })
}

/// Windows/Linux: the mixed file+folder panel is macOS-only (NSOpenPanel).
/// The JS side detects the Err and falls back to the plugin's files-only
/// dialog, preserving the previous behavior on those platforms.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn pick_external_paths() -> Result<Option<Vec<String>>, String> {
    Err("mixed file/folder pick is macOS-only".into())
}
