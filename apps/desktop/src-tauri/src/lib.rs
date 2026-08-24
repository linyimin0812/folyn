// `objc 0.2` (transitive via `cocoa`) emits `cfg(cargo-clippy)` inside its
// `msg_send!` / `class!` macros — an old clippy-detection hack that Rust
// 1.80+'s check-cfg flags as an unknown cfg. The macro expansion is
// attributed to the `objc` crate (not our call site), so function-level
// `#[allow]` does not suppress it. Crate-level allow is the only effective
// scope. Upgrade `objc` to `objc2` would also fix it but is a larger change
// (Tauri 2's macOS backend uses `objc2` internally already; we add `cocoa`
// only for `NSScreen.visibleFrame` FFI).
#![allow(unexpected_cfgs)]

mod commands;
pub mod errors;
mod plugin_commands;
mod plugin_security;
mod plugin_install;
mod plugin_lifecycle;
mod plugin_fetch;
mod plugin_rpc;
mod chat;
mod list_models;
mod voice;
mod pet_api;

#[cfg(target_os = "macos")]
mod pet_panel_macos;

use tauri::Manager;
use tauri::{Emitter, WindowEvent};

/// Append a startup log line to both `mochi-startup.log` in the OS temp dir
/// and stderr. Used to trace the Windows flash-quit crash that has no visible
/// output. `startup_log` is append-mode; call `truncate_startup_log` once at
/// the start of `run()` so each launch overwrites the previous log.
///
/// Cross-platform paths:
/// - macOS: `$TMPDIR/mochi-startup.log` (usually `/var/folders/.../T/...`)
/// - Windows: `%TEMP%\mochi-startup.log` (usually
///   `C:\Users\<user>\AppData\Local\Temp\mochi-startup.log`)
pub(crate) fn startup_log(msg: impl AsRef<str>) {
    let path = std::env::temp_dir().join("mochi-startup.log");
    let line = msg.as_ref();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
    eprintln!("{line}");
}

fn truncate_startup_log() {
    let path = std::env::temp_dir().join("mochi-startup.log");
    let _ = std::fs::write(&path, "");
}

/// Maps a pet context-menu item id (see `commands::PET_CTX_MENU_*`) to the
/// `PetMenuAction` payload the main window expects. Returns `None` for
/// unknown ids (e.g. separators, which never fire `on_menu_event`).
///
/// The mapping also recognizes the 5 launcher-only actions
/// (`daily-note`, `global-search`, `clip-from-url`, `command-palette`,
/// `toggle-theme`) even though they are not in the native right-click menu —
/// the pet-panel launcher dispatches them via the same `pet://menu-action`
/// event channel, and the frontend contract test asserts the full set stays
/// in sync. Returning the action unchanged here keeps the event payload
/// stable for any future caller that routes through `on_menu_event`.
fn pet_ctx_menu_action(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_SHOW_MAIN => Some("show-main"),
        commands::PET_CTX_MENU_HIDE_PET => Some("hide-pet"),
        commands::PET_CTX_MENU_SIZE_50 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_75 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_100 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_125 => Some("set-pet-size"),
        commands::PET_CTX_MENU_SIZE_150 => Some("set-pet-size"),
        commands::PET_CTX_MENU_OPACITY_25 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_50 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_75 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_OPACITY_100 => Some("set-pet-opacity"),
        commands::PET_CTX_MENU_CLICK_THROUGH => Some("toggle-pet-click-through"),
        commands::PET_CTX_MENU_EXIT_APP => Some("exit-app"),
        // Launcher-only actions (pet-panel buttons, not native menu items).
        // Recognized here so the action-string contract stays uniform.
        "pet-ctx-daily-note" => Some("daily-note"),
        "pet-ctx-global-search" => Some("global-search"),
        "pet-ctx-clip-from-url" => Some("clip-from-url"),
        "pet-ctx-command-palette" => Some("command-palette"),
        "pet-ctx-toggle-theme" => Some("toggle-theme"),
        _ => None,
    }
}

/// Resolve the `PetSize` level string from a native menu item id. Returns
/// `None` for non-size ids. Used by `on_menu_event` to attach the `{ size }`
/// payload to `set-pet-size` actions so the frontend handler applies the
/// correct size without re-parsing the menu id.
fn pet_ctx_menu_size_level(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_SIZE_50 => Some("50"),
        commands::PET_CTX_MENU_SIZE_75 => Some("75"),
        commands::PET_CTX_MENU_SIZE_100 => Some("100"),
        commands::PET_CTX_MENU_SIZE_125 => Some("125"),
        commands::PET_CTX_MENU_SIZE_150 => Some("150"),
        _ => None,
    }
}

/// Resolve the opacity level string ("25"|"50"|"75"|"100") from a native
/// menu item id. Returns `None` for non-opacity ids. Used by `on_menu_event`
/// to attach the `{ opacity }` payload to `set-pet-opacity` actions.
fn pet_ctx_menu_opacity_level(id: &str) -> Option<&'static str> {
    match id {
        commands::PET_CTX_MENU_OPACITY_25 => Some("25"),
        commands::PET_CTX_MENU_OPACITY_50 => Some("50"),
        commands::PET_CTX_MENU_OPACITY_75 => Some("75"),
        commands::PET_CTX_MENU_OPACITY_100 => Some("100"),
        _ => None,
    }
}

