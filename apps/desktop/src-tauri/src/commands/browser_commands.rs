use tauri::Manager;

/// Navigate an embedded webview to a new URL (address-bar navigation).
#[tauri::command]
pub async fn load_url_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    let wv = app
        .get_webview(&label)
        .ok_or_else(|| "webview not found".to_string())?;
    let parsed = tauri::Url::parse(&url).map_err(|e| format!("invalid url: {e}"))?;
    wv.navigate(parsed)
        .map_err(|e| format!("failed to load url: {e}"))
}
