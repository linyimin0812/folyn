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

    // Seed freshly created browser webviews with cookies imported earlier
    // from Chrome (if any).
    super::browser_commands::apply_imported_cookies_to_label(&app, &label);

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

/// Whether the main window should be restored to fullscreen on its next
/// show. Set by the app-level `on_window_event` handler when the pet-mode
/// close-to-hide path hides the main window while it was fullscreen, and
/// consumed (cleared) by the same handler's `Focused(true)` branch when the
/// window comes back (dock reopen, pet "show-main", open-file, ...).
pub struct MainWindowFullscreenRestore(std::sync::Mutex<bool>);

impl MainWindowFullscreenRestore {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(false))
    }

    pub fn set(&self, fullscreen: bool) {
        if let Ok(mut m) = self.0.lock() {
            *m = fullscreen;
        }
    }

    pub fn take(&self) -> bool {
        self.0
            .lock()
            .map(|mut m| std::mem::take(&mut *m))
            .unwrap_or(false)
    }
}

/// The fullscreen mode a plugin tool window is in / was last closed in.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ToolFullscreenMode {
    /// macOS native fullscreen — a separate Space (standard Window menu
    /// "Enter Full Screen" ⌃⌘F). Closing it requires exiting the Space first
    /// (see the app-level `on_window_event` handler in lib.rs).
    Native,
    /// macOS simple fullscreen — pre-Lion style, no separate Space (Window
    /// menu "插件弹窗全屏" ⌘⇧F). Closing it is a plain teardown: there is no
    /// Space transition, so no black flash.
    Simple,
}

/// Per-tool fullscreen memory for plugin tool windows (multi-instance).
///
/// Two maps:
/// - `fullscreen_pref` — keyed by the counter-less tool key
///   `plugin-tool-<plugin>-<tool>`, records the mode the tool's last
///   instance was closed in so `open_plugin_tool_window` can restore it on
///   reopen.
/// - `simple_labels` — the full labels of windows currently in simple
///   fullscreen. Simple fullscreen is invisible to
///   `WebviewWindow::is_fullscreen()` (that only reports native Space
///   fullscreen) and there is no public getter for it, so the close handler
///   reads this set to know a window needs the simple-fullscreen teardown
///   (restore the app-global dock/menu-bar presentation options + the
///   windowed frame, then destroy). Only our own Rust code enters/exits
///   simple fullscreen (the ⌘⇧F menu handler and `open_plugin_tool_window`),
///   so the set stays accurate.
pub struct PluginToolWindowState {
    fullscreen_pref: std::sync::Mutex<std::collections::HashMap<String, ToolFullscreenMode>>,
    simple_labels: std::sync::Mutex<std::collections::HashSet<String>>,
}

impl PluginToolWindowState {
    pub fn new() -> Self {
        Self {
            fullscreen_pref: std::sync::Mutex::new(std::collections::HashMap::new()),
            simple_labels: std::sync::Mutex::new(std::collections::HashSet::new()),
        }
    }

    /// The mode this tool's last instance was closed in (or should reopen
    /// in), if any.
    pub fn mode(&self, tool_key: &str) -> Option<ToolFullscreenMode> {
        self.fullscreen_pref
            .lock()
            .map(|m| m.get(tool_key).copied())
            .unwrap_or(None)
    }

    /// Record (or clear, with `None`) the mode the tool was closed in.
    pub fn set_mode(&self, tool_key: &str, mode: Option<ToolFullscreenMode>) {
        if let Ok(mut m) = self.fullscreen_pref.lock() {
            match mode {
                Some(mode) => {
                    m.insert(tool_key.to_string(), mode);
                }
                None => {
                    m.remove(tool_key);
                }
            }
        }
    }

    /// Whether the window with this exact label is currently in simple
    /// fullscreen.
    pub fn is_simple_fullscreen(&self, label: &str) -> bool {
        self.simple_labels
            .lock()
            .map(|s| s.contains(label))
            .unwrap_or(false)
    }

    /// Mark/unmark a window as being in simple fullscreen.
    pub fn mark_simple_fullscreen(&self, label: &str, active: bool) {
        if let Ok(mut s) = self.simple_labels.lock() {
            if active {
                s.insert(label.to_string());
            } else {
                s.remove(label);
            }
        }
    }
}

/// Derive the counter-less tool key from a full window label
/// (`plugin-tool-<plugin>-<tool>-<n>` → `plugin-tool-<plugin>-<tool>`).
///
/// The instance counter is always the last `-`-separated segment and is
/// purely numeric, so stripping the final `-<digits>` is unambiguous even
/// when a plugin/tool id itself ends in digits.
pub fn tool_key_from_label(label: &str) -> Option<&str> {
    let idx = label.rfind('-')?;
    let (base, tail) = label.split_at(idx);
    let counter = &tail[1..];
    if counter.is_empty() || !counter.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(base)
}

/// Open a plugin tool window (multi-instance). Rust-side creation so the
/// fullscreen close handling and the per-tool fullscreen memory stay
/// together: `PluginToolWindowState` (managed in lib.rs) remembers the mode
/// the last instance of this tool was closed in, and we restore that on
/// reopen. Native fullscreen drops the pinned level first (macOS rejects
/// native fullscreen on always-on-top windows); simple fullscreen keeps it.
/// Fullscreen-aware close lives in the app-level `on_window_event` handler
/// in lib.rs.
#[tauri::command]
pub async fn open_plugin_tool_window(
    app: tauri::AppHandle,
    plugin_id: String,
    tool_id: String,
    entry: String,
    title: String,
) -> Result<String, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::WebviewWindowBuilder;
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("plugin-tool-{}-{}-{}", plugin_id, tool_id, n);
    let tool_key = format!("plugin-tool-{}-{}", plugin_id, tool_id);
    let url_str = format!("quill-plugin://localhost/{}/{}", plugin_id, entry);
    let parsed_url = url_str
        .parse::<tauri::Url>()
        .map_err(|e| format!("invalid plugin URL '{}': {}", url_str, e))?;
    let win = WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed_url))
        .title(title)
        .inner_size(800.0, 600.0)
        .center()
        .focused(true)
        .always_on_top(true)
        .resizable(true)
        .build()
        .map_err(|e| format!("failed to build plugin tool window: {}", e))?;
    let state = app.state::<PluginToolWindowState>();
    match state.mode(&tool_key) {
        Some(ToolFullscreenMode::Native) => {
            // Reopen in native fullscreen (closed while in a macOS fullscreen
            // Space, entered via the standard Window menu "Enter Full Screen"
            // ⌃⌘F): drop the pinned level first — macOS rejects native
            // fullscreen on always-on-top windows — then enter fullscreen.
            let _ = win.set_always_on_top(false);
            let _ = win.set_fullscreen(true);
        }
        Some(ToolFullscreenMode::Simple) => {
            // Reopen in simple fullscreen (⌘⇧F "插件弹窗全屏", pre-Lion style,
            // no separate Space): simple fullscreen accepts always-on-top
            // windows, so the pinned level stays.
            let _ = win.set_simple_fullscreen(true);
            state.mark_simple_fullscreen(&label, true);
        }
        None => {}
    }
    let _ = win.set_focus();
    Ok(label)
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