/// Re-apply the ScreenSaver NSWindow level + collectionBehavior to the `pet`
/// window. Called periodically from a Rust thread (see the `setup` hook below)
/// so the re-apply keeps firing even when the app is backgrounded — WKWebView
/// throttles `setInterval`, but Rust threads are not throttled, so this is the
/// reliable path that prevents macOS from resetting the level on app
/// deactivation (which lets VS Code cover the pet).
///
/// Must run on the macOS main thread (NSWindow API is main-thread-only). The
/// caller schedules this via `app.run_on_main_thread`. Re-fetches the window +
/// `ns_window()` fresh each tick (no raw pointer captured across threads).
#[cfg(target_os = "macos")]
fn reapply_pet_topmost(app: &tauri::AppHandle) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;

    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    const KCG_SCREENSAVER_WINDOW_LEVEL_KEY: i32 = 13;

    let Some(window) = app.get_webview_window("pet") else {
        // Pet window not yet created / already destroyed — nothing to do.
        return;
    };
    let Ok(ns_window) = window.ns_window() else {
        return;
    };
    let ns_ptr = ns_window as *mut Object;
    if ns_ptr.is_null() {
        return;
    }
    unsafe {
        let level = CGWindowLevelForKey(KCG_SCREENSAVER_WINDOW_LEVEL_KEY) as isize;
        let _: () = msg_send![ns_ptr, setLevel: level];

        // NSWindowCollectionBehavior for the pet window:
        //   moveToActiveSpace(2) | fullScreenAuxiliary(256)
        //   | fullScreenAllowsTiling(512) = 770
        // moveToActiveSpace — the window follows the active Space; when the
        // user switches to VS Code's fullscreen Space, the pet window moves
        // there. canJoinAllSpaces(1) was tried first but didn't take effect
        // (isOnActiveSpace stayed false over fullscreen VS Code).
        const CB_MOVE_TO_ACTIVE_SPACE: isize = 1 << 1;
        const CB_FULLSCREEN_AUXILIARY: isize = 1 << 8;
        const CB_FULLSCREEN_ALLOWS_TILING: isize = 1 << 9;
        let behavior: isize =
            CB_MOVE_TO_ACTIVE_SPACE | CB_FULLSCREEN_AUXILIARY | CB_FULLSCREEN_ALLOWS_TILING;
        let _: () = msg_send![ns_ptr, setCollectionBehavior: behavior];
        // NOTE: a previous version attempted to force macOS to re-evaluate
        // space membership by calling `orderFrontRegardless` here, and an
        // `orderOut` + `orderFrontRegardless` reorder when `isOnActiveSpace`
        // was false. Both were removed because `orderOut` on a transparent
        // WKWebView-bearing Tauri window raises an Objective-C exception that
        // Rust cannot catch, aborting the process
        // (`fatal runtime error: Rust cannot catch foreign exceptions`).
        // The level + collectionBehavior above are the real mechanism; the
        // aggressive reorder is dropped. Known limitation: the pet may not
        // show over a fullscreen window when `isOnActiveSpace` stays false.
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn reapply_pet_topmost(_app: &tauri::AppHandle) {
    // Non-macOS: no equivalent level API; pet mode is macOS-only at present.
}

/// Re-assert the NSPanel backend's Dock level + collection behavior on the
/// `pet` window. Called from a Rust reapply thread (NOT throttled by
/// WKWebView like the frontend poll) so the pet re-floats over a newly
/// frontmost app within ~one tick of the thread interval. No `panel.show()`
/// — re-ordering an already-shown panel triggers a WKWebView re-composite
/// stall (the original "pet shows late" lag). Mirrors the BongoCat recipe
/// baked into `convert_windows`, but driven periodically instead of once.
#[cfg(target_os = "macos")]
fn reapply_pet_nspanel_level(app: &tauri::AppHandle) {
    use tauri::Manager;
    use tauri_nspanel::{CollectionBehavior, PanelLevel, WebviewWindowExt};

    let Some(window) = app.get_webview_window("pet") else {
        return;
    };
    let Ok(panel) = window.to_panel::<crate::pet_panel_macos::MochiPetPanel>() else {
        return;
    };
    panel.set_hides_on_deactivate(false);
    panel.set_level(PanelLevel::Dock.value());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()
            .full_screen_auxiliary()
            .into(),
    );
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn reapply_pet_nspanel_level(_app: &tauri::AppHandle) {}

/// Apply the pet window's topmost backend once at startup. Two paths:
///   - NSPanel (default): convert the `pet` window to a real NSPanel
///     (`Dock` level + `nonactivating_panel` + `stationary |
///     move_to_active_space | full_screen_auxiliary`) so it floats over
///     fullscreen apps, AND spawn the 200ms Rust reapply thread
///     (`spawn_nspanel_reapply_thread`) because the resign-active /
///     NSWorkspace observers do NOT fire in accessory mode
///     (`set_dock_visibility(false)`) — only a Rust-thread poll reliably
///     re-asserts the level after app-switch.
///   - Legacy (`MOCHI_PET_PANEL_BACKEND=legacy`): the old NSWindow +
///     ScreenSaver-level + behavior-770 re-apply (`reapply_pet_topmost`).
///
/// The NSPanel path runs SYNCHRONOUSLY (`.setup()` is already on the macOS
/// main thread — matches BongoCat `core/setup/macos.rs:37`, removing the
/// run-loop-tick gap where the pet existed as a stock NSWindow with
/// `alwaysOnTop: false`). The legacy path still dispatches via
/// `run_on_main_thread` to minimize blast radius (its reapply thread expects
/// main-thread scheduling). No-op on non-macOS.
#[cfg(target_os = "macos")]
fn apply_pet_backend_init(app: &tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        pet_panel_macos::convert_windows(app);
        spawn_nspanel_reapply_thread(app.clone());
    } else {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            reapply_pet_topmost(&app2);
        });
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_pet_backend_init(_app: &tauri::AppHandle) {}

