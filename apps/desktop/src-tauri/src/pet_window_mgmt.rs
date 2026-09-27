//! Pet window management: context-menu id → action mapping and the
//! topmost/NSPanel re-assert machinery (moved verbatim from lib.rs).

use crate::commands;

#[cfg(target_os = "macos")]
use crate::pet_panel_macos;

#[cfg(target_os = "macos")]
use tauri::Manager;

/// Maps a pet context-menu item id (see `commands::PET_CTX_MENU_*`) to the
/// `PetMenuAction` payload the main window expects. Returns `None` for
/// unknown ids (e.g. separators, which never fire `on_menu_event`).
///
/// The mapping also recognizes the 4 launcher-only actions
/// (`global-search`, `clip-from-url`, `command-palette`,
/// `toggle-theme`) even though they are not in the native right-click menu —
/// the pet-panel launcher dispatches them via the same `pet://menu-action`
/// event channel, and the frontend contract test asserts the full set stays
/// in sync. Returning the action unchanged here keeps the event payload
/// stable for any future caller that routes through `on_menu_event`.
pub(crate) fn pet_ctx_menu_action(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_SHOW_MAIN => Some("show-main"),
        commands::PET_CTX_MENU_HIDE_PET => Some("hide-pet"),
        commands::PET_CTX_MENU_SIZE_50 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_75 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_100 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_125 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_150 => Some("set-pet-size"),
        commands::PET_CTX_MENU_OPACITY_25 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_50 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_75 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_100 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_CLICK_THROUGH => Some("toggle-pet-click-through"),
        commands::PET_CTX_MENU_EXIT_APP => Some("exit-app"),
        // Launcher-only actions (pet-panel buttons, not native menu items).
        // Recognized here so the action-string contract stays uniform.
        "pet-ctx-global-search" => Some("global-search"),
        "pet-ctx-clip-from-url" => Some("clip-from-url"),
        "pet-ctx-command-palette" => Some("command-palette"),
        "pet-ctx-toggle-theme" => Some("toggle-theme"),
        _ => None,
    }
}

/// Resolve the `PetSize` level string from a native menu item id. Returns
/// `None` for non-size ids. Used by `on_menu_event` to attach the `{ size }`
/// payload to `set-pet-size` actions so the frontend handler applies the
/// correct size without re-parsing the menu id.
pub(crate) fn pet_ctx_menu_size_level(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_SIZE_50 => Some("50"),
        commands::PET_CTX_MENU_SIZE_75 => Some("75"),
        commands::PET_CTX_MENU_SIZE_100 => Some("100"),
        commands::PET_CTX_MENU_SIZE_125 => Some("125"),
        commands::PET_CTX_MENU_SIZE_150 => Some("150"),
        _ => None,
    }
}

/// Resolve the opacity level string ("25"|"50"|"75"|"100") from a native
/// menu item id. Returns `None` for non-opacity ids. Used by `on_menu_event`
/// to attach the `{ opacity }` payload to `set-pet-opacity` actions.
pub(crate) fn pet_ctx_menu_opacity_level(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_OPACITY_25 => Some("25"),
        commands::PET_CTX_MENU_OPACITY_50 => Some("50"),
        commands::PET_CTX_MENU_OPACITY_75 => Some("75"),
        commands::PET_CTX_MENU_OPACITY_100 => Some("100"),
        _ => None,
    }
}

