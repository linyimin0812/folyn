//! Research windows (spec 6.3 多窗口研究任务).
//!
//! `create_research_window` opens an independent Folyn document window bound
//! to a window session (the session model lives in the frontend
//! `windowSessionService`; this side only hosts the webview). Route:
//! `/#/research/<sessionId>` — same frontend bundle as the main window, the
//! App boot binds the session from the hash. Label `research-<sessionId>` is
//! the identity: a repeat call for the same session focuses the existing
//! window instead of duplicating it (single host per session by construction).
//!
//! Geometry comes in as LOGICAL px (captured from the closing window's
//! outerPosition/outerSize ÷ scaleFactor by the frontend). `None` → default
//! size, cascaded +30/+30 from the calling window so successive new windows
//! don't stack exactly. `visible: false` + the frontend shows itself once
//! React mounts (avoids a blank white flash during webview load); if JS
//! fails the window stays hidden — dev-only failure mode, acceptable.
//!
//! Close behavior: nothing special here. The frontend's
//! usePersistOnClose handles CloseRequested (persist tabs + session record,
//! then destroy); lib.rs's `on_window_event` only branches on `label ==
//! "main"` (pet/tray hide) and `extension-tool-*` (fullscreen teardown), so
//! research windows fall through to default close — the destroy from JS ends
//! them.

use tauri::Manager;

#[derive(serde::Deserialize)]
pub struct ResearchGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub async fn create_research_window(
    app: tauri::AppHandle,
    session_id: String,
    title: String,
    geometry: Option<ResearchGeometry>,
) -> Result<String, String> {
    // Sanitize: the session id becomes part of the window label and the
    // route hash. `windowSessionService` generates `r-<hex>` ids, but this
    // is an IPC boundary — reject anything outside that shape instead of
    // trusting the caller.
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        || session_id.len() > 64
    {
        return Err("invalid session id".into());
    }

    let label = format!("research-{}", session_id);

    // Single host per session: an existing window for this session just
    // gets focused (the frontend's recent-windows list hides open sessions,
    // but TOCTOU between list-render and click lands here).
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(label);
    }

    let (x, y, width, height) = match geometry {
        Some(g) => (g.x, g.y, g.width, g.height),
        None => {
            // Cascade from the main window's current position.
            let base = app
                .get_webview_window("main")
                .and_then(|w| w.outer_position().ok());
            let offset = 30.0;
            let (bx, by) = base.map(|p| (p.x as f64, p.y as f64)).unwrap_or((120.0, 90.0));
            (bx + offset, by + offset, 1200.0, 800.0)
        }
    };

    let url = tauri::WebviewUrl::App(format!("/#/research/{}", session_id).into());
    let build_label = label.clone();
    let build_title = title.clone();
    // 闭包需要持有 AppHandle（move），而 run_on_main_thread 的 receiver
    // 又借用外面的 app —— 克隆一份给闭包，E0505 标准解法。
    let build_app = app.clone();

    app.run_on_main_thread(move || {
        let builder = tauri::WebviewWindowBuilder::new(&build_app, &build_label, url)
            .title(&build_title)
            .inner_size(width, height)
            .position(x, y)
            .min_inner_size(640.0, 480.0)
            .resizable(true)
            .decorations(true)
            .visible(false)
            .focused(true);
        // drag_drop 默认启用：研究窗口与主窗一致，拖文件/文件夹入窗
        // → tauri://drag-* 原生事件携带真实绝对路径（useOsFileDragDrop
        // 监听）。webview 内部 HTML5 拖拽（富文本节点/表格重排、CM6
        // 文本拖）走 WKContentView 自身拖拽通道，不经过 wry 的外层
        // handler，不受影响。
        if let Err(err) = builder.build() {
            eprintln!("[research-window] build failed: {}", err);
            // 常见失败原因：同 label 窗口已存在但 get_webview_window 在某
            // 些时序下查不到 —— 退化成 focus，保证「一会话一窗」不被破坏。
            if let Some(existing) = build_app.get_webview_window(&build_label) {
                let _ = existing.show();
                let _ = existing.set_focus();
            }
        }
    })
    .map_err(|e| format!("main-thread dispatch failed: {}", e))?;

    Ok(label)
}

/// 列出当前存活的全部研究窗口（label 去掉 `research-` 前缀 = 会话 id）。
/// 前端用它做「磁盘开/关标志」之外的存活真相：面板过滤存活会话、
/// 主窗口接管跳过存活会话都以此为准。
#[tauri::command]
pub fn list_research_windows(app: tauri::AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|label| label.starts_with("research-"))
        .cloned()
        .collect()
}