/// Spawn the 500ms re-apply thread for the LEGACY path only. WKWebView
/// throttles `setInterval` when backgrounded, so the frontend's ~800ms poll
/// is unreliable; a Rust thread keeps re-asserting the ScreenSaver level that
/// macOS can reset on app deactivation. The NSPanel path has its own
/// `spawn_nspanel_reapply_thread` (200ms). No-op on non-macOS.
#[cfg(target_os = "macos")]
fn spawn_legacy_reapply_thread(app: tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let app_for_closure = app.clone();
            let _ = app.run_on_main_thread(move || {
                reapply_pet_topmost(&app_for_closure);
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn spawn_legacy_reapply_thread(_app: tauri::AppHandle) {}

/// Spawn the 200ms re-apply thread for the NSPanel path. In accessory mode
/// (`set_dock_visibility(false)`) neither `NSApplicationDidResignActive` nor
/// `NSWorkspaceDidActivateApplication` reliably fires, so the only stable
/// re-assert signal is a Rust-thread poll (not throttled by WKWebView like
/// the frontend `setInterval`). 200ms keeps visible post-switch delay under
/// ~one tick of human perception. No-op on non-macOS / legacy backend.
#[cfg(target_os = "macos")]
fn spawn_nspanel_reapply_thread(app: tauri::AppHandle) {
    if !pet_panel_macos::backend_is_nspanel() {
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let app_for_closure = app.clone();
            let _ = app.run_on_main_thread(move || {
                reapply_pet_nspanel_level(&app_for_closure);
            });
        }
    });
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn spawn_nspanel_reapply_thread(_app: tauri::AppHandle) {}

/// Exit native fullscreen and wait for the macOS transition to finish before
/// the caller hides/destroys the window.
///
/// Why: with `macOSPrivateApi` (tauri.conf.json `app.macOSPrivateApi`) a
/// window destroyed — or hidden — while in native fullscreen leaves a black
/// fullscreen Space behind. The Space belongs to the window; macOS does not
/// tear it down when the window vanishes mid-transition. Exiting fullscreen
/// first and letting the animation complete dismisses the Space, so the
/// subsequent teardown is invisible and leaves nothing behind.
///
/// macOS flips `is_fullscreen()` to false at the START of the exit
/// transition, so polling alone races the teardown. Poll until the flag
/// flips, then wait a grace period for the animation (typically ~300-600ms)
/// to actually complete. Hard-capped so a wedged transition can't hang the
/// close forever.
async fn exit_fullscreen_and_wait(win: &tauri::WebviewWindow) {
    if !win.is_fullscreen().unwrap_or(false) {
        return;
    }
    let _ = win.set_fullscreen(false);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while win.is_fullscreen().unwrap_or(false) {
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
}

/// Set the window's opacity. Used by the fullscreen close/hide helpers so the
/// exit-fullscreen transition is invisible — native macOS apps close a
/// fullscreen window "directly" (window disappears, Space dismisses) rather
/// than shrinking back to a windowed frame first, and this replicates that.
/// The main window's pet-mode close also restores opacity to 1.0 (while
/// hidden) so the next show is never transparent.
///
/// Must run on the main thread (NSWindow API is main-thread-only).
#[cfg(target_os = "macos")]
fn set_window_alpha(win: &tauri::WebviewWindow, alpha: f64) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;
    if let Ok(ns_window) = win.ns_window() {
        let ns_ptr = ns_window as *mut Object;
        if !ns_ptr.is_null() {
            unsafe {
                let _: () = msg_send![ns_ptr, setAlphaValue: alpha];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn set_window_alpha(_win: &tauri::WebviewWindow, _alpha: f64) {}

/// Make the window invisible on the main thread (setAlphaValue:0), waiting for
/// it to apply before the caller starts the fullscreen exit so the transition
/// never becomes visible. Bounded: a wedged main thread (e.g. mid-shutdown)
/// must not hang the close forever — worst case the window stays visible
/// through the exit transition, which is the previous behavior.
#[cfg(target_os = "macos")]
async fn make_window_invisible(app: &tauri::AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return;
    };
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let app2 = app.clone();
    let label2 = label.to_string();
    let _ = w.run_on_main_thread(move || {
        if let Some(win) = app2.get_webview_window(&label2) {
            set_window_alpha(&win, 0.0);
        }
        let _ = tx.send(());
    });
    let _ = tokio::time::timeout(std::time::Duration::from_millis(1000), rx).await;
}

#[cfg(not(target_os = "macos"))]
async fn make_window_invisible(_app: &tauri::AppHandle, _label: &str) {}

/// Close a fullscreen window the way native macOS apps do: the window content
/// is made invisible immediately (setAlphaValue:0, scheduled on the main
/// thread), then the fullscreen Space is dismissed via `exit_fullscreen_and_wait`
/// (mandatory — destroying a fullscreen window under macOSPrivateApi leaves a
/// black Space behind), then the window is destroyed. The user sees the window
/// vanish on click with no shrink-back-to-windowed transition and no black
/// screen.
async fn close_fullscreen_window_directly(app: tauri::AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return; // window gone, nothing to do
    };
    make_window_invisible(&app, label).await;
    exit_fullscreen_and_wait(&w).await;
    let _ = w.destroy();
}

/// Same as `close_fullscreen_window_directly` but hides the window instead of
/// destroying it (pet-mode main-window close-to-hide). Opacity is restored to
/// 1.0 AFTER the hide so the next show of the window is never transparent;
/// only the fullscreen restore is left to `MainWindowFullscreenRestore` (see
/// the app-level on_window_event Focused handler).
async fn hide_fullscreen_window_directly(app: tauri::AppHandle, label: &str) {
    let Some(w) = app.get_webview_window(label) else {
        return; // window gone, nothing to do
    };
    make_window_invisible(&app, label).await;
    exit_fullscreen_and_wait(&w).await;
    let _ = w.hide();
    // Restore opacity while hidden so the next show is never transparent.
    #[cfg(target_os = "macos")]
    {
        let app2 = app.clone();
        let label2 = label.to_string();
        let _ = w.run_on_main_thread(move || {
            if let Some(win) = app2.get_webview_window(&label2) {
                set_window_alpha(&win, 1.0);
            }
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install a panic hook BEFORE anything else so a panic anywhere in the
    // setup chain is captured to `mochi-startup.log` before the process
    // aborts. `std::panic::set_hook` fires BEFORE the default abort behavior,
    // so the log write completes. The hook also dumps a backtrace when
    // available. This is the single source of truth for "what crashed at
    // startup" — the user pastes `%TEMP%\mochi-startup.log` back.
    std::panic::set_hook(Box::new(|info| {
        startup_log(format!("[PANIC] {info}"));
        let bt = std::backtrace::Backtrace::capture();
        if bt.status() == std::backtrace::BacktraceStatus::Captured {
            startup_log(format!("[BACKTRACE] {bt}"));
        }
    }));
    truncate_startup_log();
    startup_log("[run] starting — panic hook installed");

    // OS file-association launch paths are captured BEFORE the Builder is
    // constructed. Tauri 2 starts loading structurally-declared webviews
    // during `Builder::build()`, and the frontend's mount-time
    // `drain_pending_open_files` invoke can fire before `.setup()` runs —
    // so pushing argv paths inside `setup` would lose the cold-launch race
    // (the same timing that forces managed state onto the Builder chain,
    // see the flash-quit note below). On macOS AND Windows, Launch Services
    // / Explorer hands "Open With" files to the process as positional argv,
    // so pre-populating here makes the cold-launch drain deterministic —
    // independent of whether `RunEvent::Opened` fires in time.
    let pending_open_files = commands::PendingOpenFiles::from_process_args();

    let builder = tauri::Builder::default()
        // ── mochi-plugin:// URI scheme ──
        // Registered ONCE at startup (register_uri_scheme_protocol is on
        // tauri::Builder and consumes self — cannot add schemes at runtime).
        // Dispatches by path: mochi-plugin://localhost/<id>/<file> reads from
        // ~/.mochi/plugins/<id>/<file>. Each response carries a per-plugin CSP
        // header so sandbox plugins cannot reach the network or the host DOM
        // without going through the postMessage RPC bridge.
        //
        // POST `<id>/rpc` is the fetch-RPC endpoint for tool windows: plugin
        // JS does `fetch('mochi-plugin://localhost/<id>/rpc', { method:
        // 'POST', body })` and the handler emits a `plugin-rpc-request` event
        // that the main webview's `toolWindowRpcListener` dispatches through
        // the shared `dispatchPluginRpc`. Async responder lets us wait for the
        // round-trip without blocking the webview thread.
        .register_asynchronous_uri_scheme_protocol("mochi-plugin", |ctx, request, responder| {
            use plugin_commands::{
                content_type_for, parse_plugin_uri, plugins_dir, PLUGIN_CSP,
            };
            use plugin_rpc::{handle_plugin_rpc_request, next_rpc_request_id};

            let uri_path = request.uri().path().to_string();
            let (id, file_path) = match parse_plugin_uri(&uri_path) {
                Some(v) => v,
                None => {
                    responder.respond(
                        http::Response::builder()
                            .status(400)
                            .body(b"invalid plugin uri".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"invalid plugin uri".to_vec())),
                    );
                    return;
                }
            };

            // POST `<id>/rpc` → fetch-RPC bridge.
            if request.method() == "POST" && (file_path == "rpc" || file_path.ends_with("/rpc")) {
                let body = String::from_utf8_lossy(request.body()).to_string();
                let request_id = next_rpc_request_id();
                let app = ctx.app_handle().clone();
                handle_plugin_rpc_request(app, request_id, id, body, responder);
                return;
            }

            // GET path: serve static asset from disk.
            if file_path.is_empty() {
                responder.respond(
                    http::Response::builder()
                        .status(404)
                        .body(b"not found".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                );
                return;
            }

            let dir = match plugins_dir(ctx.app_handle()) {
                Ok(d) => d,
                Err(e) => {
                    responder.respond(
                        http::Response::builder()
                            .status(500)
                            .body(e.as_bytes().to_vec())
                            .unwrap_or_else(|_| http::Response::new(e.as_bytes().to_vec())),
                    );
                    return;
                }
            };

            let file_full = dir.join(&id).join(&file_path);

            // Defense-in-depth: canonicalize and verify the resolved path is
            // still within the plugin's directory (prevents symlinks from
            // escaping).
            let canonical = match file_full.canonicalize() {
                Ok(c) => c,
                Err(_) => {
                    responder.respond(
                        http::Response::builder()
                            .status(404)
                            .body(b"not found".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                    );
                    return;
                }
            };
            let plugin_root = dir.join(&id);
            let plugin_root = match plugin_root.canonicalize() {
                Ok(c) => c,
                Err(_) => dir.join(&id),
            };
            if !canonical.starts_with(&plugin_root) {
                responder.respond(
                    http::Response::builder()
                        .status(403)
                        .body(b"forbidden".to_vec())
                        .unwrap_or_else(|_| http::Response::new(b"forbidden".to_vec())),
                );
                return;
            }

            let bytes = match std::fs::read(&canonical) {
                Ok(b) => b,
                Err(_) => {
                    responder.respond(
                        http::Response::builder()
                            .status(404)
                            .body(b"not found".to_vec())
                            .unwrap_or_else(|_| http::Response::new(b"not found".to_vec())),
                    );
                    return;
                }
            };

            let ct = content_type_for(&file_path);
            responder.respond(
                http::Response::builder()
                    .status(200)
                    .header("Content-Type", ct)
                    .header("Content-Security-Policy", PLUGIN_CSP)
                    .body(bytes)
                    .unwrap_or_else(|_| http::Response::new(b"error".to_vec())),
            );
        })
        // ── plugin init chain ──
        // Each `.plugin(...)` is preceded by a `startup_log` so a plugin that
        // panics during init lands a line naming which plugin was at fault.
        .plugin({
            startup_log("[plugin] shell");
            tauri_plugin_shell::init()
        })
        // Open files/folders in the system file manager (external-file tab icon
        // "open containing folder"). Shell's `open` is URL-only, so this uses
        // the dedicated opener plugin instead.
        .plugin({
            startup_log("[plugin] opener");
            tauri_plugin_opener::init()
        })
        // OS native notifications (PRD pet-popup-bubble-notification: system
        // notification form). The main window's dispatcher calls the plugin's
        // JS API (`sendNotification`/`registerActionTypes`/`onAction`);
        .plugin({
            startup_log("[plugin] dialog");
            tauri_plugin_dialog::init()
        })
        .plugin({
            startup_log("[plugin] fs");
            tauri_plugin_fs::init()
        })
        .plugin({
            startup_log("[plugin] clipboard_manager");
            tauri_plugin_clipboard_manager::init()
        })
        // Global keyboard shortcut plugin. A single global handler dispatches
        // by HotKey id: the voice toggle HotKey (stored in
        // `VoiceState::voice_hotkey` by `voice_set_global_hotkey`) emits
        // `voice://hotkey-toggle` on Pressed only (toggle semantics — first
        // press starts recording, second press stops; mirrors openless
        // `qa_hotkey.rs` which filters to `HotKeyState::Pressed` and lets the
        // coordinator interpret press #1 vs #2), and any OTHER registered
        // HotKey (currently the pet-panel toggle managed by
        // `pet_panel_set_shortcut`) emits `pet://shortcut-toggle` on Pressed. WHICH accelerator fires each is swapped at runtime by
        // the respective `*_set_shortcut` commands; this closure only decides
        // the routing. Pet mode is macOS-only at present, but the plugin loads
        // on all platforms — non-macOS just never has an accelerator registered
        // until the frontend calls a command. No ACL capability entry is
        // needed: the frontend never invokes the plugin's built-in commands
        // directly, only our custom `pet_panel_set_shortcut` +
        // `voice_set_global_hotkey` (custom invoke bypasses the ACL).
        .plugin({
            startup_log("[plugin] global_shortcut");
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    log::info!("[voice] shortcut handler fired: shortcut={:?} state={:?}", shortcut, event.state);
                    // Voice toggle HotKey? Read the stored voice HotKey from
                    // VoiceState and compare. The stored value is `Copy` so a
                    // brief uncontended lock suffices. Unwrap-to-None on a
                    // poisoned lock so a poisoned lock never breaks the
                    // pet-panel toggle. Toggle mode: only Pressed fires —
                    // Released is dropped (openless parity).
                    let voice_hotkey = app
                        .state::<voice::VoiceState>()
                        .voice_hotkey();
                    let is_voice = voice_hotkey
                        .map(|vh| vh == *shortcut)
                        .unwrap_or(false);
                    if is_voice && event.state == ShortcutState::Pressed {
                        let _ = app.emit("voice://hotkey-toggle", ());
                        return;
                    }
                    if event.state == ShortcutState::Pressed {
                        let _ = app.emit("pet://shortcut-toggle", ());
                    }
                })
                .build()
        })
        .on_menu_event({
            startup_log("[hook] on_menu_event registered");
            |app, event| {
            let id = event.id().as_ref();
            // Manual fullscreen toggle for the focused plugin tool window
            // (Window menu → "插件弹窗全屏", ⌘⇧F). Tool windows are pinned
            // (alwaysOnTop), which macOS blocks from entering NATIVE
            // fullscreen — so this item uses simple fullscreen instead
            // (`set_simple_fullscreen`, the pre-Lion fullscreen that fills
            // the screen without creating a separate Space). Simple
            // fullscreen accepts always-on-top windows, so the pinned level
            // is kept the whole time (no drop + restore poll). Closing a
            // simple-fullscreen window is also a plain teardown — no Space
            // transition, so no black flash (see the CloseRequested branch
            // below). Native fullscreen remains available via the standard
            // Window menu "Enter Full Screen" (⌃⌘F) and is handled
            // separately.
            if id == "plugin-tool-fullscreen" {
                if let Some((label, win)) = app
                    .webview_windows()
                    .iter()
                    .find(|(l, w)| l.starts_with("plugin-tool-") && w.is_focused().unwrap_or(false))
                {
                    let state = app.state::<commands::PluginToolWindowState>();
                    let already_native = win.is_fullscreen().unwrap_or(false);
                    let in_simple = state.is_simple_fullscreen(label);
                    if already_native {
                        // In native fullscreen (entered via ⌃⌘F): exit it.
                        let _ = win.set_fullscreen(false);
                    } else if in_simple {
                        // Exit simple fullscreen: restore the dock/menu bar
                        // and the windowed frame, keep the pinned level.
                        let _ = win.set_simple_fullscreen(false);
                        state.mark_simple_fullscreen(label, false);
                    } else {
                        // Enter simple fullscreen (no separate Space). It
                        // keeps the tool pinned and closes without a black
                        // flash.
                        let _ = win.set_simple_fullscreen(true);
                        state.mark_simple_fullscreen(label, true);
                    }
                }
                return;
            }
            // Pet tray menu items → emit `pet://menu-action` so the main
            // window's listener (App.tsx) dispatches the action. The tray
            // menu is built in `commands::build_pet_context_menu` (called
            // by `tray_set_enabled`) and shown by the OS tray.
            if let Some(action) = pet_ctx_menu_action(id) {
                // The size submenu items all map to `set-pet-size`; attach
                // the `{ size }` payload so the frontend applies the right
                // level without re-parsing the menu id.
                if action == "set-pet-size" {
                    if let Some(level) = pet_ctx_menu_size_level(id) {
                        // Update the shared state so the next menu build
                        // pre-checks the new size radio item even before
                        // the frontend's `set_pet_size` invoke lands.
                        app.state::<commands::PetSizeState>().set_level(level);
                        let _ = app.emit(
                            "pet://menu-action",
                            serde_json::json!({ "action": action, "size": level }),
                        );
                    }
                } else if action == "set-pet-opacity" {
                    if let Some(level) = pet_ctx_menu_opacity_level(id) {
                        // Update the shared state so the next menu build
                        // pre-checks the new opacity radio item even before
                        // the frontend's `set_pet_opacity` invoke lands.
                        app.state::<commands::PetOpacityState>().set_level(level);
                        let _ = app.emit(
                            "pet://menu-action",
                            serde_json::json!({ "action": action, "opacity": level }),
                        );
                    }
                } else if action == "toggle-pet-click-through" {
                    // Toggle the shared bool so the next menu build flips
                    // the checkmark even before the frontend's invoke lands.
                    let next = !app.state::<commands::PetClickThroughState>().enabled();
                    app.state::<commands::PetClickThroughState>().set_enabled(next);
                    let _ = app.emit(
                        "pet://menu-action",
                        serde_json::json!({ "action": action, "clickThrough": next }),
                    );
                } else {
                    let _ = app.emit(
                        "pet://menu-action",
                        serde_json::json!({ "action": action }),
                    );
                }
            }
        }
        })
        // R8 (lifecycle): when pet mode is on, closing the main editor window
        // must NOT quit the app — the pet is a persistent entry point. So we
        // intercept the main window's close request and just hide it. When
        // pet mode is off, default close behavior (app quit) is preserved.
        // The pet window's visibility is the source of truth for "pet mode
        // active right now", so we don't need a separate cached flag.
        //
        // Fullscreen-aware teardown: with macOSPrivateApi, hiding or
        // destroying a window that is in native fullscreen leaves a black
        // fullscreen Space behind (the Space belongs to the window and macOS
        // doesn't tear it down when the window vanishes mid-transition). So
        // when the window being closed is fullscreen we exit fullscreen +
        // wait for the animation, then hide/close.
        .on_window_event({
            startup_log("[hook] on_window_event registered");
            |window, event| {
            let label = window.label();
            let app = window.app_handle();

            // Pet-mode close-to-hide restore: when the main window was hidden
            // while fullscreen, bring it back fullscreen on its next
            // show/focus (dock reopen, pet "show-main", open-file, ...).
            if let WindowEvent::Focused(true) = event {
                if label == "main" {
                    let restore_fullscreen =
                        app.state::<commands::MainWindowFullscreenRestore>().take();
                    if restore_fullscreen {
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.set_fullscreen(true);
                        }
                    }
                }
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                if label == "main" {
                    let pet_on = app
                        .get_webview_window("pet")
                        .and_then(|p| p.is_visible().ok())
                        .unwrap_or(false);
                    // ponytail: also keep the app alive when the tray icon is
                    // enabled but pet is off — close button hides instead of
                    // quitting so the tray icon stays. Without this, Windows
                    // X-button kills the tray icon and the only way back is
                    // launching the app again.
                    let tray_on = app.tray_by_id(commands::TRAY_ID).is_some();
                    if pet_on || tray_on {
                        api.prevent_close();
                        let fullscreen = window.is_fullscreen().unwrap_or(false);
                        // Remember whether to restore fullscreen on the next
                        // show (see the Focused(true) branch above).
                        app.state::<commands::MainWindowFullscreenRestore>()
                            .set(fullscreen);
                        if fullscreen {
                            // Direct close (native-app feel): the window
                            // vanishes immediately while the Space is
                            // dismissed, then it hides (pet mode keeps the
                            // app alive).
                            let app2 = app.clone();
                            tauri::async_runtime::spawn(async move {
                                hide_fullscreen_window_directly(app2, "main").await;
                            });
                        } else {
                            let _ = window.hide();
                        }
                    }
                    // else: default close → app exits (cleanup of pet window
                    // is automatic since it's a child of the app process).
                    return;
                }

                // Plugin tool windows (multi-instance WebviewWindows opened
                // by the plugin host, see store/toolWindowStore.ts). Two
                // fullscreen modes, each with its own teardown:
                //
                // 1. NATIVE fullscreen (standard Window menu "Enter Full
                //    Screen" ⌃⌘F) — a macOS Space. Closing mid-Space under
                //    macOSPrivateApi leaves a black Space behind, so close
                //    "directly" like native apps: make the window invisible,
                //    exit fullscreen + wait for the Space to dismiss, then
                //    destroy. The exit transition briefly shows black (the
                //    Space composites the invisible window), but this is the
                //    uncommon ⌃⌘F path.
                //
                // 2. SIMPLE fullscreen (Window menu "插件弹窗全屏" ⌘⇧F,
                //    `set_simple_fullscreen`) — pre-Lion style, NO separate
                //    Space. There is no Space-dismissal animation at all, so
                //    closing is a plain teardown: make the window vanish
                //    instantly (alpha 0), restore the app-global dock/menu-bar
                //    presentation options + the windowed frame synchronously
                //    (no animation), then let the default close destroy it.
                //    No black flash.
                //
                // Non-fullscreen closes proceed untouched (smooth, no black
                // frame). destroy() emits no CloseRequested, so it can't
                // re-enter this handler.
                //
                // NOTE: app-level on_window_event DOES fire for
                // dynamically-created WebviewWindows in Tauri 2 —
                // `WindowManager::attach_window` registers the global
                // listeners for every window created via
                // `WindowBuilder`/`WebviewWindowBuilder`.
                if label.starts_with("plugin-tool-") {
                    let state = app.state::<commands::PluginToolWindowState>();
                    let fullscreen = window.is_fullscreen().unwrap_or(false);
                    let simple_fullscreen = state.is_simple_fullscreen(label);
                    // Remember the fullscreen mode this tool was closed in so
                    // `open_plugin_tool_window` can restore it on the next
                    // open of the same tool.
                    let mode = if fullscreen {
                        Some(commands::ToolFullscreenMode::Native)
                    } else if simple_fullscreen {
                        Some(commands::ToolFullscreenMode::Simple)
                    } else {
                        None
                    };
                    if let Some(tool_key) = commands::tool_key_from_label(label) {
                        state.set_mode(tool_key, mode);
                    }
                    if fullscreen {
                        api.prevent_close();
                        let app2 = app.clone();
                        let label2 = label.to_string();
                        // Native fullscreen (Space) — direct close: make the
                        // window invisible, dismiss the Space + wait for the
                        // transition, then destroy — no visible
                        // shrink-back-to-windowed transition, no black Space.
                        tauri::async_runtime::spawn(async move {
                            close_fullscreen_window_directly(app2, &label2).await;
                        });
                    } else if simple_fullscreen {
                        // Simple fullscreen (⌘⇧F, no separate Space): restore
                        // the app-global dock/menu-bar presentation options +
                        // the windowed frame with the window already
                        // invisible, then let the default close destroy it.
                        #[cfg(target_os = "macos")]
                        if let Some(w) = app.get_webview_window(label) {
                            set_window_alpha(&w, 0.0);
                        }
                        let _ = window.set_simple_fullscreen(false);
                        state.mark_simple_fullscreen(label, false);
                    }
                    // else: default close proceeds.
                }
            }
        }
        })
        // ── managed state ──
        // ponytail: MUST be on the Builder chain (not inside `.setup()`) so the
        // state is registered the moment the App is constructed — BEFORE any
        // webview loads. Tauri 2 starts loading structurally-declared webviews
        // during `Builder::build()`, and the frontend can fire an `invoke`
        // (e.g. `pet_panel_set_shortcut` from the pet window's React mount
        // effect) BEFORE the `.setup(|app| { ... })` closure body runs. If
        // `app.manage(...)` lived in setup, `app.state::<T>()` in those
        // commands would panic with "state() called before manage()" — the
        // Windows flash-quit crash. Builder-level `.manage(...)` makes the
        // state visible from t=0.
        .manage({
            startup_log("[builder] manage PluginToolWindowState");
            commands::PluginToolWindowState::new()
        })
        .manage({
            startup_log("[builder] manage MainWindowFullscreenRestore");
            commands::MainWindowFullscreenRestore::new()
        })
        .manage({
            startup_log("[builder] manage PetSizeState");
            commands::PetSizeState(std::sync::Mutex::new(
                commands::PetSizeState::DEFAULT_LEVEL.to_string(),
            ))
        })
        .manage({
            startup_log("[builder] manage PetOpacityState");
            commands::PetOpacityState(std::sync::Mutex::new(
                commands::PetOpacityState::DEFAULT_LEVEL.to_string(),
            ))
        })
        .manage({
            startup_log("[builder] manage PetClickThroughState");
            commands::PetClickThroughState(std::sync::Mutex::new(
                commands::PetClickThroughState::DEFAULT,
            ))
        })
        .manage({
            startup_log("[builder] manage TrayHidePetItemState");
            commands::TrayHidePetItemState(std::sync::Mutex::new(None))
        })
        .manage({
            startup_log("[builder] manage PetShortcutState");
            commands::PetShortcutState::new()
        })
        .manage({
            startup_log("[builder] manage VoiceState");
            voice::VoiceState::new()
        })
        .manage({
            startup_log("[builder] manage PetApiState");
            pet_api::PetApiState(std::sync::Mutex::new(None))
        })
        .manage({
            startup_log("[builder] manage PendingOpenFiles");
            pending_open_files
        })
        .setup({
            startup_log("[hook] setup closure");
            |app| {
            startup_log("[setup] entering setup closure");

            // Voice module beacon. `log::info!` goes nowhere at runtime (no
            // logger installed in the bare Tauri process), so mirror it to
            // `startup_log` so the beacon is actually visible.
            startup_log("[voice] module ready; bundle id=com.mochi.editor");
            log::info!("[voice] module ready; bundle id={}", "com.mochi.editor");

            // External pet notify API (pet-external-notify-api). Local HTTP
            // server on 127.0.0.1; reuses the `pet://notify` dispatcher. The
            // state is registered on the Builder chain above; here we only
            // spawn the server thread. Non-fatal if no port is free.
            startup_log("[setup] pet_api::spawn");
            pet_api::spawn(app.handle().clone());

            // ponytail: app menu bar is a macOS-only concept (Mochi / Edit /
            // Window submenus with `services`/`hide_others`/`show_all`
            // predefined items). On Windows, `SubmenuBuilder::services()` etc.
            // fail at `build()` time and `app.set_menu(...)` rejects the
            // macOS app-menu pattern; the `?` propagates → setup returns Err
            // → Tauri aborts startup → app flash-quits. So cfg-gate the
            // bootstrap call to macOS. `pet_rebuild_app_menu` (the locale-
            // switch path) is itself a no-op on non-macOS.
            #[cfg(target_os = "macos")]
            {
                startup_log("[setup] build_app_menu");
                if let Err(e) = commands::build_app_menu(app.handle(), "en") {
                    startup_log(format!("[setup] build_app_menu ERROR: {e}"));
                    return Err(e.into());
                }
            }

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // ponytail: Dock stays visible. The previous `set_dock_visibility(false)`
            // put the app into accessory activation policy so the pet would float
            // over fullscreen VS Code without a click — but accessory mode also
            // disables macOS native fullscreen (green traffic-light + Window >
            // Enter Full Screen). User-chosen trade-off: green-button
            // fullscreen wins, pet-over-fullscreen-app loses. If pet visibility
            // over fullscreen apps becomes a requirement again, re-add this call
            // and document the fullscreen trade-off in tauri-window-patterns.md.

            // Apply the pet window's topmost backend at creation (before the
            // first show) so macOS evaluates space membership with the flags
            // already set. NSPanel path converts the window to a real NSPanel
            // (Dock level + fullscreen-auxiliary collectionBehavior); legacy
            // path applies the ScreenSaver level + behavior 770 and spawns a
            // 500ms re-apply thread. See `apply_pet_backend_init` /
            // `spawn_legacy_reapply_thread`.
            let app_handle = app.handle().clone();
            startup_log("[setup] apply_pet_backend_init");
            apply_pet_backend_init(&app_handle);
            startup_log("[setup] spawn_legacy_reapply_thread");
            spawn_legacy_reapply_thread(app_handle);

            // Windows: drop the native titlebar. Its left-hand app icon +
            // "Mochi" title and right-hand window controls duplicate the
            // in-app Topbar (logo + name on the left, custom window controls
            // rendered by `WindowControls.tsx` on the right). The main window
            // is declared `visible: false` in tauri.conf.json so the
            // decorations are removed BEFORE the first paint — no
            // decorated→borderless flash at startup. The Topbar header's
            // `data-tauri-drag-region` becomes the drag handle (tauri-core
            // also makes double-click toggle maximize on Windows), and tao's
            // undecorated-window hit-testing keeps edge resizing + aero-snap
            // working. macOS/Linux keep the native titlebar untouched.
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                startup_log("[setup] main window decorations off (windows)");
                let _ = window.set_decorations(false);
            }

            // Show the main window only after setup is done. It is created
            // `visible: false` (see tauri.conf.json) so Windows can drop the
            // native titlebar before first paint; this show call replaces the
            // implicit show-at-build on every platform.
            if let Some(window) = app.get_webview_window("main") {
                startup_log("[setup] show main window");
                let _ = window.show();
                let _ = window.set_focus();
            }

            startup_log("[setup] done — returning Ok");
            Ok(())
        }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::drain_pending_open_files,
            commands::save_file,
            commands::check_url,
            commands::create_webview,
            commands::open_plugin_tool_window,
            commands::navigate_webview,
            commands::close_webview,
            commands::hide_webview,
            commands::show_webview,
            commands::set_webview_position,
            commands::hide_all_webviews,
            commands::on_webview_url_changed,
            commands::load_url_webview,
            commands::terminal_create,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_kill,
            commands::import_chrome_cookies,
            commands::apply_imported_cookies,
            commands::has_imported_cookies,
            commands::import_chrome_passwords,
            commands::save_imported_passwords,
            commands::load_imported_passwords,
            commands::clear_imported_passwords,
            commands::fill_webview_credentials,
            commands::git_clone,
            commands::get_project_overview,
            commands::remove_dir,
            commands::toggle_pet_mode,
            commands::show_pet_if_hidden,
            commands::set_pet_position,
            commands::get_pet_position,
            commands::pet_cursor_probe,
            commands::pet_rebuild_app_menu,
            commands::pet_set_cursor,
            commands::pet_get_work_area,
            commands::pet_panel_show,
            commands::pet_panel_hide,
            commands::pet_panel_set_shortcut,
            commands::pet_panel_set_position,
            commands::pet_panel_get_position,
            commands::pet_panel_set_size,
            commands::pet_panel_get_size,
            commands::pet_panel_is_visible,
            commands::pet_bubble_show,
            commands::pet_bubble_hide,
            commands::pet_bubble_set_position,
            commands::pet_bubble_set_size,
            commands::pet_window_scale,
            commands::pet_menu_show,
            commands::pet_menu_hide,
            commands::pet_menu_set_position,
            commands::pet_menu_set_size,
            commands::pet_corner_show,
            commands::pet_corner_hide,
            commands::pet_corner_set_position,
            commands::pet_corner_set_size,
            commands::pet_set_topmost_level,
            commands::pet_make_transparent,
            commands::set_pet_size,
            commands::set_pet_opacity,
            commands::set_pet_click_through,
            commands::exit_app,
            commands::tray_set_enabled,
            pet_api::get_pet_api_info,
            pet_api::open_external,
            chat::chat_stream,
            list_models::list_models,
            plugin_install::install_plugin,
            plugin_install::install_plugin_zip,
            plugin_lifecycle::list_plugins,
            plugin_lifecycle::uninstall_plugin,
            plugin_lifecycle::approve_plugin,
            plugin_lifecycle::get_plugin_record,
            plugin_lifecycle::read_plugin_file,
            plugin_lifecycle::grant_plugin_capabilities,
            plugin_lifecycle::verify_plugin_signature_cmd,
            plugin_fetch::plugin_http_fetch,
            plugin_fetch::fetch_url,
            plugin_rpc::plugin_rpc_respond,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::voice_insert_text,
            voice::voice_request_accessibility,
            voice::voice_request_microphone,
            voice::voice_request_speech,
            voice::voice_set_global_hotkey,
            voice::voice_orb_hide,
            voice::voice_debug_frontmost,
        ]);

    // Single-instance guard (Windows + macOS). On Windows, "Open With" on an
    // associated file while Mochi is running launches a SECOND process; on
    // macOS it normally routes to the running instance via RunEvent::Opened,
    // but if the running instance isn't registered as the document handler
    // macOS also spawns a second process instead. In both cases the plugin
    // forwards the second argv to the RUNNING instance's callback here,
    // then exits the second process. The callback mirrors the
    // RunEvent::Opened path: buffer AND emit so a still-mounting webview
    // drains on mount and a mounted one receives the event, and surface the
    // main window (pet-mode close-to-hide keeps it alive but hidden). Linux
    // wiring is deferred (no argv capture / single-instance yet) — see PRD
    // 08-16-fix-external-file-open-cold-launch-not-shown.
    #[cfg(not(target_os = "linux"))]
    let builder = builder.plugin({
        startup_log("[plugin] single_instance");
        tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Surface the main window first — a bare double-click on Windows
            // passes no file path; the hidden (close-to-tray) window still
            // needs to come back up. File-arg plumbing below stays gated on
            // non-empty paths so we don't emit spurious open-external events.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            let paths = commands::filter_argv_paths(&argv);
            if paths.is_empty() {
                return;
            }
            startup_log(format!(
                "[open-external] single-instance callback: {} path(s)",
                paths.len()
            ));
            if let Some(pending) = app.try_state::<commands::PendingOpenFiles>() {
                pending.push(paths.clone());
            }
            let _ = app.emit("app://open-external-file", paths);
        })
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Last logging opportunity before the GUI event loop takes over. If
        // the crash happens AFTER setup returns Ok but during the first event
        // loop tick, this is the final line in `mochi-startup.log`.
        .run({
            startup_log("[run] entering event loop");
            |app, event| {
            #[cfg(target_os = "macos")]
            {
                match event {
                    tauri::RunEvent::Exit => {
                        commands::terminal_kill_all();
                    }
                    // OS "Open With" / file-association launch (macOS/iOS/Android).
                    // When the user opens a file with Mochi from Finder/Explorer, the
                    // OS hands us the resource as a `file://` URL here. Convert to a
                    // filesystem path and emit it to the frontend, which opens it as
                    // an external (vault-independent) editor tab. Also surface the
                    // main window in case the app was backgrounded.
                    tauri::RunEvent::Opened { urls } => {
                        let paths: Vec<String> = urls
                            .into_iter()
                            .filter_map(|u| {
                                u.to_file_path().ok().map(|p| p.to_string_lossy().into_owned())
                            })
                            .collect();
                        if !paths.is_empty() {
                            startup_log(format!(
                                "[open-external] RunEvent::Opened: {} path(s)",
                                paths.len()
                            ));
                            if let Some(main) = app.get_webview_window("main") {
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                            // Buffer AND emit: a cold-launch webview that
                            // hasn't mounted its listener yet drains the
                            // paths on mount; a warm-launch webview receives
                            // the event immediately. `try_state` (not
                            // `state`) so a missing/poisoned state can never
                            // crash the event loop.
                            if let Some(pending) = app.try_state::<commands::PendingOpenFiles>() {
                                pending.push(paths.clone());
                            }
                            let _ = app.emit("app://open-external-file", paths);
                        }
                    }
                    // ponytail: macOS dock-click reopen. When the main window is
                    // hidden (pet-mode close-to-hide path) and the user clicks the
                    // dock icon, AppKit fires applicationShouldHandleReopen; Tauri
                    // surfaces it as RunEvent::Reopen. Without this, the dock click
                    // does nothing — the app is alive but no window comes forward.
                    tauri::RunEvent::Reopen { .. } => {
                        if let Some(main) = app.get_webview_window("main") {
                            let _ = main.show();
                            let _ = main.set_focus();
                        }
                    }
                    _ => {}
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = &app;
                // ponytail: RunEvent::Opened / Reopen are macOS-only variants in
                // Tauri 2 (they surface AppKit applicationDidFinishLaunching URL
                // open + applicationShouldHandleReopen). Windows has no equivalent
                // so the variants don't exist in the enum on that target — keep
                // the Exit cleanup (cross-platform) and drop the rest.
                match event {
                    tauri::RunEvent::Exit => {
                        startup_log("[run] RunEvent::Exit");
                        commands::terminal_kill_all();
                    }
                    _ => {}
                }
            }
        }
        });
}
