//! Cross-app text insertion (Windows only).
//!
//! Writes `text` to the system clipboard via `tauri-plugin-clipboard-manager`
//! (cross-platform plugin, already linked), then posts a Ctrl+V keystroke via
//! `user32::SendInput` so the text lands in the cursor-focused input of the
//! frontmost app. Mirrors macOS `insertion.rs` (CGEvent Cmd+V path).
//!
//! No Accessibility / AX permission concept on Windows. UIPI (User Interface
//! Privilege Isolation) blocks SendInput to elevated processes when Mochi is
//! not elevated — MVP does not handle that (普通用户场景无影响).
//!
//! Ported from macOS `insertion.rs`; clipboard-restore logic shared by
//! copy-paste (same `tauri-plugin-clipboard-manager` API on both platforms).

#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL,
};

use super::paste_log;

/// How long to wait after the Ctrl+V post before restoring the user's prior
/// clipboard. Mirrors macOS `CLIPBOARD_RESTORE_DELAY` verbatim.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(750);

/// Virtual key code for 'V'. windows-sys does not export `VK_V` (the named
/// constant is for specific keys; 'V' uses the raw 0x56).
const VK_V: u16 = 0x56;

/// Pending restore bookkeeping so a second voice-insert within the delay
/// window doesn't clobber the ORIGINAL clip with the first insert's text.
/// Mirrors macOS `insertion.rs` `PendingClipboardRestore`.
#[derive(Debug, Clone)]
struct PendingClipboardRestore {
    latest_restore_id: u64,
    original_text: Option<String>,
}

static NEXT_CLIPBOARD_RESTORE_ID: AtomicU64 = AtomicU64::new(1);

static PENDING_CLIPBOARD_RESTORE: OnceLock<Mutex<Option<PendingClipboardRestore>>> = OnceLock::new();

fn pending() -> &'static Mutex<Option<PendingClipboardRestore>> {
    PENDING_CLIPBOARD_RESTORE.get_or_init(|| Mutex::new(None))
}

/// Write `text` to clipboard, post Ctrl+V, then restore the user's prior
/// clipboard contents after a short delay. Empty `text` is a no-op success.
/// Mirrors macOS `insertion::insert_text` 1:1 (clipboard plugin is
/// cross-platform).
pub fn insert_text(app: &AppHandle, text: &str) -> Result<(), String> {
    paste_log(&format!("[voice-paste] insert_text enter, text_len={}", text.len()));
    if text.is_empty() {
        paste_log("[voice-paste] insert_text empty text, no-op");
        return Ok(());
    }

    let clipboard = app.clipboard();
    let previous_text = clipboard.read_text().ok();
    paste_log(&format!(
        "[voice-paste] previous clipboard snapshot taken: present={}",
        previous_text.is_some()
    ));

    if let Err(err) = clipboard.write_text(text.to_string()) {
        paste_log(&format!("[voice-paste] clipboard write failed: {}", err));
        return Err(format!("写入剪贴板失败: {}", err));
    }
    paste_log("[voice-paste] clipboard written");

    if let Err(err) = post_ctrl_v() {
        paste_log(&format!("[voice-paste] SendInput Ctrl+V failed: {}", err));
        return Err(format!(
            "模拟粘贴失败: {err}。文本已写入剪贴板，可手动 Ctrl+V 粘贴。"
        ));
    }

    paste_log("[voice-paste] scheduling clipboard restore");
    schedule_clipboard_restore(app.clone(), previous_text, text.to_string());
    Ok(())
}

