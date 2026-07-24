use tauri::{Manager, PhysicalPosition, PhysicalSize};

use crate::commands::pet_common::*;
use crate::errors::AppError;

/// Show the pet-corner window. Does NOT steal focus (the window is configured
/// `focus:false` + converted to a `nonactivating_panel` NSPanel, so it appears
/// without deactivating the foreground app). The caller sets size + position
/// via `pet_corner_set_size` / `pet_corner_set_position` first so the toast
/// stack appears at the right corner with no flash at the default origin.
#[tauri::command]
pub async fn pet_corner_show(app: tauri::AppHandle) -> Result<(), AppError> {
    let corner = app
        .get_webview_window(PET_CORNER_LABEL)
        .ok_or_else(|| "pet-corner window not found".to_string())?;
    corner.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the pet-corner window without closing it (stays alive for the next
/// show). Used when the stack empties (auto-hide) or after the user dismisses
/// the last toast.
#[tauri::command]
pub async fn pet_corner_hide(app: tauri::AppHandle) -> Result<(), AppError> {
    let corner = app
        .get_webview_window(PET_CORNER_LABEL)
        .ok_or_else(|| "pet-corner window not found".to_string())?;
    corner.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Set the pet-corner window's screen position (physical pixels). The
/// frontend computes the corner position from `petStore.cornerPlacement` +
/// the work area + the current stack height, converts to physical, and
/// passes it here.
#[tauri::command]
pub async fn pet_corner_set_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let corner = app
        .get_webview_window(PET_CORNER_LABEL)
        .ok_or_else(|| "pet-corner window not found".to_string())?;
    corner
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Set the pet-corner window's size (physical pixels). The frontend
/// recomputes the height as the stack grows/shrinks (N toasts × card height
/// + gaps) and calls this before `pet_corner_show` so the window matches the
/// rendered stack exactly — a 1-toast stack has a short window, a 3-toast
/// stack has a tall window, no empty padding either way.
#[tauri::command]
pub async fn pet_corner_set_size(
    app: tauri::AppHandle,
    width: i32,
    height: i32,
) -> Result<(), AppError> {
    let corner = app
        .get_webview_window(PET_CORNER_LABEL)
        .ok_or_else(|| "pet-corner window not found".to_string())?;
    corner
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| AppError::from(e.to_string()))
}
