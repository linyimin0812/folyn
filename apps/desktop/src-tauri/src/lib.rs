mod commands;

#[cfg(debug_assertions)]
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
