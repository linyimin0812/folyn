use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

use crate::commands::pet_common::*;
use crate::errors::AppError;

/// Show the pet-panel window and set focus. The caller sets the window's
/// position via `pet_panel_set_position` first (or right after) so the panel
/// appears next to the pet.
///
/// After `set_focus()` (which activates the Folyn app + makes the panel key),
/// this also makes the **WKWebView** the first responder via
/// `makeFirstResponder:` on the main thread. `set_focus()` alone makes the
/// WINDOW key but does NOT make the WKWebView first responder — `document`
/// never receives `keydown` until a click makes the webview FR. This is the
/// deterministic Esc fix: `makeFirstResponder(wkwebview)` → AppKit delivers
/// `keyDown:` to the webview → the DOM `document` receives `keydown` → the
/// React Esc listener fires without a click. See
/// `research/makefirstresponder-keyboard.md` — the crate's own
/// `show_and_make_key` does `makeFirstResponder: &*content_view` (the tao
/// parent view, NOT the WKWebView), which routes `keyDown:` to the wrong
/// target; we must target the WKWebView ns_view specifically.
#[tauri::command]
pub async fn pet_panel_show(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.show().map_err(|e| e.to_string())?;
    focus_panel(&panel);
    Ok(())
}

/// Focus the pet-panel window (set_focus + macOS makeFirstResponder +
/// Windows WebView2-child SetFocus). Called by `pet_panel_show` after
/// `show()`, AND by `applyPanelFrame` (PetApp.tsx) as a SECOND call AFTER
/// the post-show position/size re-assert.
///
/// Why the second call exists: on Windows, opening the panel via a click on
/// the `pet` window does NOT activate the Folyn app first (`pet` is
/// `focus:false` / `WS_EX_NOACTIVATE`, so the click leaves foreground with
/// whatever app the user was in). `set_focus()` then routes to Win32
/// `SetForegroundWindow`, which Windows blocks for non-foreground processes
/// — so the panel SHOWS but never actually gains focus. Result: clicking
/// elsewhere doesn't deactivate the panel (it was never active) → no
/// `tauri://blur` → the unpinned auto-hide never fires (panel won't close).
/// The first open worked because the user was foreground in Folyn then.
///
/// The re-assert (`set_position`/`set_size`) uses `SWP_NOACTIVATE` so it does
/// not disturb focus, but re-issuing `set_focus()` as the LAST step of the
/// open gesture gives Windows another chance to promote the panel to
/// foreground (by then the panel is visible + the user-initiated pet click
/// has satisfied SetForegroundWindow's input-queue recency window). It is
/// idempotent when focus already landed (the first call inside
/// `pet_panel_show`), so macOS is unaffected. Also re-runs the macOS
/// `makeFirstResponder` so keyboard (Esc) still works after the re-focus.
fn focus_panel(panel: &tauri::WebviewWindow) {
    // `set_focus()` activates the Folyn app (`activateIgnoringOtherApps:YES`)
    // so the pet-panel becomes the active app's key window — required for
    // the React Esc keydown listener to fire (otherwise keyboard events go
    // to whatever app was frontmost, e.g. VS Code, and Esc can't close the
    // panel). The side effect: when the panel hides, the main Folyn editor
    // stays frontmost instead of returning to the user's previous app.
    // Restoring the previous app needs `NSWorkspace.frontmostApplication`
    // tracking + `activateWithOptions:` on hide — out of scope for this fix.
    let _ = panel.set_focus();

    // Make the WKWebView (NOT the contentView / parent view) the first
    // responder so `document` receives `keydown` → Esc works without a
    // click. Reuses the `pet_make_transparent` `with_webview` accessor
    // pattern: `webview.inner()` = WKWebView pointer, `webview.ns_window()`
    // = NSWindow. Must run on the main thread (AppKit API); `with_webview`
    // schedules the closure onto the macOS main run loop. The panel is
    // shown/hidden (not recreated), so `makeFirstResponder` must be
    // re-applied on every show — after `orderOut` (hide) the first responder
    // resigns and is NOT auto-restored on the next `makeKeyAndOrderFront`
    // for a nonactivating panel.
    #[cfg(target_os = "macos")]
    {
        use objc::runtime::Object;
        use objc::{msg_send, sel, sel_impl};
        let _ = panel.with_webview(move |webview| {
            unsafe {
                let wk = webview.inner() as *mut Object;
                let ns = webview.ns_window() as *mut Object;
                if ns.is_null() || wk.is_null() {
                    return;
                }
                let _: () = msg_send![ns, makeFirstResponder: wk];
            }
        });
    }

    // Windows equivalent of macOS `makeFirstResponder(wkwebview)`: give the
    // WebView2 child the keyboard focus so `document` receives `keydown`
    // (Esc works without a click) and the search input's `.focus()` shows a
    // caret. `set_focus()` above makes the panel the foreground window
    // (Tauri → SetForegroundWindow — confirmed working by the Windows
    // diagnostic logs: `GetForegroundWindow() == panel hwnd` on the show
    // path) and calls wry's `WebView::focus()` = `controller.MoveFocus(
    // PROGRAMMATIC)`. But `MoveFocus` only relays focus INTO the WebView once
    // the container already has Win32 focus — it does NOT itself grant focus.
    // wry's `focus_parent()` (SetFocus on the container HWND) is what would
    // trigger the container's `WM_SETFOCUS` handler (webview2/mod.rs), which
    // does `SetFocus(GetWindow(container, GW_CHILD))` to hand focus to the
    // WebView doc child — but Tauri's `set_focus()` never calls `focus_parent`,
    // so the container never gets `WM_SETFOCUS`, so the WebView doc child is
    // never focused. Result: the panel is foreground but `document` gets no
    // keydown (Esc won't close without a click) and `.focus()` shows no caret
    // ("没有自动聚焦"). A click on the search box works only because the
    // click routes through the WebView and hands it focus directly.
    //
    // Fix: SetFocus the first child of the panel window (the `WRY_WEBVIEW`
    // container wry creates) — this triggers the container's `WM_SETFOCUS`
    // handler, which SetFocuses the WebView doc child. Mirrors wry's own
    // `focus_parent()` + `WM_SETFOCUS` handler chain, made explicit because
    // Tauri's `set_focus()` stops short of it. No foreground-lock concern:
    // SetFocus within an already-foreground window is always allowed (the
    // lock is on cross-process SetForegroundWindow, not in-window SetFocus).
    // Idempotent: SetFocus on the already-focused child returns it unchanged.
    // Called inline (no run_on_main_thread) — SetFocus/GetWindow are stable
    // user32 entrypoints safe to call off the GUI thread (wry's `focus_parent`
    // and `MoveFocus` paths do the same).
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindow, GW_CHILD};
        if let Ok(hwnd_ptr) = panel.hwnd() {
            let hwnd: HWND = hwnd_ptr.0;
            if !hwnd.is_null() {
                // SAFETY: GetWindow (GW_CHILD) reads the first top-level child
                // HWND (the WRY_WEBVIEW container wry creates on the panel
                // window). SetFocus on a child HWND of the foreground window is
                // always allowed and is a Win32 no-op when already focused.
                unsafe {
                    let container = GetWindow(hwnd, GW_CHILD);
                    if !container.is_null() {
                        let _ = SetFocus(container);
                    }
                }
            }
        }
    }
}

