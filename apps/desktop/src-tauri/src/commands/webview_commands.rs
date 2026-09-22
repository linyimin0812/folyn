use tauri::{Emitter, Manager};

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

    let load_label = label.clone();
    let load_url = url.clone();
    let load_app = app.clone();
    let builder = WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed_url))
        .user_agent(&user_agent)
        // No auto_resize: that flag resizes the webview to the WINDOW's
        // content size on window events, which fights our manual
        // set_webview_position / set_size driven by the body div's rect
        // (syncPosition on mount, ResizeObserver, active-tab transitions,
        // overlay-closed). Child webviews positioned at a sub-rect must be
        // sized by those explicit calls, not window-derived dimensions.
        .initialization_script(init_script)
        // Emit load-finished when the page actually finishes loading.
        // We do NOT rely on Started (it doesn't fire on DNS failure).
        // The frontend arms its own 10 s timeout at creation time; if
        // load-finished never arrives, the timeout fires and shows an
        // error page.
        .on_page_load(move |_wv, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                let _ = load_app.emit(
                    "webview://load-finished",
                    serde_json::json!({ "label": &load_label, "url": &load_url }),
                );
            }
        });

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

/// Check whether the webview has visible content. Used by the frontend
/// after a load timeout to distinguish a genuinely blank/failed page
/// from a slow-but-loading one. Returns JSON { blank, title, bodyTextLen }.
#[tauri::command]
pub async fn check_webview_content(app: tauri::AppHandle, label: String) -> Result<String, String> {
    let wv = app.get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let js = r#"(function(){
        var b = document.body;
        var h = document.documentElement;
        var bt = b ? (b.innerText || '').trim() : '';
        var bc = b ? b.children.length : 0;
        var hc = h ? h.children.length : 0;
        JSON.stringify({ blank: bc === 0 && bt.length === 0 && hc <= 1, title: document.title || '', bodyTextLen: bt.length });
    })()"#;
    wv.eval_with_callback(js, move |result: String| {
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    Ok(rx.recv_timeout(std::time::Duration::from_secs(2))
        .unwrap_or_else(|_| r#"{"blank":true,"title":"","bodyTextLen":0}"#.to_string()))
}

/// Close an embedded webview by label.
#[tauri::command]
pub async fn close_webview(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Force the main webview to re-layout after the screen locks and wakes back
/// up. On macOS the display reconfigures during lock; the NSWindow keeps its
/// fullscreen frame but the WKWebView's backing layer is never told to resize
/// (tao sees no window-size change → no resize event), so the page composites
/// at the stale pre-lock size anchored top-left. The JS side calls this on
/// `visibilitychange → visible` and `window` focus. The first fix went through
/// wry's `set_size`, which silently did nothing (it computes the frame from
/// the same stale state); here we set the WKWebView's frame directly, in
/// contentView coordinates, from the contentView's own bounds.
#[tauri::command]
pub async fn relayout_main_webview(app: tauri::AppHandle) -> Result<(), AppError> {
    let wv = app
        .get_webview("main")
        .ok_or_else(|| "Main webview not found".to_string())?;
    let inner = wv.window().inner_size().map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        // AppKit setFrame must run on the main thread (async commands run on
        // a tokio worker; off-main msg_send can trap).
        let app2 = app.clone();
        app.run_on_main_thread(move || {
            use cocoa::base::id;
            use cocoa::foundation::NSRect;
            use objc::{msg_send, sel, sel_impl};

            let result = (|| -> Result<(), String> {
                let win = app2
                    .get_webview("main")
                    .map(|w| w.window())
                    .ok_or_else(|| "Main webview not found".to_string())?;
                let ns = win.ns_window().map_err(|e| e.to_string())? as id;
                unsafe {
                    let cv: id = msg_send![ns, contentView];
                    if cv.is_null() {
                        return Err("contentView is null".to_string());
                    }
                    // wry may make the WKWebView the contentView directly or a
                    // container subview — take subview 0 if there is one.
                    let webview: id = {
                        let subs: id = msg_send![cv, subviews];
                        let count: usize = msg_send![subs, count];
                        if count > 0 {
                            msg_send![subs, objectAtIndex: 0]
                        } else {
                            cv
                        }
                    };
                    let bounds: NSRect = msg_send![cv, bounds];
                    let wf: NSRect = msg_send![ns, frame];
                    let cur: NSRect = msg_send![webview, frame];
                    eprintln!(
                        "[relayout] inner={:?}x{:?} window_frame=({},{},{}x{}) bounds=({},{},{}x{}) webview_frame=({},{},{}x{})",
                        inner.width, inner.height,
                        wf.origin.x, wf.origin.y, wf.size.width, wf.size.height,
                        bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height,
                        cur.origin.x, cur.origin.y, cur.size.width, cur.size.height
                    );
                    // Subview frame lives in the superview's coordinate space;
                    // bounds origin is (0,0), so pin top-left at 0,0 and cover
                    // the full bounds.
                    let frame = NSRect {
                        origin: cocoa::foundation::NSPoint { x: 0.0, y: 0.0 },
                        size: bounds.size,
                    };
                    let _: () = msg_send![webview, setFrame: frame];
                }
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())??;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = inner;
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

/// The fullscreen mode a extension tool window is in / was last closed in.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ToolFullscreenMode {
    /// macOS native fullscreen — a separate Space (standard Window menu
    /// "Enter Full Screen" ⌃⌘F). Closing it requires exiting the Space first
    /// (see the app-level `on_window_event` handler in lib.rs).
    Native,
    /// macOS simple fullscreen — pre-Lion style, no separate Space (Window
    /// menu "扩展弹窗全屏" ⌘⇧F). Closing it is a plain teardown: there is no
    /// Space transition, so no black flash.
    Simple,
}

/// Per-tool fullscreen memory for extension tool windows (multi-instance).
///
/// Two maps:
/// - `fullscreen_pref` — keyed by the counter-less tool key
///   `extension-tool-<extension>-<tool>`, records the mode the tool's last
///   instance was closed in so `open_extension_tool_window` can restore it on
///   reopen.
/// - `simple_labels` — the full labels of windows currently in simple
///   fullscreen. Simple fullscreen is invisible to
///   `WebviewWindow::is_fullscreen()` (that only reports native Space
///   fullscreen) and there is no public getter for it, so the close handler
///   reads this set to know a window needs the simple-fullscreen teardown
///   (restore the app-global dock/menu-bar presentation options + the
///   windowed frame, then destroy). Only our own Rust code enters/exits
///   simple fullscreen (the ⌘⇧F menu handler and `open_extension_tool_window`),
///   so the set stays accurate.
pub struct ExtensionToolWindowState {
    fullscreen_pref: std::sync::Mutex<std::collections::HashMap<String, ToolFullscreenMode>>,
    simple_labels: std::sync::Mutex<std::collections::HashSet<String>>,
    /// The payload of the last `extension-tool://open` emit — so the
    /// `#/extension-tool` host route can fetch it on mount (covers the
    /// race where the webview's event listener is not yet attached when
    /// the open fires right after app launch).
    pub last_open: std::sync::Mutex<Option<serde_json::Value>>,
}

impl ExtensionToolWindowState {
    pub fn new() -> Self {
        Self {
            fullscreen_pref: std::sync::Mutex::new(std::collections::HashMap::new()),
            simple_labels: std::sync::Mutex::new(std::collections::HashSet::new()),
            last_open: std::sync::Mutex::new(None),
        }
    }

    /// The mode this tool's last instance was closed in (or should reopen
    /// in), if any.
    ///
    /// NOTE: the panel-architecture rewrite (static `extension-tool-panel`)
    /// no longer restores fullscreen on reopen — the panel is a floating
    /// popup, not a fullscreen app. The write side (`set_mode`) is kept
    /// because lib.rs's CloseRequested bookkeeping still records it.
    #[allow(dead_code)]
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
/// (`extension-tool-<extension>-<tool>-<n>` → `extension-tool-<extension>-<tool>`).
///
/// The instance counter is always the last `-`-separated segment and is
/// purely numeric, so stripping the final `-<digits>` is unambiguous even
/// when a extension/tool id itself ends in digits.
pub fn tool_key_from_label(label: &str) -> Option<&str> {
    let idx = label.rfind('-')?;
    let (base, tail) = label.split_at(idx);
    let counter = &tail[1..];
    if counter.is_empty() || !counter.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(base)
}

/// Fold (name, size, mtime) of every file under the extension's install dir
/// into a change fingerprint (FNV-1a over the SORTED entries — read_dir order
/// is not stable, and spurious changes would remount the iframe needlessly).
/// The frontend keys the sandboxed iframe on it: same fingerprint → the
/// hidden panel re-surfaces the running page (state preserved, no flicker);
/// changed (re-install / file update) → the iframe remounts and new code
/// loads. Without it, the hide-not-destroy lifecycle replays stale code
/// forever (observed: extension icon/CSS changes invisible until app
/// restart). Dotfiles are skipped — macOS drops .DS_Store into folders at
/// will and that must not count as a code change. Returns "" when the dir
/// is unreadable (builtins have no dir; the frontend treats "" as stable).
fn extension_dir_fingerprint(app: &tauri::AppHandle, extension_id: &str) -> String {
    let dir = match crate::extension_commands::extensions_dir(app) {
        Ok(d) => d.join(extension_id),
        Err(_) => return String::new(),
    };
    let mut entries: Vec<(String, u64, u64)> = Vec::new();
    collect_fingerprint_entries(&dir, &mut entries);
    entries.sort();
    let mut h: u64 = 0xcbf29ce484222325;
    for (name, len, mt) in &entries {
        let mut bytes: Vec<u8> = name.as_bytes().to_vec();
        bytes.push(0);
        bytes.extend_from_slice(&len.to_le_bytes());
        bytes.extend_from_slice(&mt.to_le_bytes());
        for b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("{h:016x}")
}

fn collect_fingerprint_entries(dir: &std::path::Path, out: &mut Vec<(String, u64, u64)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        let mt = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        if md.is_dir() {
            collect_fingerprint_entries(&e.path(), out);
        } else {
            out.push((name, md.len(), mt));
        }
    }
}

/// Prepare a pet-panel tool launch before its open event is dispatched.
/// Align live top-left positions, moving inward at screen edges while
/// retaining the tool's own size.
#[tauri::command]
pub async fn extension_tool_match_pet_panel(app: tauri::AppHandle) -> Result<(), String> {
    let source = app
        .get_webview_window("pet-panel")
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    let target = app
        .get_webview_window("extension-tool-panel")
        .ok_or_else(|| "extension-tool-panel window not found".to_string())?;

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            use cocoa::appkit::{NSScreen, NSWindow};
            use cocoa::base::{id, NO};

            let result = (|| -> Result<(), String> {
                let source = source.ns_window().map_err(|e| e.to_string())? as id;
                let target = target.ns_window().map_err(|e| e.to_string())? as id;
                // AppKit uses a bottom-left origin. Keep the tool's default
                // or user-resized dimensions, aligning its TOP-left corner
                // with the pet panel without any per-screen DPI conversion.
                unsafe {
                    let source_frame = NSWindow::frame(source);
                    let mut frame = NSWindow::frame(target);
                    frame.origin.x = source_frame.origin.x;
                    frame.origin.y = source_frame.origin.y + source_frame.size.height
                        - frame.size.height;
                    let screen = source.screen();
                    if screen.is_null() {
                        return Err("pet-panel screen not found".to_string());
                    }
                    // The larger tool must fit its own bounds, not merely
                    // inherit an origin that fit the smaller pet panel.
                    // visibleFrame excludes the Dock and menu bar.
                    let work = NSScreen::visibleFrame(screen);
                    frame.origin.x = frame.origin.x.clamp(
                        work.origin.x,
                        work.origin.x + (work.size.width - frame.size.width).max(0.0),
                    );
                    frame.origin.y = frame.origin.y.clamp(
                        work.origin.y,
                        work.origin.y + (work.size.height - frame.size.height).max(0.0),
                    );
                    target.setFrame_display_(frame, NO);
                }
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let position = source.outer_position().map_err(|e| e.to_string())?;
        if target.is_maximized().map_err(|e| e.to_string())? {
            target.unmaximize().map_err(|e| e.to_string())?;
        }
        let monitor = source.current_monitor().map_err(|e| e.to_string())?
            .ok_or_else(|| "pet-panel screen not found".to_string())?;
        let work = monitor.work_area();
        let size = target.inner_size().map_err(|e| e.to_string())?
            .to_logical::<f64>(target.scale_factor().map_err(|e| e.to_string())?)
            .to_physical::<u32>(monitor.scale_factor());
        let position = tauri::PhysicalPosition::new(
            position.x.clamp(work.position.x, work.position.x + work.size.width.saturating_sub(size.width) as i32),
            position.y.clamp(work.position.y, work.position.y + work.size.height.saturating_sub(size.height) as i32),
        );
        target.set_position(position).map_err(|e| e.to_string())?;
        target.set_size(size).map_err(|e| e.to_string())
    }
}

/// Open an extension tool window — the pet-panel machinery ("桌宠弹窗同款"):
/// the `extension-tool-panel` window is statically declared in
/// tauri.conf.json and converted to an NSPanel at startup
/// (`pet_panel_macos::convert_windows`), which is the one proven-safe
/// conversion moment — and the reason it floats over every app/Space like
/// the pet popup (probed 2026-09-18: dynamically created windows stayed
/// pinned to Folyn's Space no matter the behavior bits or class swaps, and
/// every runtime-conversion attempt crashed; the statically-declared pet
/// panels have floated correctly since forever). This command:
///   1. emits `extension-tool://open` {extensionId, toolId, entry, title} —
///      the window's `#/extension-tool` host route (ExtensionToolApp) swaps
///      its sandboxed `folyn-extension://` iframe to the tool's entry. RPC
///      flows through the MAIN window's `extension-rpc-request` listener
///      (Tauri events are global) — unchanged bridge;
///   2. surfaces the window WITHOUT activating Folyn (macOS: the panel is
///      already `nonactivating`, so `orderFrontRegardless` suffices; other
///      platforms: `show()` + `set_focus()`).
/// The window is never destroyed: close → `hide_extension_tool_window`,
/// reopen → this command. Returns the window label (constant).
#[tauri::command]
pub async fn open_extension_tool_window(
    app: tauri::AppHandle,
    extension_id: String,
    tool_id: String,
    entry: String,
    title: String,
) -> Result<String, String> {
    let label = "extension-tool-panel".to_string();
    // 1. Tell the host route which tool to load — via webview `eval`
    //    (a DOM CustomEvent), NOT the Tauri event system: `listen()` in the
    //    extension-tool webview never resolved (probe-verified 2026-09-18:
    //    `listener attached` never logged while `invoke` in the same window
    //    worked), so Tauri-event delivery is unreliable here. `eval` is the
    //    same primitive `navigate_webview` uses — plain webview JS, no
    //    event-system dependency. Payload goes on `window.__extensionToolOpen`
    //    so a webview that mounts AFTER this eval still reads it on mount.
    let payload = serde_json::json!({
        "extensionId": extension_id,
        "toolId": tool_id,
        "entry": entry,
        "title": title,
        "fingerprint": extension_dir_fingerprint(&app, &extension_id),
    });
    if let Some(w) = app.get_webview_window("extension-tool-panel") {
        let js = format!(
            "window.__extensionToolOpen = {}; window.dispatchEvent(new CustomEvent('extension-tool-open'));",
            payload
        );
        let _ = w.eval(js.as_str());
    }
    // Cache for the host route's mount-time fetch (see
    // `get_last_extension_tool`).
    if let Some(state) = app.try_state::<ExtensionToolWindowState>() {
        *state.last_open.lock().unwrap() = Some(payload);
    }
    // 2. Surface without app activation. The panel conversion at startup
    //    already set level/behavior; re-asserting `orderFrontRegardless`
    //    here is idempotent and covers the hidden→shown transition (the
    //    one ordering call that never activates a nonactivating panel).
    //    BEFORE the surface's NSApp activate: capture the frontmost pid so
    //    the close path can give the user's app its foreground back. Write
    //    only on Some — a None capture (Folyn already frontmost, e.g. a
    //    tool-switch while the popup is open) must not erase the pid from
    //    the original open. NSWorkspace frontmostApplication is safe to
    //    probe off-main (same pattern as voice.rs:1109).
    #[cfg(target_os = "macos")]
    {
        let pid = crate::commands::capture_frontmost_pid();
        if pid.is_some() {
            if let Some(state) = app.try_state::<crate::commands::ExtensionToolFrontmostApp>() {
                *state.0.lock().unwrap() = pid;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = app2.get_webview_window("extension-tool-panel") {
                let _ = crate::pet_panel_macos::surface_extension_tool_panel(&w);
            }
        });
        // Re-assert WKWebView transparency on every open — the pet-panel's
        // fix for the gray-corner bug (pet_make_transparent on mount). The
        // mount-time call from the frontend may race the hidden→shown
        // transition (a suspended web content process may miss it); this
        // runs AFTER the surface, on the live window. Idempotent, and it's
        // the exact proven code path (cocoa/objc bridge KVC).
        let _ = crate::commands::pet_commands::pet_make_transparent(
            app.clone(),
            "extension-tool-panel".to_string(),
        )
        .await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows: show WITHOUT stealing the foreground — the popup must
        // float over the user's app (WS_EX_TOPMOST from alwaysOnTop:true),
        // not switch them into Folyn (set_focus would SetForegroundWindow
        // — the Windows twin of the macOS "跳转" bug). Blur auto-hide / Esc
        // arm themselves once the user CLICKS the popup (Windows activates
        // a window on click; tao then emits focus/blur like macOS's panel).
        if let Some(w) = app.get_webview_window("extension-tool-panel") {
            let _ = w.show();
        }
    }
    Ok(label)
}

/// Hide (not destroy) an extension tool window — the pet-panel lifecycle.
/// Destroying a class-swapped NSPanel on the user-close path is the
/// uncatchable Obj-C exception crash; hiding is what the pet panels have
/// done forever. Reopening re-surfaces the same window (singleton path in
/// `open_extension_tool_window`). Called by the frontend's
/// `toolWindowStore.close` / `closeAllForExtension`.
#[tauri::command]
/// If a native modal dialog is up (app-modal session, or a sheet on any
/// app window), drop the tool popup's floating Dock level below it so the
/// dialog stays clickable (the popup would otherwise sit on top —
/// 遮挡文件弹窗). Returns true when lowered. The popup re-gains key when
/// the dialog ends; the frontend's `tauri://focus` listener invokes
/// `extension_tool_restore_level` to float it back. Shared by
/// `hide_extension_tool_window` (unpinned blur path) and
/// `extension_tool_lower_if_dialog` (pinned blur path — no hide there, but
/// the same dialog must not be covered).
fn extension_tool_lower_below_dialog_if_any(app: &tauri::AppHandle, label: &str) -> bool {
    let Some(w) = app.get_webview_window(label) else {
        return false;
    };
    let modal = crate::commands::pet_common::window_has_modal_dialog(&w)
        || crate::commands::pet_common::app_has_any_modal_dialog(app);
    if modal {
        #[cfg(target_os = "macos")]
        crate::pet_panel_macos::lower_extension_tool_panel_level(&w);
    }
    modal
}

#[tauri::command]
pub async fn extension_tool_lower_if_dialog(app: tauri::AppHandle, label: String) -> Result<bool, String> {
    Ok(extension_tool_lower_below_dialog_if_any(&app, &label))
}

/// Adopt the pet panel's captured frontmost pid as the extension-tool
/// popup's close-restore target. Every pet-panel tool-open path opens the
/// popup AFTER the panel already activated Folyn (`pet_panel_show`'s
/// `set_focus`), so `open_extension_tool_window`'s own capture sees Folyn
/// frontmost and stores nothing. But `pet_panel_show` captured the user's
/// app into `PreviousFrontmostApp` BEFORE that activation, and the panel's
/// tool-open sites deliberately skip its restore (`restoreFocus:false`) —
/// the popup is the intended owner of the foreground. This moves that pid
/// to `ExtensionToolFrontmostApp` so `hide_extension_tool_window` restores
/// the user's app on close.
#[tauri::command]
pub async fn extension_tool_adopt_frontmost(app: tauri::AppHandle) -> Result<(), String> {
    let pid = app
        .try_state::<crate::commands::PreviousFrontmostApp>()
        .and_then(|s| *s.0.lock().ok()?);
    if let Some(pid) = pid {
        if let Some(state) = app.try_state::<crate::commands::ExtensionToolFrontmostApp>() {
            *state.0.lock().unwrap() = Some(pid);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_extension_tool_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let Some(w) = app.get_webview_window(&label) else {
        return Ok(()); // already gone — nothing to hide
    };
    // Same guard as `pet_panel_hide`, but app-wide: a native modal dialog
    // ANYWHERE fired the blur that invoked this hide — the tool popup itself
    // opens dialogs it never gets attached: the WKWebView `<input
    // type="file">` panel runs app-modal (no sheet on any window), and the
    // fetch-RPC `dialog:*` bridge parents its plugin sheets to the MAIN
    // window (its listener runs there). Hiding now would tear the dialog
    // down with the popup (ai-assistant: 非置顶模式下点击附件图标弹窗
    // 直接隐藏，无法选文件). Instead keep the popup alive but drop it
    // BELOW the dialog; the dialog ending re-focuses the popup and the
    // frontend's tauri://focus listener re-asserts the floating level, so
    // the blur-auto-hide re-arms for the next real blur.
    if extension_tool_lower_below_dialog_if_any(&app, &label) {
        return Ok(());
    }
    let fullscreen = w.is_fullscreen().unwrap_or(false);
    if fullscreen {
        // Reuse the pet-mode close-to-hide dance (invisible → dismiss the
        // fullscreen Space + wait → hide) — hiding a native-fullscreen
        // window mid-animation would leave a black Space behind.
        crate::hide_fullscreen_window_directly(app, &label).await;
        return Ok(());
    }
    let _ = w.hide();
    // Closing the popup while Folyn is the active app would otherwise hand
    // the key window to the Folyn main window and raise it over the user's
    // workspace (the "关闭弹窗跳转回 folyn" bug). Give the activation back
    // to the app the popup took it from (captured at open, or adopted from
    // the pet panel — see `extension_tool_adopt_frontmost`). Blur auto-hide
    // skips the restore: the user is already in another app (frontmost !=
    // Folyn, so capture_frontmost_pid returns Some), and re-activating the
    // OLD app would steal focus from their current one. The take (not peek)
    // consumes the pid on every hide so a stale target never survives into
    // a later popup session.
    #[cfg(target_os = "macos")]
    {
        let prev = app
            .try_state::<crate::commands::ExtensionToolFrontmostApp>()
            .and_then(|s| s.0.lock().ok().and_then(|mut g| g.take()));
        if let Some(pid) = prev {
            if crate::commands::capture_frontmost_pid().is_none() {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    // Delayed ~150ms so the hide's window-server state
                    // settles first (same race guard as pet_panel_hide).
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    crate::commands::restore_frontmost_app(&app2, pid);
                });
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn extension_tool_restore_level(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let Some(w) = app.get_webview_window(&label) else {
        return Ok(());
    };
    // Re-assert the floating Dock level. The hide guard lowers the popup
    // below an in-flight modal dialog (file picker / dialog:* RPC sheet);
    // when the dialog ends the popup re-gains key → the frontend's
    // tauri://focus listener invokes this to float it back on top.
    // Idempotent: safe on every focus event, even when never lowered.
    #[cfg(target_os = "macos")]
    {
        // restore_extension_tool_panel_level dispatches to the main thread
        // and waits itself (async commands run on a tokio worker; AppKit
        // setLevel:/orderFront trap off-main) — no wrapper here, a nested
        // dispatch + blocking wait would deadlock the main thread on itself.
        crate::pet_panel_macos::restore_extension_tool_panel_level(&w);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = w;
    }
    Ok(())
}

/// The payload of the last `extension-tool://open` (null if never opened).
/// The `#/extension-tool` host route fetches this on mount so a tool opened
/// right after app launch (before the webview's event listener attached)
/// still shows. See `open_extension_tool_window`.
#[tauri::command]
pub async fn get_last_extension_tool(
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    Ok(app
        .try_state::<ExtensionToolWindowState>()
        .and_then(|s| s.last_open.lock().ok().and_then(|g| g.clone())))
}

/// Start a native window drag for the extension tool panel.
///
/// tao's `drag_window` (what `startDragging()` calls) forwards
/// `NSApp.currentEvent` to `performWindowDragWithEvent:` — but by the time
/// the async JS→Rust IPC lands on the main thread, the current event is
/// long past the mouseDown (it may even be the webview's own event), and
/// `performWindowDragWithEvent:` with a non-mouseDown event is a SILENT
/// no-op that still returns Ok — the "无法拖动" symptom. tao itself
/// has the fix for one event type (0x15, tablet): it SYNTHESIZES a
/// LeftMouseDown event at the current mouseLocation and passes that.
/// We do the same unconditionally: synthesize a leftMouseDown at
/// `NSEvent.mouseLocation` targeting OUR windowNumber, then
/// `performWindowDragWithEvent:` — which enters the native modal drag
/// loop (exactly the system window-drag feel). Mirrors tao-0.35.3
/// `drag_window`'s 0x15 branch.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn extension_tool_start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    // Local NSPoint: objc2-foundation is only an INDIRECT dep (arboard),
    // so declare the struct + its encoding here. Name MUST be "CGPoint":
    // the runtime type-encoding of NSEvent.mouseLocation on the Tahoe SDK
    // is {CGPoint=dd} (NSPoint is a typealias of CGPoint there), and objc2's
    // debug message-send verification panics on a name mismatch — the
    // crash "expected {CGPoint=dd}, found {NSPoint=dd}".
    #[repr(C)]
    #[allow(non_camel_case_types)]
    struct NSPoint {
        x: f64,
        y: f64,
    }
    // SAFETY: {f64,f64} FFI-safe struct with Foundation's @encode name.
    unsafe impl objc2::Encode for NSPoint {
        const ENCODING: objc2::Encoding = objc2::Encoding::Struct(
            "CGPoint",
            &[f64::ENCODING, f64::ENCODING],
        );
    }

    let app = window.app_handle().clone();
    let _ = window.run_on_main_thread(move || unsafe {
        let Ok(ns_window) = app
            .get_webview_window("extension-tool-panel")
            .ok_or_else(|| "extension-tool-panel not found".to_string())
            .and_then(|w| w.ns_window().map_err(|e| e.to_string()))
        else {
            return;
        };
        let ns = ns_window as *mut AnyObject;
        if ns.is_null() {
            return;
        }
        // Mouse location in WINDOW coordinates (origin = window's
        // bottom-left) — performWindowDragWithEvent: expects the event's
        // location in the window's coordinate space (like locationInWindow).
        // NSEvent.mouseLocation would give SCREEN coordinates and the drag
        // loop mis-anchors → the window "jumps" on click.
        // (mouseLocationOutsideOfEventStream works even when the cursor is
        // outside the window — it extrapolates.)
        let mouse: NSPoint = msg_send![ns, mouseLocationOutsideOfEventStream];
        // Our window's number so the synthesized event routes to us.
        let window_number: i64 = msg_send![ns, windowNumber];
        // Synthesize the LeftMouseDown (NSEventType 1) tao builds in its
        // tablet branch: same selector, same argument shapes. Types must
        // match the method's runtime encodings EXACTLY (objc2's debug
        // verification panics on mismatch): NSEventType/NSUInteger → u64,
        // NSTimeInterval → f64, NSInteger → i64, float pressure → f32.
        let event: *mut AnyObject = msg_send![
            class!(NSEvent),
            mouseEventWithType: 1u64,
            location: mouse,
            modifierFlags: 0u64,
            timestamp: 0f64,
            windowNumber: window_number,
            context: std::ptr::null_mut::<AnyObject>(),
            eventNumber: 0i64,
            clickCount: 1i64,
            pressure: 1.0f32,
        ];
        if event.is_null() {
            return;
        }
        let _: () = msg_send![ns, performWindowDragWithEvent: event];
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn extension_tool_start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    // Windows/other: keep the standard path (tao's Win32 implementation
    // is synchronous-scoped and works from the IPC handler).
    let _ = window.start_dragging();
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
