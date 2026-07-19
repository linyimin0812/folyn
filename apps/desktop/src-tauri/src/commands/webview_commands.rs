use tauri::Manager;

use crate::errors::AppError;

/// Create an embedded webview in the main window from Rust side.
/// Uses initialization_script to inject JS on every page load (handles target="_blank" links).
#[tauri::command]
pub async fn create_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    user_agent: String,
) -> Result<(), AppError> {
    use tauri::webview::WebviewBuilder;
    use tauri::{LogicalPosition, LogicalSize};

    let window = app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    // JS injected on every page load — handles target="_blank" links, URL change tracking, and blank page detection
    let init_script = format!(r#"
        (function() {{
            if (window.__tauriLinkHandlerInstalled) return;
            window.__tauriLinkHandlerInstalled = true;

            var webviewLabel = "{}";

            // Notify the host app about URL changes
            function notifyUrlChange() {{
                try {{
                    var url = window.location.href;
                    var title = document.title || url;
                    if (window.__TAURI__ && window.__TAURI__.core) {{
                        window.__TAURI__.core.invoke('on_webview_url_changed', {{
                            label: webviewLabel,
                            url: url,
                            title: title
                        }});
                    }}
                }} catch(e) {{}}
            }}

            // Intercept pushState / replaceState to detect SPA navigations
            var origPush = history.pushState;
            var origReplace = history.replaceState;
            history.pushState = function() {{
                origPush.apply(this, arguments);
                notifyUrlChange();
            }};
            history.replaceState = function() {{
                origReplace.apply(this, arguments);
                notifyUrlChange();
            }};

            // Listen for popstate (browser back/forward)
            window.addEventListener('popstate', notifyUrlChange);

            // Listen for hashchange
            window.addEventListener('hashchange', notifyUrlChange);

            // Notify on initial load and after full page navigations
            if (document.readyState === 'complete') {{
                notifyUrlChange();
            }} else {{
                window.addEventListener('load', notifyUrlChange);
            }}

            // Intercept clicks on links with target="_blank" to navigate in-place
            document.addEventListener('click', function(e) {{
                var el = e.target;
                while (el && el.tagName !== 'A') el = el.parentElement;
                if (!el || !el.href) return;
                if (el.target === '_blank' || el.target === '_new') {{
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = el.href;
                }}
            }}, true);

            // Detect blank pages and show a friendly message
            setTimeout(function() {{
                var body = document.body;
                if (!body) return;
                var text = (body.innerText || '').trim();
                var children = body.children.length;
                if (text.length === 0 && children === 0) {{
                    document.documentElement.style.background = '#1e1e2e';
                    body.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1e1e2e;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
                    body.innerHTML = '<div style="text-align:center;max-width:400px;padding:20px;">'
                        + '<div style="font-size:48px;margin-bottom:16px;">🌐</div>'
                        + '<h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#cdd6f4;">页面无法显示</h2>'
                        + '<p style="margin:0;font-size:14px;color:#a6adc8;">此页面可能不支持在应用内嵌入显示。</p>'
                        + '<p style="margin:8px 0 0;font-size:12px;color:#6c7086;">请使用顶部按钮在浏览器中打开。</p>'
                        + '</div>';
                }}
            }}, 2000);
        }})();
    "#, label);

    let builder = WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url))
        .user_agent(&user_agent)
        .auto_resize()
        .initialization_script(init_script);

    window.as_ref().window().add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    ).map_err(|e| format!("Failed to create webview: {}", e))?;

    Ok(())
}

/// Navigate an embedded webview (back / forward / reload).
#[tauri::command]
pub async fn navigate_webview(app: tauri::AppHandle, label: String, action: String) -> Result<(), AppError> {
    let wv = app.get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let js = match action.as_str() {
        "back" => "history.back();",
        "forward" => "history.forward();",
        "reload" => "location.reload();",
        _ => return Err(format!("Unknown action: {}", action).into()),
    };
    wv.eval(js).map_err(|e| AppError::from(e.to_string()))
}

/// Close an embedded webview by label.
#[tauri::command]
pub async fn close_webview(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide an embedded webview by label (move off-screen to keep it alive but invisible).
#[tauri::command]
pub async fn hide_webview(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    use tauri::LogicalPosition;
    use tauri::LogicalSize;

    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_position(LogicalPosition::new(-10000.0, -10000.0));
        let _ = wv.set_size(LogicalSize::new(1.0, 1.0));
    }
    Ok(())
}

/// Show an embedded webview by label (restore visibility - position will be set by frontend).
#[tauri::command]
pub async fn show_webview(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    if let Some(wv) = app.get_webview(&label) {
        // Just make it visible again - the frontend will call set_webview_position
        // to restore the correct position and size
        let _ = wv.set_size(tauri::LogicalSize::new(1.0, 1.0));
    }
    Ok(())
}

/// Reposition an embedded webview.
#[tauri::command]
pub async fn set_webview_position(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), AppError> {
    use tauri::LogicalPosition;
    use tauri::LogicalSize;

    if let Some(wv) = app.get_webview(&label) {
        wv.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        wv.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Receive URL change notification from an embedded webview and emit it to the frontend.
#[tauri::command]
pub async fn on_webview_url_changed(
    app: tauri::AppHandle,
    label: String,
    url: String,
    title: String,
) -> Result<(), AppError> {
    use tauri::Emitter;

    app.emit("webview-url-changed", serde_json::json!({
        "label": label,
        "url": url,
        "title": title,
    })).map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide specific embedded webviews by labels — used when switching tabs.
/// Accepts a list of labels from the frontend since child webviews are not
/// enumerable via webview_windows() in Tauri v2.
#[tauri::command]
pub async fn hide_all_webviews(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), AppError> {
    use tauri::LogicalPosition;
    use tauri::LogicalSize;

    for label in labels {
        if let Some(wv) = app.get_webview(&label) {
            let _ = wv.set_position(LogicalPosition::new(-10000.0, -10000.0));
            let _ = wv.set_size(LogicalSize::new(1.0, 1.0));
        }
    }
    Ok(())
}

