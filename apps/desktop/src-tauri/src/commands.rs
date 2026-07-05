use std::fs;
use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition};

#[tauri::command]
pub async fn open_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn select_directory() -> Result<String, String> {
    Err("Use tauri-plugin-dialog for directory selection".to_string())
}

#[derive(Serialize)]
pub struct UrlCheckResult {
    pub reachable: bool,
    pub error: String,
}

/// Check if a URL is reachable using the system curl command.
/// Uses a GET request (not HEAD) because many servers reject HEAD requests.
/// Only downloads headers (-o /dev/null) to avoid fetching the full body.
#[tauri::command]
pub async fn check_url(url: String) -> UrlCheckResult {
    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time", "8",
            "--location",
            "-o", "/dev/null",
            "-w", "%{http_code}",
            &url,
        ])
        .output();

    match output {
        Ok(out) => {
            let status_str = String::from_utf8_lossy(&out.stdout);
            let status: u16 = status_str.trim().parse().unwrap_or(0);
            // Consider reachable if we got any HTTP response (even 4xx/5xx).
            // Only status 0 means a network-level failure (DNS, connection refused, etc.).
            if status > 0 {
                UrlCheckResult { reachable: true, error: String::new() }
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                UrlCheckResult { reachable: false, error: stderr }
            }
        }
        Err(e) => UrlCheckResult { reachable: false, error: e.to_string() },
    }
}

