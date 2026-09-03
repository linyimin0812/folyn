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

    // NOTE: get_webview_window("main") returns None once a child webview
    // (label "wv-…") has been added to the main window, because its
    // internal is_webview_window() check requires ALL webviews on the
    // window to share the window's label. The first browser tab works
    // (no child yet); the second fails with "Main window not found".
    // Resolve the hosting window directly from the main webview instead.
    let window = app
        .get_webview("main")
        .map(|wv| wv.window())
        .ok_or_else(|| "Main window not found".to_string())?;

    let parsed_url = url.parse::<tauri::Url>()
        .map_err(|e| format!("Invalid URL: {}", e))?;

    // JS injected on every page load — opens target="_blank" links in-place.
    let init_script = r#"
        (function() {
            if (window.__tauriLinkHandlerInstalled) return;
            window.__tauriLinkHandlerInstalled = true;

            // Fit the loaded page to the webview width with NO horizontal
            // scroll and NO clipped content:
            //  - strip default UA body margin/padding (looks like padding on
            //    all sides, including the bottom);
            //  - if the page's natural content width exceeds the viewport
            //    (baidu.com et al. ship a fixed/min width larger than the
            //    window), shrink the whole document with CSS `zoom` so every
            //    pixel is visible — content is not clipped and there is no
            //    horizontal scrollbar; vertical scrolling stays intact.
            // `zoom` (not `transform: scale`) is used because it keeps
            // position:fixed elements and layout coordinates correct and
            // reflows the document rather than painting it at a scale.
            // The natural (un-zoomed) width is measured by clearing zoom
            // first, so a previously-applied zoom can't shrink scrollWidth
            // and make us think the page fits (which would clear zoom, widen
            // the page, and re-trigger zoom in a flicker loop).
            // Re-evaluated on load + a couple of beats later (late site CSS /
            // lazy images) and on resize. Re-injected on every navigation
            // (init_script runs on each top-level document load).
            var RULES = 'html,body{margin:0!important;padding:0!important;overflow-x:hidden!important;}';
            function injectFitStyle() {
                var head = document.head || document.documentElement;
                var existing = document.getElementById('__folynFitStyle');
                if (existing) existing.remove();
                var s = document.createElement('style');
                s.id = '__folynFitStyle';
                s.textContent = RULES;
                head.appendChild(s);
            }
            injectFitStyle();
            function applyZoomToWidth() {
                var html = document.documentElement;
                if (!html) return;
                // Measure the page's NATURAL content width (zoom cleared) so
                // a previously-applied zoom can't shrink scrollWidth and make
                // us think the page fits.
                var prevZoom = html.style.zoom;
                html.style.zoom = '';
                var vw = window.innerWidth || html.clientWidth;
                var sw = Math.max(html.scrollWidth, document.body ? document.body.scrollWidth : 0);
                if (!vw) { html.style.zoom = prevZoom; return; }
                if (sw <= vw + 1) return; // fits already — leave zoom cleared
                var ratio = vw / sw;
                if (ratio >= 1) return; // only ever shrink to fit
                ratio = Math.max(0.1, Math.round(ratio * 1000) / 1000);
                html.style.zoom = String(ratio);
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', injectFitStyle, true);
            }
            window.addEventListener('load', applyZoomToWidth, true);
            var lateT1 = setTimeout(applyZoomToWidth, 600);
            var lateT2 = setTimeout(applyZoomToWidth, 2000);
            var lateT3 = setTimeout(applyZoomToWidth, 4000);
            window.addEventListener('resize', applyZoomToWidth, true);
            // Re-inject the overflow style if <head> changes so a site that
            // re-declares overflow-x can't re-enable horizontal scrolling.
            var mo = new MutationObserver(function(){ injectFitStyle(); });
            mo.observe(document.documentElement, { childList: true, subtree: false });
            window.addEventListener('beforeunload', function(){
                clearTimeout(lateT1); clearTimeout(lateT2); clearTimeout(lateT3);
            }, true);

            // Intercept clicks on links with target="_blank" to navigate in-place
            document.addEventListener('click', function(e) {
                var el = e.target;
                while (el && el.tagName !== 'A') el = el.parentElement;
                if (!el || !el.href) return;
                if (el.target === '_blank' || el.target === '_new') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = el.href;
                }
            }, true);
        })();
    "#;

    let builder = WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url))
        .user_agent(&user_agent)
        // No auto_resize: that flag resizes the webview to the WINDOW's
        // content size on window events, which fights our manual
        // set_webview_position / set_size driven by the body div's rect
        // (syncPosition on mount, ResizeObserver, active-tab transitions,
        // overlay-closed). Child webviews positioned at a sub-rect must be
        // sized by those explicit calls, not window-derived dimensions.
        .initialization_script(init_script);

    // Same coordinate-system fix as set_webview_position: the frontend's
    // y is relative to the main webview's viewport, but the child is
    // placed in contentView space. Shift it by the main webview's top
    // offset so the initial frame is correct (syncPosition will keep it
    // in sync on resizes).
    window.add_child(
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
    let url_str = format!("folyn-plugin://localhost/{}/{}", plugin_id, entry);
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
    use tauri::{LogicalPosition, LogicalSize};

    if let Some(wv) = app.get_webview(&label) {
        wv.set_bounds(tauri::Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        }).map_err(|e| e.to_string())?;
    }
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
