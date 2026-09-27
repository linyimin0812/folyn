//! Generic window utilities for fullscreen teardown / alpha control (moved
//! verbatim from lib.rs). Used by the app-level `on_window_event` handler.

use tauri::Manager;

/// Exit native fullscreen and wait for the macOS transition to finish before
/// the caller hides/destroys the window.
///
/// Why: with `macOSPrivateApi` (tauri.conf.json `app.macOSPrivateApi`) a
/// window destroyed — or hidden — while in native fullscreen leaves a black
/// fullscreen Space behind. The Space belongs to the window; macOS does not
/// tear it down when the window vanishes mid-transition. Exiting fullscreen
/// first and letting the animation complete dismisses the Space, so the
/// subsequent teardown is invisible and leaves nothing behind.
///
/// macOS flips `is_fullscreen()` to false at the START of the exit
/// transition, so polling alone races the teardown. Poll until the flag
/// flips, then wait a grace period for the animation (typically ~300-600ms)
/// to actually complete. Hard-capped so a wedged transition can't hang the
/// close forever.
async fn exit_fullscreen_and_wait(win: &tauri::WebviewWindow) {
    if !win.is_fullscreen().unwrap_or(false) {
        return;
    }
    let _ = win.set_fullscreen(false);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while win.is_fullscreen().unwrap_or(false) {
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
}

/// Set the window's opacity. Used by the fullscreen close/hide helpers so the
/// exit-fullscreen transition is invisible — native macOS apps close a
/// fullscreen window "directly" (window disappears, Space dismisses) rather
/// than shrinking back to a windowed frame first, and this replicates that.
/// The main window's pet-mode close also restores opacity to 1.0 (while
/// hidden) so the next show is never transparent.
///
/// Must run on the main thread (NSWindow API is main-thread-only).
#[cfg(target_os = "macos")]
pub(crate) fn set_window_alpha(win: &tauri::WebviewWindow, alpha: f64) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;
    if let Ok(ns_window) = win.ns_window() {
        let ns_ptr = ns_window as *mut Object;
        if !ns_ptr.is_null() {
            unsafe {
                let _: () = msg_send![ns_ptr, setAlphaValue: alpha];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub(crate) fn set_window_alpha(_win: &tauri::WebviewWindow, _alpha: f64) {}

/// Make the window invisible on the main thread (setAlphaValue:0), waiting for
/// it to apply before the caller starts the fullscreen exit so the transition
/// never becomes visible. Bounded: a wedged main thread (e.g. mid-shutdown)
/// must not hang the close forever — worst case the window stays visible
/// through the exit transition, which is the previous behavior.
#[cfg(target_os = "macos")]
async fn make_window_invisible(app: &tauri::AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return;
    };
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let app2 = app.clone();
    let label2 = label.to_string();
    let _ = w.run_on_main_thread(move || {
        if let Some(win) = app2.get_webview_window(&label2) {
            set_window_alpha(&win, 0.0);
        }
        let _ = tx.send(());
    });
    let _ = tokio::time::timeout(std::time::Duration::from_millis(1000), rx).await;
}

#[cfg(not(target_os = "macos"))]
async fn make_window_invisible(_app: &tauri::AppHandle, _label: &str) {}

/// Hide a fullscreen window the way native macOS apps close one: the window
/// content is made invisible immediately (setAlphaValue:0, scheduled on the
/// main thread), then the fullscreen Space is dismissed via
/// `exit_fullscreen_and_wait` (mandatory — a fullscreen window under
/// macOSPrivateApi leaves a black Space behind otherwise), then the window
/// is HIDDEN (never destroyed — used by pet-mode main-window close-to-hide
/// AND extension tool windows; destroying class-swapped windows is the
/// uncatchable close crash). Opacity is restored to 1.0 AFTER the hide so
/// the next show of the window is never transparent; only the fullscreen
/// restore is left to `MainWindowFullscreenRestore` (see the app-level
/// on_window_event Focused handler).
pub(crate) async fn hide_fullscreen_window_directly(app: tauri::AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return; // window gone, nothing to do
    };
    make_window_invisible(&app, label).await;
    exit_fullscreen_and_wait(&w).await;
    let _ = w.hide();
    // Restore opacity while hidden so the next show is never transparent.
    #[cfg(target_os = "macos")]
    {
        let app2 = app.clone();
        let label2 = label.to_string();
        let _ = w.run_on_main_thread(move || {
            if let Some(win) = app2.get_webview_window(&label2) {
                set_window_alpha(&win, 1.0);
            }
        });
    }
}