/// Fetch web page content via curl.md and return as Markdown.
/// Uses curl subprocess to bypass CORS restrictions in the Tauri webview.
#[tauri::command]
pub async fn fetch_url_content(url: String) -> Result<String, String> {
    let curl_md_url = format!("https://curl.md/{}", url);
    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time", "30",
            "--location",
            "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            &curl_md_url,
        ])
        .output()
        .map_err(|e| format!("Failed to execute curl: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("curl failed: {}", stderr));
    }

    let body = String::from_utf8_lossy(&output.stdout).to_string();
    if body.trim().is_empty() {
        return Err("页面内容为空或无法转换为 Markdown".to_string());
    }

    Ok(body)
}

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
) -> Result<(), String> {
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
pub async fn navigate_webview(app: tauri::AppHandle, label: String, action: String) -> Result<(), String> {
    let wv = app.get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    let js = match action.as_str() {
        "back" => "history.back();",
        "forward" => "history.forward();",
        "reload" => "location.reload();",
        _ => return Err(format!("Unknown action: {}", action)),
    };
    wv.eval(js).map_err(|e| e.to_string())
}

/// Close an embedded webview by label.
#[tauri::command]
pub async fn close_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide an embedded webview by label (move off-screen to keep it alive but invisible).
#[tauri::command]
pub async fn hide_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
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
pub async fn show_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
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
) -> Result<(), String> {
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
) -> Result<(), String> {
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
pub async fn hide_all_webviews(app: tauri::AppHandle, labels: Vec<String>) -> Result<(), String> {
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

/// Clone a git repository to a local directory (shallow clone).
/// Removes the target directory first if it already exists (for re-cloning).
/// Includes network resilience configs for unstable connections.
#[tauri::command]
pub async fn git_clone(url: String, target_dir: String) -> Result<String, String> {
    // Remove existing target directory for clean re-clone
    let _ = std::fs::remove_dir_all(&target_dir);

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&target_dir).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let output = std::process::Command::new("git")
        .args([
            "-c", "http.version=HTTP/1.1",
            "-c", "http.userAgent=Quill-Desktop/1.0",
            "-c", "http.lowSpeedLimit=1000",
            "-c", "http.lowSpeedTime=30",
            "clone", "--depth", "1", "--single-branch",
            &url, &target_dir,
        ])
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Cleanup failed clone attempt
        let _ = std::fs::remove_dir_all(&target_dir);
        return Err(format!("克隆仓库失败: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout)
}

/// Remove a directory and all its contents recursively.
/// Used to clean up cloned repos after analysis.
#[tauri::command]
pub async fn remove_dir(path: String) -> Result<(), String> {
    std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove directory: {}", e))
}

/// Get a text overview of a project directory (file tree + basic stats).
/// Excludes common noise directories (.git, node_modules, target, etc.).
/// Limits output to 500 lines for manageable AI context.
#[tauri::command]
pub async fn get_project_overview(dir: String) -> Result<String, String> {
    let tree_output = std::process::Command::new("find")
        .args([
            &dir,
            "-maxdepth", "3",
            "-not", "-path", "*/.git/*",
            "-not", "-path", "*/.git",
            "-not", "-path", "*/node_modules/*",
            "-not", "-path", "*/target/*",
            "-not", "-path", "*/__pycache__/*",
            "-not", "-path", "*/.next/*",
            "-not", "-path", "*/dist/*",
            "-not", "-path", "*/build/*",
        ])
        .output()
        .map_err(|e| format!("Failed to list files: {}", e))?;

    let tree = String::from_utf8_lossy(&tree_output.stdout);

    let total_lines = tree.lines().count();
    let lines: Vec<&str> = tree.lines().take(500).collect();
    let truncated = if total_lines > 500 {
        format!(
            "{}\n... ({} more files)",
            lines.join("\n"),
            total_lines - 500
        )
    } else {
        lines.join("\n")
    };

    // Strip the base dir prefix for readability
    let prefix = format!("{}/", dir.trim_end_matches('/'));
    let cleaned = truncated
        .replace(&prefix, "")
        .replace(dir.trim_end_matches('/'), ".");

    Ok(cleaned)
}

// ────────────────────────────────────────────────────────────────────────────
// Desktop Pet Mode commands (macOS MVP).
//
// The pet is a second Tauri window (label `pet`) that is transparent,
// always-on-top, skipTaskbar, and hidden by default. These commands toggle
// its visibility, manage its position, expose cursor hit-testing for
// click-through on transparent regions, and show the right-click quick-action
// menu as a native popup (the pet window is only 120x120, so an HTML menu
// would be clipped — issue #1). Menu item selections are routed back to the
// frontend via the `pet://menu-action` event emitted from `lib.rs::on_menu_event`.
// ────────────────────────────────────────────────────────────────────────────

const PET_LABEL: &str = "pet";

/// Menu item IDs for the pet's native right-click context menu. The mapping
/// from ID → `PetMenuAction` lives in `lib.rs::on_menu_event`; keep both
/// sides in sync. (IDs are stable strings so the Rust menu builder and the
/// event handler can share them across crate modules.)
pub const PET_CTX_MENU_SHOW_MAIN: &str = "pet-ctx-show-main";
pub const PET_CTX_MENU_NEW_NOTE: &str = "pet-ctx-new-note";
pub const PET_CTX_MENU_TOGGLE_AI: &str = "pet-ctx-toggle-ai";
pub const PET_CTX_MENU_DISABLE_PET: &str = "pet-ctx-disable-pet";

/// Toggle the pet window's visibility. Returns the new visibility state.
/// Also used by the menu bar "Desktop Pet Mode" check item — the caller is
/// expected to sync the checkmark from the returned bool.
#[tauri::command]
pub async fn toggle_pet_mode(app: tauri::AppHandle) -> Result<bool, String> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let currently_visible = pet.is_visible().map_err(|e| e.to_string())?;
    let next = !currently_visible;
    if next {
        pet.show().map_err(|e| e.to_string())?;
        // Do not steal focus from the editor when summoning the pet.
        // `focus:false` in tauri.conf.json controls focus-on-creation; for
        // subsequent show() calls we rely on the window being non-activating
        // on macOS via the transparent + skipTaskbar flags.
    } else {
        pet.hide().map_err(|e| e.to_string())?;
    }
    // Keep the macOS menu bar check item in sync (the menu event path sets
    // visibility from the checkmark; this is the reverse: setting the
    // checkmark from visibility, for the frontend-driven toggle path).
    if let Some(menu) = app.menu() {
        if let Some(kind) = menu.get("pet_mode_toggle") {
            if let Some(check) = kind.as_check_menuitem() {
                let _ = check.set_checked(next);
            }
        }
    }
    // Notify the frontend so settingsStore.petModeEnabled stays in sync with
    // the actual window visibility (covers the frontend-driven toggle path).
    let _ = app.emit("pet://visibility-changed", next);
    Ok(next)
}

/// Set the pet window's screen position (physical pixels).
#[tauri::command]
pub async fn set_pet_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    pet.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Get the pet window's current screen position (physical pixels).
#[derive(Serialize)]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub async fn get_pet_position(app: tauri::AppHandle) -> Result<PetPosition, String> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let pos = pet.outer_position().map_err(|e| e.to_string())?;
    Ok(PetPosition { x: pos.x, y: pos.y })
}

/// Returns the cursor position in physical screen coordinates, the pet
/// window's outer position, and whether the main editor window is currently
/// fullscreen. The pet frontend polls this to:
///  (a) decide whether the cursor is over the mascot sprite (click-through),
///  (b) hide itself when the main window enters fullscreen (R7/AC9).
///
/// Fullscreen detection here is best-effort: it only covers the Quill main
/// window being fullscreen, not arbitrary foreground apps. Detecting any-app
/// macOS fullscreen Spaces requires NSWorkspace/Space-change notifications
/// (see research/fullscreen-detection-macos.md); that is out of MVP scope.
#[derive(Serialize)]
pub struct PetCursorProbe {
    pub cursor_x: f64,
    pub cursor_y: f64,
    pub window_x: i32,
    pub window_y: i32,
    pub main_fullscreen: bool,
}

#[tauri::command]
pub async fn pet_cursor_probe(app: tauri::AppHandle) -> Result<PetCursorProbe, String> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    let win = pet.outer_position().map_err(|e| e.to_string())?;
    let main_fullscreen = app
        .get_webview_window("main")
        .and_then(|m| m.is_fullscreen().ok())
        .unwrap_or(false);
    Ok(PetCursorProbe {
        cursor_x: cursor.x,
        cursor_y: cursor.y,
        window_x: win.x,
        window_y: win.y,
        main_fullscreen,
    })
}

