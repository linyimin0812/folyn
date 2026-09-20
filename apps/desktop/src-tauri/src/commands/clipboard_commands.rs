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
/// macOS NSPasteboard change count / Windows clipboard sequence number —
/// increments on EVERY clipboard modification (even re-copying identical
/// data). Microseconds, reads no payload. This is the canonical cheap
/// clipboard-change detector: the extension RPC bridge gates
/// `clipboard:read-image` on it so an unchanged image is not re-decoded /
/// re-transferred (observed: a multi-MB screenshot on the clipboard
/// re-decoded + base64'd + IPC'd every poll second → main-webview UI
/// freeze on Windows while the image sat on the clipboard).
///
/// macOS: NSPasteboard changeCount via objc2 (main thread, see below).
/// Windows: `GetClipboardSequenceNumber` (user32) — the exact analog of
/// changeCount, a u32 bumped on every clipboard write. No OpenClipboard,
/// no payload, thread-safe — callable directly, no main-thread hop.
///
/// Returns -1 on Linux (no equally cheap universal signal — X11/Wayland
/// differ) — callers treat that as "always changed" (full read every time,
/// the pre-gate behavior).
#[tauri::command]
pub async fn clipboard_change_count(app: tauri::AppHandle) -> Result<i64, String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = &app; // silence unused on non-macOS/non-Windows builds
        return Ok(-1);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = &app; // silence unused: no dispatch needed, see doc comment
        // windows-sys raw FFI — user32 is already linked (tao/wry/voice module).
        use windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber;
        // ponytail: u32 wraps ~every 49 days of clipboard writes at 1 kHz —
        // equality gate degrades to one spurious full read per wrap, harmless.
        return Ok(unsafe { GetClipboardSequenceNumber() } as i64);
    }
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc::channel;
        let (tx, rx) = channel::<i64>();
        app.run_on_main_thread(move || {
            use objc2::runtime::AnyClass;
            use objc2::msg_send;
            let count = unsafe {
                let cls = match AnyClass::get("NSPasteboard") {
                    Some(c) => c,
                    None => {
                        let _ = tx.send(-1);
                        return;
                    }
                };
                let pb: *mut objc2::runtime::AnyObject = msg_send![cls, generalPasteboard];
                if pb.is_null() {
                    let _ = tx.send(-1);
                    return;
                }
                // generalPasteboard returns the shared singleton — do NOT release.
                let cnt: i64 = msg_send![pb, changeCount];
                cnt
            };
            let _ = tx.send(count);
        })
        .map_err(|e| format!("clipboard_change_count dispatch failed: {e}"))?;
        rx.recv().map_err(|e| format!("clipboard_change_count channel closed: {e}"))
    }
}

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

// ── image read/write with Rust-side base64 ──
//
// Why these exist instead of the clipboard-manager plugin's readImage/
// writeImage: tauri's default command serialization is JSON, and binary
// payloads do NOT get the raw IPC channel — only an explicit
// `ipc::Response` does. `plugin:image|rgba` returns a plain `Vec<u8>` →
// serialized as a JSON ARRAY OF NUMBERS (~12 bytes/pixel-byte), so a 1440p
// screenshot becomes a ~50 MB JSON string parsed on the MAIN webview's JS
// thread (~200 ms on an M-series Mac, seconds on typical Windows) — on
// every image copy. The JS-side mirror is equally bad: rpcBridge's
// bytesToBase64 chunk loop (another main-thread stall) and writeImage's
// Uint8Array argument, which JSON.stringify renders as a {"0":255,...}
// object (~400 MB for 4K). Keeping the payload as a base64 STRING end to
// end (decoded/encoded only in Rust, on a blocking thread) collapses the
// whole class: one JSON string, no per-byte JS work, no number arrays.
// arboard runs off the main thread exactly like the plugin's own async
// commands do (the macOS file_list crash was specific to
// readObjectsForClasses; get_image/set_image run off-main in the plugin
// today and are proven in production on this app).

/// Clipboard image read for the extension RPC bridge (`clipboard:read-image`).
/// Returns `{ rgba, w, h }` where `rgba` is base64 of the raw RGBA pixels,
/// or `None` when the clipboard has no image flavor (normal state, not an
/// error — mirrors the ContentNotAvailable mapping the JS side used to do).
#[derive(serde::Serialize)]
pub struct ClipboardImageB64 {
    pub rgba: String,
    pub w: u32,
    pub h: u32,
}

#[tauri::command]
pub async fn clipboard_read_image_b64() -> Result<Option<ClipboardImageB64>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use arboard::ImageData;
        use base64::Engine;
        let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
        match cb.get_image() {
            Ok(ImageData { width, height, bytes }) => Ok(Some(ClipboardImageB64 {
                rgba: base64::engine::general_purpose::STANDARD.encode(bytes.as_ref()),
                w: width as u32,
                h: height as u32,
            })),
            // No image flavor on the clipboard (text copied / empty) — normal.
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("clipboard_read_image_b64 join error: {e}"))?
}

/// Clipboard image write for the extension RPC bridge (`clipboard:write-image`).
/// Takes the PNG as base64 (the storage form extensions keep) and decodes it
/// Rust-side (tauri `image-png` feature, same JsImage::Bytes path the plugin
/// used) — no Uint8Array ever crosses the webview IPC.
#[tauri::command]
pub async fn clipboard_write_image_b64(png: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png.as_bytes())
            .map_err(|e| format!("invalid base64 png: {e}"))?;
        let img = tauri::image::Image::from_bytes(&bytes)
            .map_err(|e| format!("png decode failed: {e}"))?;
        let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_image(arboard::ImageData {
            bytes: std::borrow::Cow::Borrowed(img.rgba()),
            width: img.width() as usize,
            height: img.height() as usize,
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("clipboard_write_image_b64 join error: {e}"))?
}
