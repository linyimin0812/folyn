//! Cross-app text insertion (macOS only).
//!
//! Writes `text` to the system clipboard via the `tauri-plugin-clipboard-manager`
//! Rust API (already-linked, no new dep — ponytail rule #5), then posts a
//! Cmd+V keystroke via CoreGraphics `CGEvent` so the text lands in the
//! cursor-focused input of the frontmost app (including other apps).
//!
//! Accessibility permission gate: `AXIsProcessTrusted` — if not granted,
//! `CGEventPost` silently no-ops on macOS, so we surface a clear error
//! guiding the user to 系统设置 → 隐私与安全性 → 辅助功能.
//!
//! Ported from openless `insertion.rs` macOS path; the Windows / Linux /
//! fcitx / enigo paths are NOT ported (cfg-gated out — Folyn is macOS-only
//! for voice input this round).

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::paste_log;

/// Per-session guard so the system accessibility prompt fires at most once
/// per process lifetime from the `post_cmd_v` hot path. Apple does NOT
/// suppress repeat `AXIsProcessTrustedWithOptions({prompt:true})` prompts for
/// apps not yet in the Accessibility list, so unguarded prompting from
/// `post_cmd_v` is popup hell. The first call where `check_accessibility()`
/// is false prompts (user wants auto-popup on first attempt); subsequent
/// calls in the same session skip the popup and return the error directly
/// (the user already saw the prompt). Process restart resets the guard —
/// which is correct, because the new process picks up the refreshed TCC
/// verdict if the user granted in System Settings (and won't enter the
/// not-trusted branch at all in that case).
///
/// `voice_request_accessibility` (the VoiceSettings button) resets this guard
/// before prompting, so the button acts as an explicit "re-trigger the system
/// dialog" entrypoint — see `reset_accessibility_prompt_guard`.
static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);

/// Reset the per-session prompt guard. Called by the
/// `voice_request_accessibility` Tauri command (the VoiceSettings "授权辅助功能"
/// button) so the button always re-fires the system dialog on demand, even if
/// the hot path already prompted this session. The button is the "explicit
/// re-prompt" affordance; the hot path is "auto-prompt once, then silent".
pub fn reset_accessibility_prompt_guard() {
    ACCESSIBILITY_PROMPTED.store(false, Ordering::SeqCst);
}

/// How long to wait after the Cmd+V post before restoring the user's prior
/// clipboard. Ported verbatim from openless `CLIPBOARD_RESTORE_DELAY` — short
/// enough that the user doesn't notice the clip is stale, long enough for the
/// paste to land in the target app's input.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(750);

/// Pending restore bookkeeping so a second voice-insert within the delay
/// window doesn't clobber the ORIGINAL clip with the first insert's text.
/// Mirrors openless `PendingClipboardRestore`.
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

/// Write `text` to clipboard, post Cmd+V, then restore the user's prior
/// clipboard contents after a short delay. Empty `text` is a no-op success.
///
/// `restore` should be `true` in normal operation (don't eat the user's clip);
/// set `false` only if the caller explicitly wants to leave the text on the
/// clipboard. Folyn's voice path always restores.
pub fn insert_text(app: &AppHandle, text: &str) -> Result<(), String> {
    paste_log(&format!("[voice-paste] insert_text enter, text_len={}", text.len()));
    if text.is_empty() {
        paste_log("[voice-paste] insert_text empty text, no-op");
        return Ok(());
    }

    // Snapshot the user's current clipboard BEFORE overwriting it, so we can
    // restore after the paste. A failed read is non-fatal (treat as None —
    // restore will just clear/leave the inserted text).
    let clipboard = app.clipboard();
    let previous_text = clipboard.read_text().ok();
    paste_log(&format!("[voice-paste] previous clipboard snapshot taken: present={}", previous_text.is_some()));

    if let Err(err) = clipboard.write_text(text.to_string()) {
        paste_log(&format!("[voice-paste] clipboard write failed: {}", err));
        return Err(format!("写入剪贴板失败: {}", err));
    }
    paste_log("[voice-paste] clipboard written");

    if let Err(err) = post_cmd_v() {
        // Paste failed — leave the text on the clipboard so the user can
        // manually paste. Don't restore (the text IS the fallback).
        paste_log(&format!("[voice-paste] CGEvent Cmd+V failed: {}", err));
        return Err(format!(
            "模拟粘贴失败（需辅助功能权限）: {err}。文本已写入剪贴板，可手动 Cmd+V 粘贴。"
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
    // ponytail: a bare `thread::spawn` is fine here — the restore is a one-shot
    // 750ms sleep + clipboard write. Spawning onto tauri's async runtime would
    // hold a worker for the whole sleep; a detached thread returns immediately.
    // If clipboard restore contention ever shows up, move to a single dedicated
    // restore thread with a channel.
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
            log::info!(
                "[voice-insert] skip clipboard restore: clipboard changed since paste"
            );
        }
        clear_pending_clipboard_restore(restore_id);
    });
}