/// Get the pet's usable work-area rect (physical px, top-left origin) on the
/// primary monitor. On macOS this is `NSScreen::mainScreen().visibleFrame`,
/// which excludes the Dock and menu bar — using it for default-position math
/// avoids placing the mascot under the Dock regardless of Dock size/position.
/// On non-macOS targets the full monitor rect is returned as a best-effort
/// fallback (pet mode is macOS-only at present anyway).
///
/// Returns `{ x, y, width, height }` where `(x, y)` is the top-left corner of
/// the work area in physical screen coordinates (top-left origin, NOT the
/// bottom-left origin that AppKit's NSRect uses natively — we flip Y here so
/// the value is directly comparable to `set_pet_position`'s `PhysicalPosition`).
#[derive(Serialize)]
pub struct PetWorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[tauri::command]
pub async fn pet_get_work_area(_app: tauri::AppHandle) -> Result<PetWorkArea, String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSScreen;
        use cocoa::base::id;
        use cocoa::foundation::NSRect;
        use objc::{msg_send, sel, sel_impl};

        unsafe {
            // `NSScreen::mainScreen` is a class method; call it via msg_send!
            // against the class object (cocoa's NSScreen trait method is
            // misleadingly implemented for `id` instances, not `&Class`).
            let screen: id = msg_send![objc::class!(NSScreen), mainScreen];
            if screen.is_null() {
                return Err("NSScreen.mainScreen is null".to_string());
            }
            // `visibleFrame` excludes the Dock and menu bar. NSRect uses
            // bottom-left origin; we convert to top-left origin below.
            let vis_rect: NSRect = NSScreen::visibleFrame(screen);
            // Full frame gives us the total screen height, used to flip Y.
            let full_rect: NSRect = NSScreen::frame(screen);
            let flip_y =
                full_rect.size.height - vis_rect.origin.y - vis_rect.size.height;

            Ok(PetWorkArea {
                x: vis_rect.origin.x as i32,
                y: flip_y as i32,
                width: vis_rect.size.width as i32,
                height: vis_rect.size.height as i32,
            })
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let monitor = app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no primary monitor".to_string())?;
        let pos = monitor.position();
        let size = monitor.size();
        Ok(PetWorkArea {
            x: pos.x as i32,
            y: pos.y as i32,
            width: size.width as i32,
            height: size.height as i32,
        })
    }
}

/// Show the pet's quick-action context menu as a native OS popup at the
/// cursor position. The pet Tauri window is only 120x120px, so an HTML
/// `position: fixed` menu would be clipped by the window bounds (issue #1).
/// A native popup menu is rendered by the OS, ignores the tiny window, and
/// fires `on_menu_event` (handled in `lib.rs`) for each item — which emits
/// `pet://menu-action` so the main window's existing listener dispatches the
/// action. `popup_menu` blocks the calling (non-main) thread until the menu
/// is dismissed; the JS `invoke` therefore resolves after dismissal.
#[tauri::command]
pub async fn pet_show_context_menu(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;

    let show_main = MenuItem::with_id(
        &app,
        PET_CTX_MENU_SHOW_MAIN,
        "Show Main Window",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let new_note = MenuItem::with_id(
        &app,
        PET_CTX_MENU_NEW_NOTE,
        "New Note",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let toggle_ai = MenuItem::with_id(
        &app,
        PET_CTX_MENU_TOGGLE_AI,
        "Toggle AI Panel",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let disable = MenuItem::with_id(
        &app,
        PET_CTX_MENU_DISABLE_PET,
        "Disable Pet Mode",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        &app,
        &[&show_main, &new_note, &toggle_ai, &sep, &disable],
    )
    .map_err(|e| e.to_string())?;

    // popup_menu shows the menu at the current cursor position. It runs the
    // underlying NSMenu popUp on the main thread (blocking) and returns once
    // the user picks an item or dismisses — so the menu items stay alive for
    // the duration of the popup.
    pet.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}