/// Re-focus the pet-panel window after the post-show frame re-assert (see
/// `focus_panel` for the Windows WebView2-child-focus rationale). Idempotent
/// on macOS / when focus already landed. Called by `applyPanelFrame` in
/// PetApp.tsx as the LAST step of the open gesture.
#[tauri::command]
pub async fn pet_panel_set_focus(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    focus_panel(&panel);
    Ok(())
}

/// Hide the pet-panel window without closing it (the window stays alive for
/// the next show). Used by the close button, Esc, and the second pet click.
#[tauri::command]
pub async fn pet_panel_hide(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.hide().map_err(|e| e.to_string())?;
    // ponytail: emit the fade-out event so PetPanelApp resets `is-visible`.
    // The previous blur-based `isVisible()` check in PetPanelApp's
    // onFocusChanged was unreliable during the app activation that
    // `set_focus()` (in pet_panel_show) triggers — `isVisible()` could
    // return false momentarily mid-activation, causing setVisible(false)
    // to interrupt the fade-in transition → 忽隐忽现 (flicker: appear,
    // vanish, reappear). The explicit event fires ONLY on actual hide, so
    // the fade-in transition is never interrupted by spurious blur events.
    // File-upload (NSOpenPanel steals key window → blur, but panel still
    // visible) does NOT emit this event → panel stays at opacity:1.
    let _ = app.emit("pet://panel-fade-out", ());
    Ok(())
}

/// Shared pet-panel global-shortcut state. Holds the currently-registered
/// pet-panel HotKey so `pet_panel_set_shortcut` can do a TARGETED unregister
/// of just the previous pet HotKey — NOT `unregister_all`, which would also
/// wipe the voice push-to-talk HotKey registered by `voice::voice_set_global_hotkey`.
/// See the "Multiple OS-wide Shortcuts" scenario in
/// `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — the
/// `unregister_all` here was the root cause of bug #3 (pet-panel mount wiped
/// the voice hotkey registered at main-window mount).
///
/// `None` = no pet-panel shortcut currently registered. `Shortcut`
/// (= `global_hotkey::HotKey`) is `Copy + Send + Sync`, so storing it in a
/// `Mutex` is cheap and safe — same shape as `voice::VoiceState::voice_hotkey`.
pub struct PetShortcutState(pub Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>);

