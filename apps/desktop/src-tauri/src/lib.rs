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
mod plugin_commands;

#[cfg(target_os = "macos")]
mod pet_panel_macos;

use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
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
        commands::PET_CTX_MENU_NEW_NOTE => Some("new-note"),
        commands::PET_CTX_MENU_TOGGLE_AI => Some("toggle-ai"),
        commands::PET_CTX_MENU_HIDE_PET => Some("hide-pet"),
        commands::PET_CTX_MENU_SIZE_SMALL => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_MEDIUM => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_LARGE => Some("set-pet-size"),
        commands::PET_CTX_MENU_DISABLE_PET => Some("disable-pet"),
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
        commands::PET_CTX_MENU_SIZE_SMALL => Some("small"),
        commands::PET_CTX_MENU_SIZE_MEDIUM => Some("medium"),
        commands::PET_CTX_MENU_SIZE_LARGE => Some("large"),
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

/// Apply the pet window's topmost backend once at startup. Two paths:
///   - NSPanel (default): convert the `pet` window to a real NSPanel
///     (`Dock` level + `nonactivating_panel` + `can_join_all_spaces |
///     full_screen_auxiliary`) so it floats over fullscreen apps.
///   - Legacy (`QUILL_PET_PANEL_BACKEND=legacy`): the old NSWindow +
///     ScreenSaver-level + behavior-780 re-apply (`reapply_pet_topmost`).
///
/// Both paths schedule their NSWindow API calls on the macOS main thread via
/// `run_on_main_thread` (NSWindow API is main-thread-only). No-op on non-macOS.
#[cfg(target_os = "macos")]
fn apply_pet_backend_init(app: &tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            pet_panel_macos::convert_windows(&app2);
        });
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
/// macOS can reset on app deactivation. The NSPanel path does NOT need this
/// (Dock level + `nonactivating_panel` + `hidesOnDeactivate`-default is
/// stable across activation changes). No-op on non-macOS.
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
        .register_uri_scheme_protocol("quill-plugin", |ctx, request| {
            use plugin_commands::{content_type_for, parse_plugin_uri, plugins_dir, PLUGIN_CSP};

            let uri_path = request.uri().path();
            let (id, file_path) = match parse_plugin_uri(uri_path) {
                Some(v) => v,
                None => {
                    return http::Response::builder()
                        .status(400)
                        .body(b"invalid plugin uri".to_vec())
                        .unwrap_or_else(|_| {
                            http::Response::new(b"invalid plugin uri".to_vec())
                        });
                }
            };

            if file_path.is_empty() {
                return http::Response::builder()
                    .status(404)
                    .body(b"not found".to_vec())
                    .unwrap_or_else(|_| http::Response::new(b"not found".to_vec()));
            }

            let dir = match plugins_dir(ctx.app_handle()) {
                Ok(d) => d,
                Err(e) => {
                    return http::Response::builder()
                        .status(500)
                        .body(e.as_bytes().to_vec())
                        .unwrap_or_else(|_| http::Response::new(e.as_bytes().to_vec()));
                }
            };

            let file_full = dir.join(&id).join(&file_path);

            // Defense-in-depth: canonicalize and verify the resolved path is
            // still within the plugin's directory (prevents symlinks from
            // escaping).
            let canonical = match file_full.canonicalize() {
                Ok(c) => c,
                Err(_) => {
                    return http::Response::builder()
                        .status(404)
                        .body(b"not found".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"not found".to_vec()));
                }
            };
            let plugin_root = dir.join(&id);
            let plugin_root = match plugin_root.canonicalize() {
                Ok(c) => c,
                Err(_) => dir.join(&id),
            };
            if !canonical.starts_with(&plugin_root) {
                return http::Response::builder()
                    .status(403)
                    .body(b"forbidden".to_vec())
                    .unwrap_or_else(|_| http::Response::new(b"forbidden".to_vec()));
            }

            let bytes = match std::fs::read(&canonical) {
                Ok(b) => b,
                Err(_) => {
                    return http::Response::builder()
                        .status(404)
                        .body(b"not found".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"not found".to_vec()));
                }
            };

            let ct = content_type_for(&file_path);
            http::Response::builder()
                .status(200)
                .header("Content-Type", ct)
                .header("Content-Security-Policy", PLUGIN_CSP)
                .body(bytes)
                .unwrap_or_else(|_| http::Response::new(b"error".to_vec()))
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Global keyboard shortcut plugin. A single global handler emits
        // `pet://shortcut-toggle` on every Pressed event; WHICH accelerator
        // fires it is swapped at runtime by the `pet_panel_set_shortcut`
        // command (unregister_all + register). Pet mode is macOS-only at
        // present, but the plugin loads on all platforms — non-macOS just
        // never has an accelerator registered until the frontend calls the
        // command. No ACL capability entry is needed: the frontend never
        // invokes the plugin's built-in commands directly, only our custom
        // `pet_panel_set_shortcut` (custom invoke bypasses the ACL).
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("pet://shortcut-toggle", ());
                    }
                })
                .build(),
        )
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            // Pet right-click context menu items → emit `pet://menu-action`
            // so the main window's listener (App.tsx) dispatches the action.
            // Native popup menu (issue #1): the menu is built in
            // `commands::pet_show_context_menu` and shown via `popup_menu`.
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
            // Shared pet-size state ("small"|"medium"|"large"). Synced from
            // the frontend via `set_pet_size` and from `on_menu_event` on a
            // native submenu pick. Read by `pet_show_context_menu` to
            // pre-check the current size radio item. Defaults to `"medium"`
            // so existing users keep the 96×96 layout on first right-click.
            app.manage(commands::PetSizeState(std::sync::Mutex::new(
                commands::PetSizeState::DEFAULT_LEVEL.to_string(),
            )));

            let app_menu = SubmenuBuilder::new(app, "Quill")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .separator()
                .fullscreen()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

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
            commands::git_clone,
            commands::get_project_overview,
            commands::remove_dir,
            commands::toggle_pet_mode,
            commands::set_pet_position,
            commands::get_pet_position,
            commands::pet_cursor_probe,
            commands::pet_show_context_menu,
            commands::pet_get_work_area,
            commands::pet_panel_show,
            commands::pet_panel_hide,
            commands::pet_panel_set_shortcut,
            commands::pet_panel_set_position,
            commands::pet_panel_get_position,
            commands::pet_panel_set_size,
            commands::pet_panel_get_size,
            commands::pet_panel_is_visible,
            commands::pet_set_topmost_level,
            commands::pet_make_transparent,
            commands::set_pet_size,
            plugin_commands::install_plugin,
            plugin_commands::list_plugins,
            plugin_commands::uninstall_plugin,
            plugin_commands::approve_plugin,
            plugin_commands::get_plugin_record,
            plugin_commands::read_plugin_file,
            plugin_commands::grant_plugin_capabilities,
            plugin_commands::verify_plugin_signature_cmd,
            plugin_commands::plugin_http_fetch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
