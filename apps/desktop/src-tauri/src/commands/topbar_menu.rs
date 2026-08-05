use tauri::Manager;

use crate::errors::AppError;

/// Resolve the window the topbar dropdown should anchor to.
///
/// This intentionally uses `get_window` (the raw window) rather than
/// `get_webview_window`: Tauri's `is_webview_window()` requires every webview
/// attached to the window to share the window's label, which stops being true
/// the moment a browser tab is opened (`create_webview` attaches `web-*`
/// webviews to the "main" window). `get_webview_window("main")` then returns
/// `None` and the native menu silently never appears — exactly the "+ has no
/// response" regression.
fn resolve_menu_window(app: &tauri::AppHandle, window_label: &str) -> Option<tauri::Window<tauri::Wry>> {
    app.get_window(window_label)
        .or_else(|| app.get_window("main"))
}

/// Show the topbar "+" menu (New Terminal / New Browser) as a native context
/// menu. A native NSMenu floats above the embedded webview, so opening it
/// doesn't require hiding the web page (unlike an HTML dropdown).
///
/// Uses `WebviewWindow::popup_menu_at` — the same path the pet menu uses
/// (`pet_show_context_menu`) — rather than `Menu::popup_at` with an extracted
/// raw window handle, so the menu anchors to the webview's own NSView and
/// opens on the active Space.
#[tauri::command]
pub fn topbar_plus_menu(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    new_terminal_label: String,
    new_browser_label: String,
    window_label: String,
) -> Result<(), AppError> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let new_terminal = MenuItemBuilder::with_id("topbar-new-terminal", &new_terminal_label)
        .build(&app)
        .map_err(|e| AppError::from(e.to_string()))?;
    let new_browser = MenuItemBuilder::with_id("topbar-new-browser", &new_browser_label)
        .build(&app)
        .map_err(|e| AppError::from(e.to_string()))?;
    let menu = MenuBuilder::new(&app)
        .items(&[&new_terminal, &new_browser])
        .build()
        .map_err(|e| AppError::from(e.to_string()))?;

    let window = resolve_menu_window(&app, &window_label)
        .ok_or_else(|| AppError::from(format!("no window found (looked for '{window_label}', 'main')")))?;
    // Position is relative to the window's top-left corner (logical px, which
    // matches CSS pixels from getBoundingClientRect()).
    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(())
}

/// Show the open-files tab list as a native context menu anchored to the
/// TabBar's right-side dropdown button. A native NSMenu floats above the
/// embedded webview, so opening it doesn't hide the currently open webpage
/// (the HTML dropdown was covered by the native webview and required hiding
/// every webview to be usable).
///
/// Each tab is a menu item; picking one emits `app://select-tab` with the tab
/// id so the frontend can activate it without round-tripping through the
/// Rust menu event table.
#[tauri::command]
pub fn topbar_tablist_menu(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    tabs: Vec<serde_json::Value>,
    active_tab_id: String,
    close_all_label: String,
    no_open_files_label: String,
    window_label: String,
) -> Result<(), AppError> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let mut tab_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for tab in &tabs {
        let id = tab.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let name = tab.get("name").and_then(|v| v.as_str()).unwrap_or("(untitled)");
        let item_id = format!("topbar-tab-{id}");
        // Native menus have no rich row markup; prefix the active tab so the
        // current file is still identifiable at a glance.
        let label = if id == active_tab_id {
            format!("● {name}")
        } else {
            name.to_string()
        };
        let item = MenuItem::with_id(&app, item_id, label, true, None::<&str>)
            .map_err(|e| AppError::from(e.to_string()))?;
        tab_items.push(item);
    }
    let empty = if tabs.is_empty() {
        Some(
            MenuItem::with_id(&app, "topbar-tab-empty", no_open_files_label, false, None::<&str>)
                .map_err(|e| AppError::from(e.to_string()))?,
        )
    } else {
        None
    };
    let close_all = MenuItem::with_id(&app, "topbar-tab-close-all", close_all_label, true, None::<&str>)
        .map_err(|e| AppError::from(e.to_string()))?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| AppError::from(e.to_string()))?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    for item in &tab_items {
        items.push(item);
    }
    if let Some(empty) = &empty {
        items.push(empty);
    }
    items.push(&sep);
    items.push(&close_all);

    let menu = Menu::with_items(&app, &items).map_err(|e| AppError::from(e.to_string()))?;

    let window = resolve_menu_window(&app, &window_label)
        .ok_or_else(|| AppError::from(format!("no window found (looked for '{window_label}', 'main')")))?;
    window
        .popup_menu_at(&menu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(())
}
