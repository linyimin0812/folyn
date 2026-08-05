use tauri::Manager;

use crate::errors::AppError;

/// Show the topbar "+" menu (New Terminal / New Browser) as a native context
/// menu. A native NSMenu floats above the embedded webview, so opening it
/// doesn't require hiding the web page (unlike an HTML dropdown).
#[tauri::command]
pub fn topbar_plus_menu(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    new_terminal_label: String,
    new_browser_label: String,
) -> Result<(), AppError> {
    use tauri::menu::{ContextMenu, MenuBuilder, MenuItemBuilder};

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

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::from("main window not found".to_string()))?;
    // Position is relative to the window's top-left corner (logical px, which
    // matches CSS pixels from getBoundingClientRect()).
    menu.popup_at(
        window.as_ref().window().clone(),
        tauri::LogicalPosition::new(x, y),
    )
    .map_err(|e| AppError::from(e.to_string()))?;
    Ok(())
}