fn remember_pending_clipboard_restore(previous_text: Option<String>) -> (u64, Option<String>) {
    let restore_id = NEXT_CLIPBOARD_RESTORE_ID.fetch_add(1, Ordering::SeqCst);
    let original_text = {
        let mut pending = pending().lock();
        // If a restore is already pending, chain to ITS original (not the
        // intermediate inserted text) so a rapid second insert still restores
        // the user's true original clip.
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

// ── macOS CGEvent Cmd+V ──
// Direct CoreGraphics FFI to post a Cmd+V keystroke. Avoids enigo (which
// trips a TSM assertion off the main thread) and avoids pulling a new crate
// — CoreGraphics + CoreFoundation are system frameworks, no Cargo dep.
// Ported verbatim from openless `insertion::macos`.

#[repr(C)]
struct OpaqueCGEvent(c_void);
type CGEventRef = *mut OpaqueCGEvent;

#[repr(C)]
struct OpaqueCGEventSource(c_void);
type CGEventSourceRef = *mut OpaqueCGEventSource;

type CGEventTapLocation = u32;
type CGEventSourceStateID = i32;
type CGKeyCode = u16;
type CGEventFlags = u64;

const KCG_HID_EVENT_TAP: CGEventTapLocation = 0;
const KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE: CGEventSourceStateID = 1;
const KCG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x00100000;
/// US/ANSI keyboard virtual key code for "V" (kVK_ANSI_V).
const KEY_V: CGKeyCode = 9;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceCreate(state_id: CGEventSourceStateID) -> CGEventSourceRef;
    fn CGEventCreateKeyboardEvent(
        source: CGEventSourceRef,
        virtual_key: CGKeyCode,
        key_down: bool,
    ) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
    fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Accessibility gate + Cmd+V post. Returns a clear error if accessibility
/// is not granted (CGEventPost would otherwise silently no-op).
///
/// ponytail: prompts the system accessibility dialog ONCE per process
/// lifetime when `check_accessibility()` is false. This deviates from
/// openless `insertion::macos::insert_with_clipboard_restore`, which never
/// prompts from the paste path (it returns `InsertStatus::CopiedFallback`
/// and lets the user trigger the prompt themselves). Folyn deviates because
/// the user explicitly asked for the system dialog to fire automatically on
/// the first insert attempt — without that, they have to find and click the
/// VoiceSettings "授权辅助功能" button, which feels broken on first use.
/// The per-session `ACCESSIBILITY_PROMPTED` guard caps the popup to once
/// per process so the auto-prompt doesn't become popup hell on repeat
/// inserts. The `voice_request_accessibility` Tauri command (the button)
/// resets the guard so the user can still re-trigger the dialog explicitly.
/// Once granted in System Settings, the user may still need to restart the
/// app for TCC to reflect the new verdict (macOS caches the per-process TCC
/// verdict at launch).
fn post_cmd_v() -> Result<(), String> {
    paste_log("[voice-paste] post_cmd_v enter");
    let trusted = super::permissions::check_accessibility();
    paste_log(&format!("[voice-paste] accessibility trusted: {}", trusted));
    if !trusted {
        // First-call-only prompt. `swap` returns the PRIOR value; if it was
        // already true, we've prompted this session → skip the popup and just
        // return the error. The user already saw the dialog; re-prompting is
        // popup hell.
        let already_prompted = ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst);
        if !already_prompted {
            super::permissions::request_accessibility();
        }
        let now_trusted = super::permissions::check_accessibility();
        paste_log(&format!("[voice-paste] requested accessibility, now trusted: {}", now_trusted));
        if !now_trusted {
            return Err(
                "未授予辅助功能权限。请在 系统设置 → 隐私与安全性 → 辅助功能 中允许 Folyn（授权后需重启应用生效）"
                    .into(),
            );
        }
    }

    // SAFETY: all four CGEvent calls are standard C entrypoints into
    // CoreGraphics. `source` may be NULL (Apple docs allow CGEventCreate* with
    // a NULL source); we still release non-NULL returns below. `down`/`up`
    // are owned by us until `CFRelease`. `CGEventPost` does not take
    // ownership. `CGEventSetFlags` mutates the event in place.
    paste_log("[voice-paste] creating CGEventSource");
    unsafe {
        let source = CGEventSourceCreate(KCG_EVENT_SOURCE_STATE_HID_SYSTEM_STATE);
        paste_log(&format!("[voice-paste] source ptr: {:?}", source));
        let down = CGEventCreateKeyboardEvent(source, KEY_V, true);
        let up = CGEventCreateKeyboardEvent(source, KEY_V, false);
        paste_log(&format!("[voice-paste] down ptr: {:?}, up ptr: {:?}", down, up));
        if down.is_null() || up.is_null() {
            if !source.is_null() {
                CFRelease(source as *const c_void);
            }
            if !down.is_null() {
                CFRelease(down as *const c_void);
            }
            if !up.is_null() {
                CFRelease(up as *const c_void);
            }
            return Err("CGEventCreateKeyboardEvent returned null".into());
        }
        paste_log("[voice-paste] posting CGEvent keydown + keyup with Cmd flag");
        CGEventSetFlags(down, KCG_EVENT_FLAG_MASK_COMMAND);
        CGEventSetFlags(up, KCG_EVENT_FLAG_MASK_COMMAND);
        CGEventPost(KCG_HID_EVENT_TAP, down);
        CGEventPost(KCG_HID_EVENT_TAP, up);
        paste_log("[voice-paste] CGEvent posted");

        CFRelease(down as *const c_void);
        CFRelease(up as *const c_void);
        if !source.is_null() {
            CFRelease(source as *const c_void);
        }
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
        // Two rapid inserts: the second's restore must chain to the first's
        // original, not the first's inserted text, so the user's true clip is
        // preserved.
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

    #[test]
    fn accessibility_prompt_guard_starts_false_and_resets() {
        // ponytail: smallest check that fails if the guard's store/swap/reset
        // logic breaks. We reset, store false (already the initial state but
        // defensive), swap to read the prior value, and verify reset clears it.
        reset_accessibility_prompt_guard();
        let prior = ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst);
        assert!(!prior, "first swap after reset must read false");
        // Second swap without reset must read true (already prompted this session).
        let prior_again = ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst);
        assert!(prior_again, "second swap must read true (already prompted)");
        reset_accessibility_prompt_guard();
        let after_reset = ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst);
        assert!(!after_reset, "swap after reset must read false again");
        reset_accessibility_prompt_guard();
    }
}
