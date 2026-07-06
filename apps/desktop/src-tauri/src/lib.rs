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

use tauri::Manager;
use tauri::menu::{CheckMenuItem, MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, WindowEvent};

/// Menu item id for the "Desktop Pet Mode" checkable entry in the View submenu.
const PET_MODE_MENU_ID: &str = "pet_mode_toggle";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == PET_MODE_MENU_ID {
                // The check item's state is toggled automatically by muda
                // before this event fires; reflect it onto the pet window.
                let pet = app.get_webview_window("pet");
                if let Some(pet) = pet {
                    let checked = app
                        .menu()
                        .and_then(|menu| menu.get(PET_MODE_MENU_ID))
                        .and_then(|kind| kind.as_check_menuitem().cloned())
                        .and_then(|item| item.is_checked().ok());
                    if let Some(checked) = checked {
                        if checked {
                            let _ = pet.show();
                        } else {
                            let _ = pet.hide();
                        }
                        // Keep settingsStore.petModeEnabled in sync with the
                        // menu-driven visibility change (the frontend listens
                        // for this event; covers the menu/keyboard path).
                        let _ = app.emit("pet://visibility-changed", checked);
                    }
                }
                return;
            }
            // Pet right-click context menu items → emit `pet://menu-action`
            // so the main window's listener (App.tsx) dispatches the action.
            // Native popup menu (issue #1): the menu is built in
            // `commands::pet_show_context_menu` and shown via `popup_menu`.
            if let Some(action) = pet_ctx_menu_action(id) {
                let _ = app.emit(
                    "pet://menu-action",
                    serde_json::json!({ "action": action }),
                );
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

            // View submenu — hosts the checkable "Desktop Pet Mode" entry.
            // Default off; the checkmark syncs with pet window visibility
            // (toggled either from the menu or from the frontend settings).
            let pet_toggle = CheckMenuItem::with_id(
                app,
                PET_MODE_MENU_ID,
                "Desktop Pet Mode",
                true,
                false,
                Some("CmdOrCtrl+Shift+P"),
            )?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&pet_toggle)
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
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::select_directory,
            commands::check_url,
            commands::fetch_url_content,
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
            commands::pet_panel_set_position,
            commands::pet_panel_get_position,
            commands::pet_panel_set_size,
            commands::pet_panel_get_size,
            commands::pet_panel_is_visible,
            commands::pet_set_topmost_level,
            commands::pet_make_transparent,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
