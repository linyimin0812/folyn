use tauri::{Manager, PhysicalPosition, PhysicalSize};

use crate::commands::pet_common::*;
use crate::errors::AppError;

/// Show the pet-bubble window. Does NOT steal focus (the window is configured
/// `focus:false` + converted to a `nonactivating_panel` NSPanel, so it appears
/// without deactivating the foreground app). The caller sets position via
/// `pet_bubble_set_position` first so the bubble appears above the pet.
#[tauri::command]
pub async fn pet_bubble_show(app: tauri::AppHandle) -> Result<(), AppError> {
    let bubble = app
        .get_webview_window(PET_BUBBLE_LABEL)
        .ok_or_else(|| "pet-bubble window not found".to_string())?;
    bubble.show().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the pet-bubble window without closing it (stays alive for the next
/// show). Used by the TTL auto-dismiss, the ✕ close button, and after an
/// action button fires `pet://bubble-action`.
#[tauri::command]
pub async fn pet_bubble_hide(app: tauri::AppHandle) -> Result<(), AppError> {
    let bubble = app
        .get_webview_window(PET_BUBBLE_LABEL)
        .ok_or_else(|| "pet-bubble window not found".to_string())?;
    bubble.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Set the pet-bubble window's screen position (physical pixels). The bubble
/// frontend computes a clamped position above the pet (using
/// `get_pet_position` + `pet_get_work_area`) and passes it here.
#[tauri::command]
pub async fn pet_bubble_set_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let bubble = app
        .get_webview_window(PET_BUBBLE_LABEL)
        .ok_or_else(|| "pet-bubble window not found".to_string())?;
    bubble
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Set the pet-bubble window's size (physical pixels). Each built-in template
/// declares its own logical size; the frontend converts to physical and calls
/// this before `pet_bubble_show` so the window matches the rendered card
/// exactly (a 540×280 Cloudia card needs a 540×280 window — the default
/// 320×120 would clip it). Mirrors `pet_panel_set_size`.
#[tauri::command]
pub async fn pet_bubble_set_size(
    app: tauri::AppHandle,
    width: i32,
    height: i32,
) -> Result<(), AppError> {
    let bubble = app
        .get_webview_window(PET_BUBBLE_LABEL)
        .ok_or_else(|| "pet-bubble window not found".to_string())?;
    bubble
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| AppError::from(e.to_string()))
}
