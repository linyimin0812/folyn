// `objc 0.2` (transitive via `cocoa`) emits `cfg(cargo-clippy)` inside its
// `msg_send!` / `class!` macros — an old clippy-detection hack that Rust
// 1.80+'s check-cfg flags as an unknown cfg. The macro expansion is
// attributed to the `objc` crate (not our call site), so function-level
// `#[allow]` does not suppress it. Crate-level allow is the only effective
// scope. Upgrade `objc` to `objc2` would also fix it but is a larger change
// (Tauri 2's macOS backend uses `objc2` internally already; we add `cocoa`
// only for `NSScreen.visibleFrame` FFI).
#![allow(unexpected_cfgs)]

mod commands;
pub mod errors;
mod plugin_commands;
mod chat;
mod list_models;
mod voice;
mod pet_api;

#[cfg(target_os = "macos")]
mod pet_panel_macos;

use tauri::Manager;
use tauri::{Emitter, WindowEvent};

/// Maps a pet context-menu item id (see `commands::PET_CTX_MENU_*`) to the
/// `PetMenuAction` payload the main window expects. Returns `None` for
/// unknown ids (e.g. separators, which never fire `on_menu_event`).
///
/// The mapping also recognizes the 5 launcher-only actions
/// (`daily-note`, `global-search`, `clip-from-url`, `command-palette`,
/// `toggle-theme`) even though they are not in the native right-click menu —
/// the pet-panel launcher dispatches them via the same `pet://menu-action`
/// event channel, and the frontend contract test asserts the full set stays
/// in sync. Returning the action unchanged here keeps the event payload
/// stable for any future caller that routes through `on_menu_event`.
fn pet_ctx_menu_action(id: &str) -> Option<&'static str> {
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
        "pet-ctx-daily-note" => Some("daily-note"),
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
fn pet_ctx_menu_size_level(id: &str) -> Option<&'static str> {
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
fn pet_ctx_menu_opacity_level(id: &str) -> Option<&'static str> {
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
    use tauri::Manager;
    use tauri_nspanel::{CollectionBehavior, PanelLevel, WebviewWindowExt};

    let Some(window) = app.get_webview_window("pet") else {
        return;
    };
    let Ok(panel) = window.to_panel::<crate::pet_panel_macos::QuillPetPanel>() else {
        return;
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
///   - Legacy (`QUILL_PET_PANEL_BACKEND=legacy`): the old NSWindow +
///     ScreenSaver-level + behavior-770 re-apply (`reapply_pet_topmost`).
///
/// The NSPanel path runs SYNCHRONOUSLY (`.setup()` is already on the macOS
/// main thread — matches BongoCat `core/setup/macos.rs:37`, removing the
/// run-loop-tick gap where the pet existed as a stock NSWindow with
/// `alwaysOnTop: false`). The legacy path still dispatches via
/// `run_on_main_thread` to minimize blast radius (its reapply thread expects
/// main-thread scheduling). No-op on non-macOS.
#[cfg(target_os = "macos")]
fn apply_pet_backend_init(app: &tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        pet_panel_macos::convert_windows(app);
        spawn_nspanel_reapply_thread(app.clone());
    } else {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            reapply_pet_topmost(&app2);
        });
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_pet_backend_init(_app: &tauri::AppHandle) {}