/// Re-apply the ScreenSaver NSWindow level + collectionBehavior to the `pet`
/// window. Called periodically from a Rust thread (see the `setup` hook below)
/// so the re-apply keeps firing even when the app is backgrounded — WKWebView
/// throttles `setInterval`, but Rust threads are not throttled, so this is the
/// reliable path that prevents macOS from resetting the level on app
/// deactivation (which lets VS Code cover the pet).
///
/// Must run on the macOS main thread (NSWindow API is main-thread-only). The
/// caller schedules this via `app.run_on_main_thread`. Re-fetches the window +
/// `ns_window()` fresh each tick (no raw pointer captured across threads).
#[cfg(target_os = "macos")]
fn reapply_pet_topmost(app: &tauri::AppHandle) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;

    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    const KCG_SCREENSAVER_WINDOW_LEVEL_KEY: i32 = 13;

    let Some(window) = app.get_webview_window("pet") else {
        // Pet window not yet created / already destroyed — nothing to do.
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_ptr = ns_window as *mut Object;
    if ns_ptr.is_null() {
        return;
    }
    unsafe {
        let level = CGWindowLevelForKey(KCG_SCREENSAVER_WINDOW_LEVEL_KEY) as isize;
        let _: () = msg_send![ns_ptr, setLevel: level];

        // NSWindowCollectionBehavior for the pet window:
        //   moveToActiveSpace(2) | fullScreenAuxiliary(256)
        //   | fullScreenAllowsTiling(512) = 770
        // moveToActiveSpace — the window follows the active Space; when the
        // user switches to VS Code's fullscreen Space, the pet window moves
        // there. canJoinAllSpaces(1) was tried first but didn't take effect
        // (isOnActiveSpace stayed false over fullscreen VS Code).
        const CB_MOVE_TO_ACTIVE_SPACE: isize = 1 << 1;
        const CB_FULLSCREEN_AUXILIARY: isize = 1 << 8;
        const CB_FULLSCREEN_ALLOWS_TILING: isize = 1 << 9;
        let behavior: isize =
            CB_MOVE_TO_ACTIVE_SPACE | CB_FULLSCREEN_AUXILIARY | CB_FULLSCREEN_ALLOWS_TILING;
        let _: () = msg_send![ns_ptr, setCollectionBehavior: behavior];
        // NOTE: a previous version attempted to force macOS to re-evaluate
        // space membership by calling `orderFrontRegardless` here, and an
        // `orderOut` + `orderFrontRegardless` reorder when `isOnActiveSpace`
        // was false. Both were removed because `orderOut` on a transparent
        // WKWebView-bearing Tauri window raises an Objective-C exception that
        // Rust cannot catch, aborting the process
        // (`fatal runtime error: Rust cannot catch foreign exceptions`).
        // The level + collectionBehavior above are the real mechanism; the
        // aggressive reorder is dropped. Known limitation: the pet may not
        // show over a fullscreen window when `isOnActiveSpace` stays false.
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn reapply_pet_topmost(_app: &tauri::AppHandle) {
    // Non-macOS: no equivalent level API; pet mode is macOS-only at present.
}

/// Re-assert the NSPanel backend's Dock level + collection behavior on the
/// `pet` window. Called from a Rust reapply thread (NOT throttled by
/// WKWebView like the frontend poll) so the pet re-floats over a newly
/// frontmost app within ~one tick of the thread interval. No `panel.show()`
/// — re-ordering an already-shown panel triggers a WKWebView re-composite
/// stall (the original "pet shows late" lag). Mirrors the BongoCat recipe
/// baked into `convert_windows`, but driven periodically instead of once.
#[cfg(target_os = "macos")]
fn reapply_pet_nspanel_level(app: &tauri::AppHandle) {
    use tauri_nspanel::{CollectionBehavior, PanelLevel, ManagerExt};
    // ponytail: NEVER call `to_panel()` here again. Every `to_panel` runs
    // `object_setClass`, and this function runs on a 200ms loop — repeated
    // setClass strips the KVO dynamic subclass the TouchBar finder
    // registers its `nextResponder` observation on, so the finder's next
    // invalidate throws `NSRangeException` ("Cannot remove an observer
    // _NSTouchBarFinderObservation … not registered", crash 2026-09-18
    // 16:58). Re-assert the panel ATTRIBUTES through the panel store
    // instead (idempotent, no class swap): startup converted the pet once
    // and put the PanelHandle in the store; `get_webview_panel` fetches it.
    let Ok(panel) = app.get_webview_panel("pet") else {
        return; // not converted (should not happen — startup converts)
    };
    panel.set_hides_on_deactivate(false);
    panel.set_level(PanelLevel::Dock.value());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()
            .full_screen_auxiliary()
            .into(),
    );
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn reapply_pet_nspanel_level(_app: &tauri::AppHandle) {}

/// Apply the pet window's topmost backend once at startup. Two paths:
///   - NSPanel (default): convert the `pet` window to a real NSPanel
///     (`Dock` level + `nonactivating_panel` + `stationary |
///     move_to_active_space | full_screen_auxiliary`) so it floats over
///     fullscreen apps, AND spawn the 200ms Rust reapply thread
///     (`spawn_nspanel_reapply_thread`) because the resign-active /
///     NSWorkspace observers do NOT fire in accessory mode
///     (`set_dock_visibility(false)`) — only a Rust-thread poll reliably
///     re-asserts the level after app-switch.
///   - Legacy (`FOLYN_PET_PANEL_BACKEND=legacy`): the old NSWindow +
///     ScreenSaver-level + behavior-770 re-apply (`reapply_pet_topmost`).
///
/// The NSPanel path runs SYNCHRONOUSLY (`.setup()` is already on the macOS
/// main thread — matches BongoCat `core/setup/macos.rs:37`, removing the
/// run-loop-tick gap where the pet existed as a stock NSWindow with
/// `alwaysOnTop: false`). The legacy path still dispatches via
/// `run_on_main_thread` to minimize blast radius (its reapply thread expects
/// main-thread scheduling). No-op on non-macOS.
#[cfg(target_os = "macos")]
pub(crate) fn apply_pet_backend_init(app: &tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        pet_panel_macos::convert_windows(app);
        // Burn the extension-tool-panel's "first window" slot invisibly
        // (alpha 0 + ignoresMouse + orderFront) — macOS activates the whole
        // app when the first window of a windowless (pet-mode) app is ordered
        // front; doing it here, during launch, makes the user's first open
        // a plain re-raise with no app switch.
        pet_panel_macos::prewarm_extension_tool_panel(app);
        spawn_nspanel_reapply_thread(app.clone());
    } else {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            reapply_pet_topmost(&app2);
        });
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn apply_pet_backend_init(_app: &tauri::AppHandle) {}

/// Spawn the 500ms re-apply thread for the LEGACY path only. WKWebView
/// throttles `setInterval` when backgrounded, so the frontend's ~800ms poll
/// is unreliable; a Rust thread keeps re-asserting the ScreenSaver level that
/// macOS can reset on app deactivation. The NSPanel path has its own
/// `spawn_nspanel_reapply_thread` (200ms). No-op on non-macOS.
#[cfg(target_os = "macos")]
pub(crate) fn spawn_legacy_reapply_thread(app: tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let app_for_closure = app.clone();
            let _ = app.run_on_main_thread(move || {
                reapply_pet_topmost(&app_for_closure);
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn spawn_legacy_reapply_thread(_app: tauri::AppHandle) {}

/// Spawn the 200ms re-apply thread for the NSPanel path. In accessory mode
/// (`set_dock_visibility(false)`) neither `NSApplicationDidResignActive` nor
/// `NSWorkspaceDidActivateApplication` reliably fires, so the only stable
/// re-assert signal is a Rust-thread poll (not throttled by WKWebView like
/// the frontend `setInterval`). 200ms keeps visible post-switch delay under
/// ~one tick of human perception. No-op on non-macOS / legacy backend.
#[cfg(target_os = "macos")]
fn spawn_nspanel_reapply_thread(app: tauri::AppHandle) {
    if !pet_panel_macos::backend_is_nspanel() {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let app_for_closure = app.clone();
            let _ = app.run_on_main_thread(move || {
                reapply_pet_nspanel_level(&app_for_closure);
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn spawn_nspanel_reapply_thread(_app: tauri::AppHandle) {}