fn schedule_clipboard_restore(
    app: AppHandle,
    previous_text: Option<String>,
    inserted_text: String,
) {
    let (restore_id, original_text) = remember_pending_clipboard_restore(previous_text);
    // ponytail: bare `thread::spawn` — same reasoning as macOS insertion.rs:
    // 750ms sleep + clipboard write; detached thread returns immediately.
    std::thread::spawn(move || {
        std::thread::sleep(CLIPBOARD_RESTORE_DELAY);
        if !is_latest_clipboard_restore(restore_id) {
            return;
        }
        let clipboard = app.clipboard();
        let current_text = clipboard.read_text().ok();
        if should_restore_clipboard(current_text.as_deref(), &inserted_text) {
            if let Some(prev) = original_text {
                if let Err(err) = clipboard.write_text(prev) {
                    log::warn!("[voice-insert] clipboard restore failed: {}", err);
                }
            }
        } else {
            log::info!("[voice-insert] skip clipboard restore: clipboard changed since paste");
        }
        clear_pending_clipboard_restore(restore_id);
    });
}

fn remember_pending_clipboard_restore(previous_text: Option<String>) -> (u64, Option<String>) {
    let restore_id = NEXT_CLIPBOARD_RESTORE_ID.fetch_add(1, Ordering::SeqCst);
    let original_text = {
        let mut pending = pending().lock();
        let original = pending
            .as_ref()
            .map(|batch| batch.original_text.clone())
            .unwrap_or(previous_text);
        *pending = Some(PendingClipboardRestore {
            latest_restore_id: restore_id,
            original_text: original.clone(),
        });
        original
    };
    (restore_id, original_text)
}

fn is_latest_clipboard_restore(restore_id: u64) -> bool {
    matches!(
        pending().lock().as_ref(),
        Some(batch) if batch.latest_restore_id == restore_id
    )
}

fn clear_pending_clipboard_restore(restore_id: u64) {
    let mut pending = pending().lock();
    if matches!(pending.as_ref(), Some(batch) if batch.latest_restore_id == restore_id) {
        pending.take();
    }
}

fn should_restore_clipboard(current_text: Option<&str>, inserted_text: &str) -> bool {
    matches!(current_text, Some(current) if current == inserted_text)
}

/// Post Ctrl+V via `user32::SendInput` with a single 4-INPUT array:
/// Ctrl↓ → V↓ → V↑ → Ctrl↑. Single SendInput batch is the stable form —
/// research sendinput-paste.md §风险点 2.
fn post_ctrl_v() -> Result<(), String> {
    paste_log("[voice-paste] post_ctrl_v enter");
    // SAFETY: SendInput is a stable user32 entrypoint; INPUT struct is
    // `#[repr(C)]` and zeroed-init is correct for the union fields. The 4
    // INPUTs are stack-allocated, passed by mutable pointer to SendInput.
    unsafe {
        // ponytail: zeroed array is fine — INPUT_0 union has no Drop; we
        // overwrite r#type + the ki variant fully below.
        let mut inputs: [INPUT; 4] = [std::mem::zeroed(); 4];
        // 1. Ctrl down
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };
        // 2. V down
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };
        // 3. V up
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };
        // 4. Ctrl up
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };
        let sent = SendInput(4, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("SendInput returned 0 (foreground 窗口可能拒绝 / UIPI)".into());
        }
        paste_log(&format!("[voice-paste] SendInput posted {} events", sent));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_only_when_clipboard_still_holds_inserted_text() {
        assert!(should_restore_clipboard(Some("dictated text"), "dictated text"));
        assert!(!should_restore_clipboard(
            Some("user changed clipboard"),
            "dictated text"
        ));
        assert!(!should_restore_clipboard(None, "dictated text"));
    }

    #[test]
    fn remember_pending_restore_chains_to_original_not_intermediate() {
        clear_for_test();
        let (id1, orig1) = remember_pending_clipboard_restore(Some("USER_ORIG".into()));
        assert_eq!(orig1, Some("USER_ORIG".to_string()));
        let (id2, orig2) = remember_pending_clipboard_restore(Some("FIRST_INSERT".into()));
        assert_eq!(orig2, Some("USER_ORIG".to_string()), "second restore chains to first's original");
        assert!(id2 > id1);
        clear_for_test();
    }

    fn clear_for_test() {
        *pending().lock() = None;
    }
}