/// Spawn the 500ms re-apply thread for the LEGACY path only. WKWebView
/// throttles `setInterval` when backgrounded, so the frontend's ~800ms poll
/// is unreliable; a Rust thread keeps re-asserting the ScreenSaver level that
/// macOS can reset on app deactivation. The NSPanel path has its own
/// `spawn_nspanel_reapply_thread` (200ms). No-op on non-macOS.
#[cfg(target_os = "macos")]
fn spawn_legacy_reapply_thread(app: tauri::AppHandle) {
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
fn spawn_legacy_reapply_thread(_app: tauri::AppHandle) {}

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
fn spawn_nspanel_reapply_thread(_app: tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── quill-plugin:// URI scheme ──
        // Registered ONCE at startup (register_uri_scheme_protocol is on
        // tauri::Builder and consumes self — cannot add schemes at runtime).
        // Dispatches by path: quill-plugin://localhost/<id>/<file> reads from
        // ~/.quill/plugins/<id>/<file>. Each response carries a per-plugin CSP
        // header so sandbox plugins cannot reach the network or the host DOM
        // without going through the postMessage RPC bridge.
        //
        // POST `<id>/rpc` is the fetch-RPC endpoint for tool windows: plugin
        // JS does `fetch('quill-plugin://localhost/<id>/rpc', { method:
        // 'POST', body })` and the handler emits a `plugin-rpc-request` event
        // that the main webview's `toolWindowRpcListener` dispatches through
        // the shared `dispatchPluginRpc`. Async responder lets us wait for the
        // round-trip without blocking the webview thread.
        .register_asynchronous_uri_scheme_protocol("quill-plugin", |ctx, request, responder| {
            use plugin_commands::{
                content_type_for, handle_plugin_rpc_request, next_rpc_request_id,
                parse_plugin_uri, plugins_dir, PLUGIN_CSP,
            };

            let uri_path = request.uri().path().to_string();
            let (id, file_path) = match parse_plugin_uri(&uri_path) {
                Some(v) => v,
                None => {
                    responder.respond(
                        http::Response::builder()
                            .status(400)
                            .body(b"invalid plugin uri".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"invalid plugin uri".to_vec())),
                    );
                    return;
                }
            };

            // POST `<id>/rpc` → fetch-RPC bridge.
            if request.method() == "POST" && (file_path == "rpc" || file_path.ends_with("/rpc")) {
                let body = String::from_utf8_lossy(request.body()).to_string();
                let request_id = next_rpc_request_id();
                let app = ctx.app_handle().clone();
                handle_plugin_rpc_request(app, request_id, id, body, responder);
                return;
            }

            // GET path: serve static asset from disk.
            if file_path.is_empty() {
                responder.respond(
                    http::Response::builder()
                        .status(404)
                        .body(b"not found".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                );
                return;
            }

            let dir = match plugins_dir(ctx.app_handle()) {
                Ok(d) => d,
                Err(e) => {
                    responder.respond(
                        http::Response::builder()
                            .status(500)
                            .body(e.as_bytes().to_vec())
                            .unwrap_or_else(|_| http::Response::new(e.as_bytes().to_vec())),
                    );
                    return;
                }
            };

            let file_full = dir.join(&id).join(&file_path);

            // Defense-in-depth: canonicalize and verify the resolved path is
            // still within the plugin's directory (prevents symlinks from
            // escaping).
            let canonical = match file_full.canonicalize() {
                Ok(c) => c,
                Err(_) => {
                    responder.respond(
                        http::Response::builder()
                            .status(404)
                            .body(b"not found".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                    );
                    return;
                }
            };
            let plugin_root = dir.join(&id);
            let plugin_root = match plugin_root.canonicalize() {
                Ok(c) => c,
                Err(_) => dir.join(&id),
            };
            if !canonical.starts_with(&plugin_root) {
                responder.respond(
                    http::Response::builder()
                        .status(403)
                        .body(b"forbidden".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"forbidden".to_vec())),
                );
                return;
            }

            let bytes = match std::fs::read(&canonical) {
                Ok(b) => b,
                Err(_) => {
                    responder.respond(
                        http::Response::builder()
                            .status(404)
                            .body(b"not found".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                    );
                    return;
                }
            };

            let ct = content_type_for(&file_path);
            responder.respond(
                http::Response::builder()
                    .status(200)
                    .header("Content-Type", ct)
                    .header("Content-Security-Policy", PLUGIN_CSP)
                    .body(bytes)
                    .unwrap_or_else(|_| http::Response::new(b"error".to_vec())),
            );
        })
        .plugin(tauri_plugin_shell::init())
        // OS native notifications (PRD pet-popup-bubble-notification: system
        // notification form). The main window's dispatcher calls the plugin's
        // JS API (`sendNotification`/`registerActionTypes`/`onAction`);
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Global keyboard shortcut plugin. A single global handler dispatches
        // by HotKey id: the voice toggle HotKey (stored in
        // `VoiceState::voice_hotkey` by `voice_set_global_hotkey`) emits
        // `voice://hotkey-toggle` on Pressed only (toggle semantics — first
        // press starts recording, second press stops; mirrors openless
        // `qa_hotkey.rs` which filters to `HotKeyState::Pressed` and lets the
        // coordinator interpret press #1 vs #2), and any OTHER registered
        // HotKey (currently the pet-panel toggle managed by
        // `pet_panel_set_shortcut`) emits `pet://shortcut-toggle` on Pressed. WHICH accelerator fires each is swapped at runtime by
        // the respective `*_set_shortcut` commands; this closure only decides
        // the routing. Pet mode is macOS-only at present, but the plugin loads
        // on all platforms — non-macOS just never has an accelerator registered
        // until the frontend calls a command. No ACL capability entry is
        // needed: the frontend never invokes the plugin's built-in commands
        // directly, only our custom `pet_panel_set_shortcut` +
        // `voice_set_global_hotkey` (custom invoke bypasses the ACL).
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    log::info!("[voice] shortcut handler fired: shortcut={:?} state={:?}", shortcut, event.state);
                    // Voice toggle HotKey? Read the stored voice HotKey from
                    // VoiceState and compare. The stored value is `Copy` so a
                    // brief uncontended lock suffices. Unwrap-to-None on a
                    // poisoned lock so a poisoned lock never breaks the
                    // pet-panel toggle. Toggle mode: only Pressed fires —
                    // Released is dropped (openless parity).
                    let voice_hotkey = app
                        .state::<voice::VoiceState>()
                        .voice_hotkey();
                    let is_voice = voice_hotkey
                        .map(|vh| vh == *shortcut)
                        .unwrap_or(false);
                    if is_voice && event.state == ShortcutState::Pressed {
                        let _ = app.emit("voice://hotkey-toggle", ());
                        return;
                    }
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("pet://shortcut-toggle", ());
                    }
                })
                .build(),
        )
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            // Manual fullscreen toggle for the focused plugin tool window
            // (Window menu → "插件弹窗全屏", ⌘⇧F). Tool windows are pinned
            // (alwaysOnTop), which macOS blocks from entering native
            // fullscreen — so drop the pinned level before entering and
            // restore it once the user leaves fullscreen.
            if id == "plugin-tool-fullscreen" {
                if let Some((label, win)) = app
                    .webview_windows()
                    .iter()
                    .find(|(l, w)| l.starts_with("plugin-tool-") && w.is_focused().unwrap_or(false))
                {
                    let already_fullscreen = win.is_fullscreen().unwrap_or(false);
                    if already_fullscreen {
                        let _ = win.set_fullscreen(false);
                    } else {
                        let _ = win.set_always_on_top(false);
                        let _ = win.set_fullscreen(true);
                        let app2 = app.clone();
                        let label2 = label.clone();
                        // Restore the pinned level as soon as fullscreen
                        // exits (poll — macOS native fullscreen transitions
                        // don't surface a dedicated Tauri event).
                        tauri::async_runtime::spawn(async move {
                            loop {
                                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                                let Some(win) = app2.get_webview_window(&label2) else {
                                    return;
                                };
                                if !win.is_fullscreen().unwrap_or(false) {
                                    let _ = win.set_always_on_top(true);
                                    return;
                                }
                            }
                        });
                    }
                }
                return;
            }
            // Pet tray menu items → emit `pet://menu-action` so the main
            // window's listener (App.tsx) dispatches the action. The tray
            // menu is built in `commands::build_pet_context_menu` (called
            // by `tray_set_enabled`) and shown by the OS tray.
            if let Some(action) = pet_ctx_menu_action(id) {
                // The size submenu items all map to `set-pet-size`; attach
                // the `{ size }` payload so the frontend applies the right
                // level without re-parsing the menu id.
                if action == "set-pet-size" {
                    if let Some(level) = pet_ctx_menu_size_level(id) {
                        // Update the shared state so the next menu build
                        // pre-checks the new size radio item even before
                        // the frontend's `set_pet_size` invoke lands.
                        app.state::<commands::PetSizeState>().set_level(level);
                        let _ = app.emit(
                            "pet://menu-action",
                            serde_json::json!({ "action": action, "size": level }),
                        );
                    }
                } else if action == "set-pet-opacity" {
                    if let Some(level) = pet_ctx_menu_opacity_level(id) {
                        // Update the shared state so the next menu build
                        // pre-checks the new opacity radio item even before
                        // the frontend's `set_pet_opacity` invoke lands.
                        app.state::<commands::PetOpacityState>().set_level(level);
                        let _ = app.emit(
                            "pet://menu-action",
                            serde_json::json!({ "action": action, "opacity": level }),
                        );
                    }
                } else if action == "toggle-pet-click-through" {
                    // Toggle the shared bool so the next menu build flips
                    // the checkmark even before the frontend's invoke lands.
                    let next = !app.state::<commands::PetClickThroughState>().enabled();
                    app.state::<commands::PetClickThroughState>().set_enabled(next);
                    let _ = app.emit(
                        "pet://menu-action",
                        serde_json::json!({ "action": action, "clickThrough": next }),
                    );
                } else {
                    let _ = app.emit(
                        "pet://menu-action",
                        serde_json::json!({ "action": action }),
                    );
                }
            }
        })
        // R8 (lifecycle): when pet mode is on, closing the main editor window
        // must NOT quit the app — the pet is a persistent entry point. So we
        // intercept the main window's close request and just hide it. When
        // pet mode is off, default close behavior (app quit) is preserved.
        // The pet window's visibility is the source of truth for "pet mode
        // active right now", so we don't need a separate cached flag.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let pet_on = window
                    .app_handle()
                    .get_webview_window("pet")
                    .and_then(|p| p.is_visible().ok())
                    .unwrap_or(false);
                if pet_on {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // else: default close → app exits (cleanup of pet window is
                // automatic since it's a child of the app process).
            }
        })
        .setup(|app| {
            // Shared pet-size state ("50"|"75"|"100"|"125"|"150"). Synced from
            // the frontend via `set_pet_size` and from `on_menu_event` on a
            // native submenu pick. Read by `build_pet_context_menu` to
            // pre-check the current size radio item. Defaults to `"100"`
            // so existing users keep the 96×96 layout on first right-click.
            app.manage(commands::PetSizeState(std::sync::Mutex::new(
                commands::PetSizeState::DEFAULT_LEVEL.to_string(),
            )));

            // Shared pet-opacity state ("25"|"50"|"75"|"100"). Same pattern
            // as `PetSizeState`: defaults to "100" (fully opaque) so existing
            // users keep the pre-opacity look on first right-click.
            app.manage(commands::PetOpacityState(std::sync::Mutex::new(
                commands::PetOpacityState::DEFAULT_LEVEL.to_string(),
            )));

            // Shared pet-click-through flag (bool). Defaults to `false` so
            // the pet receives clicks (pre-feature behavior) on first launch.
            app.manage(commands::PetClickThroughState(std::sync::Mutex::new(
                commands::PetClickThroughState::DEFAULT,
            )));

            // Shared handle to the tray menu's `hide_pet` CheckMenuItem so
            // `toggle_pet_mode` / `show_pet_if_hidden` can `set_checked` after
            // each visibility flip — the tray menu is built once at
            // `tray_set_enabled` time and muda does not auto-toggle the
            // checkmark on click. `None` until `tray_set_enabled(true)` runs.
            app.manage(commands::TrayHidePetItemState(std::sync::Mutex::new(None)));

            // Pet-panel global-shortcut state. Holds the currently-registered
            // pet HotKey so `pet_panel_set_shortcut` can do a TARGETED
            // unregister (not `unregister_all`, which would wipe the voice
            // toggle HotKey registered by `voice::voice_set_global_hotkey`).
            app.manage(commands::PetShortcutState::new());

            // Voice input shared state (PR2). Holds the live `Recorder` +
            // `AppleSpeechAsr` consumer between `voice_start` and
            // `voice_stop` / `voice_cancel`. Idle on non-macOS (commands
            // there return macOS-only errors). See `voice::VoiceState`.
            app.manage(voice::VoiceState::new());
            // Startup beacon: confirms `log stream --predicate 'process == "quill"'`
            // is wired before the user touches voice. If this line shows in the
            // log stream, the predicate works; if not, the user is filtering on
            // the wrong process name (dev .app's executable is `quill`, lowercase).
            log::info!("[voice] module ready; bundle_id={}", "com.quill.editor");

            // External pet notify API (pet-external-notify-api). Local HTTP
            // server on 127.0.0.1; reuses the `pet://notify` dispatcher. State
            // holds the actual bound port for the settings-page UI; the server
            // thread writes it on bind. Non-fatal if no port is free.
            app.manage(pet_api::PetApiState(std::sync::Mutex::new(None)));
            pet_api::spawn(app.handle().clone());

            // ponytail: app menu bar built via `commands::build_app_menu` so
            // the same path serves the bootstrap build (here, locale="en") and
            // the locale-switch rebuild (`pet_rebuild_app_menu`). The frontend
            // hydrates `localeStore` after the JS realm starts and calls
            // `pet_rebuild_app_menu` with the user's actual locale; until then
            // the menu bar shows the English defaults.
            commands::build_app_menu(app.handle(), "en")?;

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // ponytail: Dock stays visible. The previous `set_dock_visibility(false)`
            // put the app into accessory activation policy so the pet would float
            // over fullscreen VS Code without a click — but accessory mode also
            // disables macOS native fullscreen (green traffic-light + Window >
            // Enter Full Screen). User-chosen trade-off: green-button
            // fullscreen wins, pet-over-fullscreen-app loses. If pet visibility
            // over fullscreen apps becomes a requirement again, re-add this call
            // and document the fullscreen trade-off in tauri-window-patterns.md.

            // Apply the pet window's topmost backend at creation (before the
            // first show) so macOS evaluates space membership with the flags
            // already set. NSPanel path converts the window to a real NSPanel
            // (Dock level + fullscreen-auxiliary collectionBehavior); legacy
            // path applies the ScreenSaver level + behavior 770 and spawns a
            // 500ms re-apply thread. See `apply_pet_backend_init` /
            // `spawn_legacy_reapply_thread`.
            let app_handle = app.handle().clone();
            apply_pet_backend_init(&app_handle);
            spawn_legacy_reapply_thread(app_handle);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::check_url,
            commands::create_webview,
            commands::navigate_webview,
            commands::close_webview,
            commands::hide_webview,
            commands::show_webview,
            commands::set_webview_position,
            commands::hide_all_webviews,
            commands::on_webview_url_changed,
            commands::load_url_webview,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::import_chrome_cookies,
            commands::apply_imported_cookies,
            commands::has_imported_cookies,
            commands::import_chrome_passwords,
            commands::save_imported_passwords,
            commands::load_imported_passwords,
            commands::clear_imported_passwords,
            commands::fill_webview_credentials,
            commands::git_clone,
            commands::get_project_overview,
            commands::remove_dir,
            commands::toggle_pet_mode,
            commands::show_pet_if_hidden,
            commands::set_pet_position,
            commands::get_pet_position,
            commands::pet_cursor_probe,
            commands::pet_rebuild_app_menu,
            commands::pet_set_cursor,
            commands::pet_get_work_area,
            commands::pet_panel_show,
            commands::pet_panel_hide,
            commands::pet_panel_set_shortcut,
            commands::pet_panel_set_position,
            commands::pet_panel_get_position,
            commands::pet_panel_set_size,
            commands::pet_panel_get_size,
            commands::pet_panel_is_visible,
            commands::pet_bubble_show,
            commands::pet_bubble_hide,
            commands::pet_bubble_set_position,
            commands::pet_bubble_set_size,
            commands::pet_window_scale,
            commands::pet_menu_show,
            commands::pet_menu_hide,
            commands::pet_menu_set_position,
            commands::pet_menu_set_size,
            commands::pet_corner_show,
            commands::pet_corner_hide,
            commands::pet_corner_set_position,
            commands::pet_corner_set_size,
            commands::pet_set_topmost_level,
            commands::pet_make_transparent,
            commands::set_pet_size,
            commands::set_pet_opacity,
            commands::set_pet_click_through,
            commands::exit_app,
            commands::tray_set_enabled,
            pet_api::get_pet_api_info,
            pet_api::open_external,
            chat::chat_stream,
            list_models::list_models,
            plugin_commands::install_plugin,
            plugin_commands::install_plugin_zip,
            plugin_commands::list_plugins,
            plugin_commands::uninstall_plugin,
            plugin_commands::approve_plugin,
            plugin_commands::get_plugin_record,
            plugin_commands::read_plugin_file,
            plugin_commands::grant_plugin_capabilities,
            plugin_commands::verify_plugin_signature_cmd,
            plugin_commands::plugin_http_fetch,
            plugin_commands::fetch_url,
            plugin_commands::plugin_rpc_respond,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::voice_insert_text,
            voice::voice_request_accessibility,
            voice::voice_request_microphone,
            voice::voice_request_speech,
            voice::voice_set_global_hotkey,
            voice::voice_orb_hide,
            voice::voice_debug_frontmost,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                commands::terminal_kill_all();
            }
            // OS "Open With" / file-association launch (macOS/iOS/Android).
            // When the user opens a file with Quill from Finder/Explorer, the
            // OS hands us the resource as a `file://` URL here. Convert to a
            // filesystem path and emit it to the frontend, which opens it as
            // an external (vault-independent) editor tab. Also surface the
            // main window in case the app was backgrounded.
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok().map(|p| p.to_string_lossy().into_owned()))
                    .collect();
                if !paths.is_empty() {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("app://open-external-file", paths);
                }
            }
            // ponytail: macOS dock-click reopen. When the main window is
            // hidden (pet-mode close-to-hide path) and the user clicks the
            // dock icon, AppKit fires applicationShouldHandleReopen; Tauri
            // surfaces it as RunEvent::Reopen. Without this, the dock click
            // does nothing — the app is alive but no window comes forward.
            tauri::RunEvent::Reopen { .. } => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
            _ => {}
        });
}