impl PetShortcutState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// Snapshot of the currently-registered pet HotKey (Copy). `None` when
    /// no pet shortcut is registered. Unwrap-to-None on a poisoned lock so
    /// a poisoned lock never breaks shortcut re-registration.
    pub fn hotkey(&self) -> Option<tauri_plugin_global_shortcut::Shortcut> {
        self.0.lock().ok().and_then(|guard| *guard)
    }

    /// Swap the stored HotKey. Silently ignores a poison error.
    pub fn set_hotkey(&self, hotkey: Option<tauri_plugin_global_shortcut::Shortcut>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = hotkey;
        }
    }
}

impl Default for PetShortcutState {
    fn default() -> Self {
        Self::new()
    }
}

/// Register (or replace) the global keyboard shortcut that toggles the
/// pet-panel window. Pass an empty string to unregister without re-binding.
///
/// The accelerator string follows Tauri's accelerator grammar
/// (e.g. `"Cmd+Shift+Q"`, `"CommandOrControl+Shift+Q"`). The extension is built
/// with a single global handler (see `lib.rs` `tauri_plugin_global_shortcut::Builder`)
/// that dispatches by HotKey id — the voice HotKey emits `voice://hotkey-*`,
/// every other registered HotKey (currently just this one) emits
/// `pet://shortcut-toggle` on Pressed. This command only swaps WHICH
/// accelerator fires the pet-panel branch.
///
/// Bug #3 fix: TARGETED unregister of the previously-stored pet HotKey only,
/// NOT `unregister_all`. The pet window mounts at app startup (visible:false
/// still loads the webview → PetApp mount effect calls this command), so the
/// previous `unregister_all` impl wiped the voice hotkey registered by
/// `App.tsx`'s mount effect. Migrated to the same targeted-unregister shape
/// as `voice::voice_set_global_hotkey` — the two accelerators are now
/// independent.
#[tauri::command]
pub async fn pet_panel_set_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), AppError> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    use std::str::FromStr;

    let state = app.state::<PetShortcutState>();

    // Targeted unregister: only the previously-stored pet HotKey, leaving
    // the voice HotKey (and any other feature's) intact.
    let prev = state.hotkey();
    if let Some(prev_hotkey) = prev {
        let _ = app.global_shortcut().unregister(prev_hotkey);
    }

    if accelerator.trim().is_empty() {
        // Unregister-only path.
        state.set_hotkey(None);
        return Ok(());
    }

    // Parse so we store a HotKey (Copy) — the catch-all in `lib.rs` compares
    // by id, so storing the parsed HotKey (not the string) lets it recognize
    // this shortcut's fired events. Registering via the HotKey (not the
    // string) keeps parse + register consistent.
    let hotkey = Shortcut::from_str(&accelerator)
        .map_err(|e| format!("invalid pet-panel shortcut '{accelerator}': {e}"))?;
    app.global_shortcut()
        .register(hotkey)
        .map_err(|e| format!("register pet-panel shortcut failed: {e}"))?;
    state.set_hotkey(Some(hotkey));
    log::info!("[pet] global shortcut registered: {accelerator}");
    Ok(())
}

/// Set the pet-panel window's screen position (physical pixels). The pet
/// frontend computes a clamped position next to the pet (using
/// `pet_get_work_area`) and passes it here so Rust stays the single source of
/// truth for window mutation.
#[tauri::command]
pub async fn pet_panel_set_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Get the pet-panel window's current screen position (physical pixels).
#[tauri::command]
pub async fn pet_panel_get_position(app: tauri::AppHandle) -> Result<PetPosition, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    let pos = panel.outer_position().map_err(|e| e.to_string())?;
    Ok(PetPosition { x: pos.x, y: pos.y })
}

/// Set the pet-panel window's size (physical pixels). Used to restore a
/// persisted size on panel open. The window is declared `resizable: true`
/// with `minWidth/minHeight` in tauri.conf.json, so the OS enforces a floor.
#[tauri::command]
pub async fn pet_panel_set_size(
    app: tauri::AppHandle,
    width: i32,
    height: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Get the pet-panel window's current size (physical pixels). Used by the
/// panel frontend's periodic poller to detect a user-driven resize and
/// persist the new size.
#[tauri::command]
pub async fn pet_panel_get_size(app: tauri::AppHandle) -> Result<PetPanelSize, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    let size = panel.outer_size().map_err(|e| e.to_string())?;
    Ok(PetPanelSize {
        width: size.width as i32,
        height: size.height as i32,
    })
}

/// Returns whether the pet-panel window is currently visible. The pet
/// frontend uses this for the toggle-on-second-click decision.
#[tauri::command]
pub async fn pet_panel_is_visible(app: tauri::AppHandle) -> Result<bool, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.is_visible().map_err(|e| AppError::from(e.to_string()))
}
