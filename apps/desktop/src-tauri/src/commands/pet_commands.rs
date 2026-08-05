use tauri::{Emitter, Manager, PhysicalPosition};

use crate::commands::pet_common::*;
use crate::errors::AppError;

/// Resize the pet Tauri window to the given size level. The level string is
/// validated against the five known values (`"50".."150"`); any other value
/// returns an error so a corrupt frontend payload cannot shrink the window
/// to 0×0. The window's `transparent`/`decorations` flags are unaffected —
/// only `setSize` is called.
///
/// Also updates the shared `PetSizeState` so the next right-click menu
/// build pre-selects the correct size radio item.
#[tauri::command]
pub async fn set_pet_size(app: tauri::AppHandle, level: String) -> Result<(), AppError> {
    use tauri::LogicalSize;

    let (w, h) = pet_size_to_px(&level)
        .ok_or_else(|| format!("unknown pet size level: {}", level))?;

    // Update the shared state BEFORE the window resize so a concurrent
    // right-click menu build sees the new level even if the resize is slow.
    app.state::<PetSizeState>().set_level(&level);

    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    pet.set_size(LogicalSize::new(w as f64, h as f64))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Set the pet window's alpha. The level string is validated against the
/// four known values; any other value returns an error so a corrupt
/// frontend payload cannot set alpha to 0 (invisible pet). Calls NSWindow
/// `setAlphaValue:` on macOS; no-op on other platforms (pet mode is
/// macOS-only anyway). Updates `PetOpacityState` so the next right-click
/// menu build pre-checks the new opacity radio item.
#[tauri::command]
pub async fn set_pet_opacity(app: tauri::AppHandle, level: String) -> Result<(), AppError> {
    let alpha = pet_opacity_to_alpha(&level)
        .ok_or_else(|| format!("unknown pet opacity level: {}", level))?;
    app.state::<PetOpacityState>().set_level(&level);

    #[cfg(target_os = "macos")]
    {
        use objc::runtime::Object;
        use objc::{msg_send, sel, sel_impl};
        // `setAlphaValue:` is main-thread-only; dispatch via run_on_main_thread
        // and capture the NSWindow pointer fresh (do NOT cross threads with
        // a raw pointer — re-fetch inside the closure).
        let app2 = app.clone();
        app.run_on_main_thread(move || {
            let Some(window) = app2.get_webview_window(PET_LABEL) else {
                return;
            };
            let Ok(ns_window) = window.ns_window() else {
                return;
            };
            let ns = ns_window as *mut Object;
            if ns.is_null() {
                return;
            }
            unsafe { let _: () = msg_send![ns, setAlphaValue: alpha]; }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Pet mode is macOS-only; opacity has no effect on other platforms.
        let _ = app;
    }
    Ok(())
}

/// Toggle the pet window's click-through. When `enabled` is true, the pet
/// window calls `setIgnoreCursorEvents(true)` so all cursor events fall
/// through to apps behind — the pet is visible but non-interactive. When
/// false, the pet receives clicks as usual (the pre-feature behavior).
/// Updates `PetClickThroughState` so the next right-click menu build
/// pre-checks the click-through menu item.
#[tauri::command]
pub async fn set_pet_click_through(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), AppError> {
    app.state::<PetClickThroughState>().set_enabled(enabled);
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    pet.set_ignore_cursor_events(enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Quit the whole app. Surfaced by the pet right-click menu's "退出应用"
/// item. The frontend never awaits the result — `app.exit(0)` terminates
/// the process before the reply can be delivered. Kept async + returning
/// `Result` so it slots into `tauri::generate_handler!` like the other
/// commands; the `Ok(())` is unreachable but satisfies the type checker.
#[tauri::command]
pub async fn exit_app(app: tauri::AppHandle) -> Result<(), AppError> {
    app.exit(0);
    Ok(())
}

/// Toggle the pet window's visibility. Returns the new visibility state.
/// The frontend settings tab "桌宠" is the sole entry point for this toggle;
/// the macOS app menu no longer hosts a checkable "Desktop Pet Mode" item
/// (removed in favor of the dedicated settings tab).
#[tauri::command]
pub async fn toggle_pet_mode(app: tauri::AppHandle) -> Result<bool, AppError> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let currently_visible = pet.is_visible().map_err(|e| e.to_string())?;
    let next = !currently_visible;
    if next {
        // ponytail: on the NSPanel backend, call `panel.show()`
        // (`orderFrontRegardless`) — BongoCat `plugins/window/src/commands/
        // macos.rs:28` SHOW path. Stock `pet.show()` maps to `orderFront:`
        // which respects window-server ordering and may not promote the
        // panel above other apps' frontmost windows — the root cause of
        // "always-on-top not effective until clicked". Fallback to
        // `pet.show()` when the panel conversion is unavailable (legacy
        // backend / pre-convert). AppKit calls are main-thread-only; the
        // command runs on the async runtime thread, so dispatch via
        // `run_on_main_thread` (mirrors `pet_set_always_on_top`).
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::WebviewWindowExt;
            let app2 = app.clone();
            let showed_via_panel: std::sync::Arc<std::sync::atomic::AtomicBool> =
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let showed_clone = showed_via_panel.clone();
            app.run_on_main_thread(move || {
                let Some(window) = app2.get_webview_window(PET_LABEL) else {
                    return;
                };
                if let Ok(panel) =
                    window.to_panel::<crate::pet_panel_macos::QuillPetPanel>()
                {
                    panel.show();
                    showed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            })
            .map_err(|e| e.to_string())?;
            if !showed_via_panel.load(std::sync::atomic::Ordering::SeqCst) {
                pet.show().map_err(|e| e.to_string())?;
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            pet.show().map_err(|e| e.to_string())?;
        }
        // Do not steal focus from the editor when summoning the pet.
        // `focus:false` in tauri.conf.json controls focus-on-creation; for
        // subsequent show() calls we rely on the window being non-activating
        // on macOS via the transparent + skipTaskbar flags.
    } else {
        pet.hide().map_err(|e| e.to_string())?;
    }
    // Notify the frontend so settingsStore.petModeEnabled stays in sync with
    // the actual window visibility (covers the frontend-driven toggle path).
    let _ = app.emit("pet://visibility-changed", next);
    // Sync the tray menu's `hide_pet` CheckMenuItem so the checkmark tracks
    // the new visibility. `set_checked` is a no-op when the tray is disabled
    // (state is `None`) — see `TrayHidePetItemState`.
    if let Ok(guard) = app.state::<TrayHidePetItemState>().0.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_checked(!next);
        }
    }
    Ok(next)
}

/// Idempotent show: only calls `panel.show()` when the pet is currently
/// hidden; never hides. Used by the launch-restore path in
/// `usePetHostBridge.ts` so a `petModeEnabled=true` launch does not race with
/// `PetApp`'s mount-time position+show — `toggle_pet_mode` would flip the
/// pet visible before `set_pet_position` runs, leaving the first frame at
/// the OS-chosen default (off-screen on multi-monitor setups where the
/// primary monitor sits at negative global coords). User-driven toggles
/// (settings tab / `petHostRouter`) still use `toggle_pet_mode`.
#[tauri::command]
pub async fn show_pet_if_hidden(app: tauri::AppHandle) -> Result<bool, AppError> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let currently_visible = pet.is_visible().map_err(|e| e.to_string())?;
    if currently_visible {
        return Ok(true);
    }
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::WebviewWindowExt;
        let app2 = app.clone();
        let showed_via_panel: std::sync::Arc<std::sync::atomic::AtomicBool> =
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let showed_clone = showed_via_panel.clone();
        app.run_on_main_thread(move || {
            let Some(window) = app2.get_webview_window(PET_LABEL) else {
                return;
            };
            if let Ok(panel) =
                window.to_panel::<crate::pet_panel_macos::QuillPetPanel>()
            {
                panel.show();
                showed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        })
        .map_err(|e| e.to_string())?;
        if !showed_via_panel.load(std::sync::atomic::Ordering::SeqCst) {
            pet.show().map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        pet.show().map_err(|e| e.to_string())?;
    }
    let _ = app.emit("pet://visibility-changed", true);
    // Sync the tray menu's `hide_pet` CheckMenuItem (checked = pet hidden).
    // `set_checked` is a no-op when the tray is disabled (state is `None`).
    if let Ok(guard) = app.state::<TrayHidePetItemState>().0.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_checked(false);
        }
    }
    Ok(true)
}

/// Set the pet window's screen position (physical pixels, top-left origin).
///
/// ponytail: when the NSPanel backend is active, bypass Tauri's
/// `WebviewWindow::set_position` — its top-left→bottom-left Y-flip uses
/// `NSScreen.mainScreen`'s height even when the target point is on a
/// DIFFERENT monitor, so on multi-monitor setups where the primary sits at
/// negative global coords (e.g. `(-281, -1020)`), `set_position((1535,
/// -114))` leaves the panel at `(1584, 920)` on the wrong screen (task
/// 07-22-fix-pet-not-at-bottom-right-on-startup-multi-monitor). We instead
/// call `NSWindow.setFrameOrigin:` directly with the AppKit bottom-left
/// coordinate computed from the NSScreen that actually contains the target
/// point (matched to the Tauri monitor by size + scale). The legacy
/// backend falls through to Tauri's stock path.
#[tauri::command]
pub async fn set_pet_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), AppError> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    #[cfg(target_os = "macos")]
    {
        if crate::pet_panel_macos::backend_is_nspanel() {
            if let Some(appkit_origin) =
                nspanel_target_appkit_origin(&app, &pet, x, y)
            {
                let ns_window = pet.ns_window().map_err(|e| e.to_string())?;
                let ns_ptr = ns_window as usize;
                let placed: std::sync::Arc<std::sync::atomic::AtomicBool> =
                    std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let placed_clone = placed.clone();
                app.run_on_main_thread(move || {
                    use objc::{msg_send, sel, sel_impl};
                    unsafe {
                        let ns_ptr = ns_ptr as *mut objc::runtime::Object;
                        let _: () =
                            msg_send![ns_ptr, setFrameOrigin: appkit_origin];
                    }
                    placed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                })
                .map_err(|e| e.to_string())?;
                if placed.load(std::sync::atomic::Ordering::SeqCst) {
                    return Ok(());
                }
            }
            // Fall through to Tauri set_position if the NSScreen match failed
            // (best-effort fallback).
        }
    }
    pet.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Get the pet window's current screen position (physical pixels).
#[tauri::command]
pub async fn get_pet_position(app: tauri::AppHandle) -> Result<PetPosition, AppError> {
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;
    let pos = pet.outer_position().map_err(|e| e.to_string())?;
    Ok(PetPosition { x: pos.x, y: pos.y })
}

#[tauri::command]
pub async fn pet_cursor_probe(app: tauri::AppHandle) -> Result<PetCursorProbe, AppError> {
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

#[tauri::command]
pub async fn pet_get_work_area(app: tauri::AppHandle) -> Result<PetWorkArea, AppError> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::NSScreen;
        use cocoa::base::id;
        use cocoa::foundation::NSRect;
        use objc::{msg_send, sel, sel_impl};

        // Work area of the screen CONTAINING THE PET WINDOW, in the same
        // top-left logical space as the frontend's pet position (physical
        // outer_position ÷ this scale_factor). The old implementation used
        // `NSScreen.mainScreen`, which on macOS is "the screen containing
        // the key window" — it flips between monitors as focus moves, and on
        // a mixed-DPI setup (2x laptop + 1x external) the wrong scale factor
        // made the menu/panel math land on the wrong display when the pet
        // was on the external screen.
        let pet = app
            .get_webview_window(PET_LABEL)
            .ok_or_else(|| "pet window not found".to_string())?;
        let pet_pos = pet.outer_position().map_err(|e| e.to_string())?;
        let pet_size = pet.outer_size().map_err(|e| e.to_string())?;
        let pet_center_x = pet_pos.x + pet_size.width as i32 / 2;
        let pet_center_y = pet_pos.y + pet_size.height as i32 / 2;

        // Find the Tauri monitor containing the pet's center.
        let monitors = app.available_monitors().map_err(|e| e.to_string())?;
        let monitor = monitors
            .into_iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                pet_center_x >= pos.x
                    && pet_center_x < pos.x + size.width as i32
                    && pet_center_y >= pos.y
                    && pet_center_y < pos.y + size.height as i32
            })
            .or_else(|| pet.current_monitor().ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten());
        let Some(monitor) = monitor else {
            // No monitor info — fall back to the old mainScreen path.
            return pet_work_area_main_screen();
        };
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let scale = monitor.scale_factor();

        unsafe {
            let screens: id = msg_send![objc::class!(NSScreen), screens];
            if screens.is_null() {
                return pet_work_area_main_screen();
            }
            let count: usize = msg_send![screens, count];
            for i in 0..count {
                let screen: id = msg_send![screens, objectAtIndex: i];
                let frame: NSRect = NSScreen::frame(screen);
                // Match by size (logical points) — same pattern as
                // `nspanel_target_appkit_origin` (first match wins).
                let size_match =
                    (frame.size.width - m_size.width as f64 / scale).abs() < 1.0
                        && (frame.size.height - m_size.height as f64 / scale).abs() < 1.0;
                if !size_match {
                    continue;
                }
                let vis_rect: NSRect = NSScreen::visibleFrame(screen);
                let sf: f64 = msg_send![screen, backingScaleFactor];
                let sx = frame.origin.x;
                let sy = frame.origin.y;
                let sh = frame.size.height;
                // Map the screen's visibleFrame (AppKit bottom-left points)
                // into Tauri top-left logical points: the monitor's Tauri
                // top-left (m_pos / scale) plus the offset from the screen's
                // top-left, Y-flipped locally.
                let x = m_pos.x as f64 / scale + (vis_rect.origin.x - sx);
                let y = m_pos.y as f64 / scale
                    + (sh - (vis_rect.origin.y - sy) - vis_rect.size.height);
                return Ok(PetWorkArea {
                    x: x.round() as i32,
                    y: y.round() as i32,
                    width: vis_rect.size.width.round() as i32,
                    height: vis_rect.size.height.round() as i32,
                    scale_factor: sf,
                });
            }
            // No NSScreen matched the monitor — fall back to mainScreen.
            pet_work_area_main_screen()
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
            scale_factor: monitor.scale_factor(),
        })
    }
}

/// Legacy work-area source: `NSScreen.mainScreen`'s visibleFrame in Tauri
/// top-left logical points. Kept as the fallback when the pet's monitor
/// cannot be resolved / matched.
#[cfg(target_os = "macos")]
fn pet_work_area_main_screen() -> Result<PetWorkArea, AppError> {
    use cocoa::appkit::NSScreen;
    use cocoa::base::id;
    use cocoa::foundation::NSRect;
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let screen: id = msg_send![objc::class!(NSScreen), mainScreen];
        if screen.is_null() {
            return Err("NSScreen.mainScreen is null".into());
        }
        let vis_rect: NSRect = NSScreen::visibleFrame(screen);
        let full_rect: NSRect = NSScreen::frame(screen);
        let flip_y =
            full_rect.size.height - vis_rect.origin.y - vis_rect.size.height;
        let scale_factor: f64 = msg_send![screen, backingScaleFactor];
        Ok(PetWorkArea {
            x: vis_rect.origin.x as i32,
            y: flip_y as i32,
            width: vis_rect.size.width as i32,
            height: vis_rect.size.height as i32,
            scale_factor,
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
/// Set the OS cursor for the pet window's hover state. The pet NSPanel is
/// `nonactivating_panel` + `can_become_main_window: false`, so WKWebView's
/// CSS `cursor: pointer` doesn't take effect on plain hover — only after the
/// panel becomes key via a click. Calling `[NSCursor pointingHandCursor] set]`
/// from the frontend's `onMouseEnter` (and `arrowCursor` on leave) bypasses
/// the webview cursor system and sets the OS cursor directly. May not stick
/// when the cursor is over another app's window (the frontmost app owns the
/// cursor); reliable fix needs an `NSTrackingArea` with `NSTrackingActiveAlways`
/// on the panel's content view, deferred until this proves insufficient.
#[tauri::command]
pub async fn pet_set_cursor(app: tauri::AppHandle, kind: String) -> Result<(), AppError> {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        unsafe {
            let cursor: id = if kind == "pointer" {
                msg_send![class!(NSCursor), pointingHandCursor]
            } else {
                msg_send![class!(NSCursor), arrowCursor]
            };
            let _: () = msg_send![cursor, set];
        }
        let _ = app2;
    });
    Ok(())
}

/// Re-assert the pet window's topmost level + collection behavior.
///
/// Why: Tauri 2.11's stock `WebviewWindow::show()` (run from `PetApp.tsx`'s
/// mount effect and on re-show) resets the NSPanel's level to `Floating` (5).
/// Other always-on-top apps (VS Code) at Floating or higher then cover the
/// pet. The frontend polls this command every ~800ms and on every
/// `tauri://blur` — both NO-OP'd on the NSPanel backend before this fix, so
/// nothing re-asserted the Dock level (20) after AppKit demoted it.
///
/// macOS has two backends:
///   - NSPanel (default): re-apply `panel.show()` (orderFrontRegardless, the
///     kick that promotes the panel above other apps' frontmost windows) +
///     `set_level(PanelLevel::Dock)` + `set_collection_behavior(stationary |
///     move_to_active_space | full_screen_auxiliary)` — mirrors
///     `pet_panel_macos::convert_windows`.
///   - Legacy (`QUILL_PET_PANEL_BACKEND=legacy`): raw `NSWindow.setLevel:` at
///     the ScreenSaver level + `setCollectionBehavior:` (moveToActiveSpace |
///     fullScreenAuxiliary | fullScreenAllowsTiling = 770) via the raw
///     NSWindow pointer.
///
/// Both branches run on the macOS main thread via `run_on_main_thread`
/// (NSWindow/NSPanel API is main-thread-only; this is an async command).
/// Non-macOS: no-op. Custom `invoke` commands bypass the ACL.
///
/// NOTE: `NSWindow.setLevel:` takes a `CGWindowLevel` (the actual level
/// NUMBER), not a `CGWindowLevelKey` enum value. `kCGScreenSaverWindowLevelKey`
/// is `13` — but passing `13` directly to `setLevel:` sets a low level
/// (between Floating=3 and Status=25) that VS Code and other always-on-top
/// apps can still cover. The real ScreenSaver level on modern macOS is a
/// large number (~1000+), resolved from the key via `CGWindowLevelForKey()`.
/// We FFI that C function and pass the resolved number to `setLevel:`.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pet_set_topmost_level(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    if crate::pet_panel_macos::backend_is_nspanel() {
        // NSPanel backend: re-apply the BongoCat recipe (Dock level +
        // collectionBehavior). `to_panel()` on an already-converted window
        // re-asserts the class + level + behavior idempotently.
        //
        // ponytail: gate `panel.show()` on `window.is_visible()` —
        // mount-time `pet_set_topmost_level` is called for `pet` /
        // `pet-panel` / `pet-bubble` / `voice-orb` to re-assert the topmost
        // level; calling `panel.show()` (orderFrontRegardless) on a HIDDEN
        // panel would promote it to visible before its webview loads → the
        // user sees a blank 440×620 frame on startup (task
        // 07-22-pet-panel-empty-box-shown-on-startup-after-nspanel-convert).
        // For `pet` (mascot), visibility is owned by `toggle_pet_mode` /
        // `show_pet_if_hidden`; re-asserting level on a hidden pet is a
        // no-op anyway. `set_level` + `set_collection_behavior` still run
        // unconditionally — those configure the panel tier, not visibility.
        use tauri_nspanel::{CollectionBehavior, PanelLevel, WebviewWindowExt};
        let app2 = app.clone();
        let label2 = label.clone();
        app.run_on_main_thread(move || {
            let Some(window) = app2.get_webview_window(&label2) else {
                return;
            };
            let already_visible = window.is_visible().unwrap_or(false);
            if let Ok(panel) =
                window.to_panel::<crate::pet_panel_macos::QuillPetPanel>()
            {
                if already_visible {
                    panel.show();
                }
                panel.set_level(PanelLevel::Dock.value());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .move_to_active_space()
                        .full_screen_auxiliary()
                        .into(),
                );
            }
        })
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Legacy backend: raw NSWindow setLevel: at the ScreenSaver level.
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;
    // kCGScreenSaverWindowLevelKey = 13 is the enum KEY, not the level
    // number. NSWindow.setLevel: takes the actual CGWindowLevel number,
    // which on modern macOS is resolved from the key via
    // `CGWindowLevelForKey()` (a CoreGraphics C function). Tauri's macOS
    // build links CoreGraphics transitively (via cocoa/objc/core-foundation),
    // so the symbol resolves at link time.
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    const KCG_SCREENSAVER_WINDOW_LEVEL_KEY: i32 = 13;

    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{}' not found", label))?;
    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    // NSWindow API must be called on the macOS main thread. This command runs
    // on an async thread; calling `setLevel:` off-main-thread segfaults the
    // app. Dispatch the `msg_send!` to the main thread via Tauri's
    // `run_on_main_thread` (schedules the closure onto the main run loop).
    // The raw NSWindow pointer is not `Send`; cast it to `usize` to transfer
    // it across threads safely — the pointer is a stable window handle that
    // stays valid for the app's lifetime, and the closure runs on the same
    // main thread that owns the AppKit run loop.
    let ns_ptr_as_usize = ns_window as usize;
    app.run_on_main_thread(move || {
        let ns_ptr = ns_ptr_as_usize as *mut Object;
        unsafe {
            // `CGWindowLevelForKey` returns `i32` (CGWindowLevel is int32_t),
            // but `NSWindow.setLevel:` expects `NSInteger` (64-bit `isize` on
            // 64-bit macOS). Passing the raw `i32` to `msg_send!` for a 64-bit
            // parameter leaves the upper 32 bits undefined → the window gets
            // a garbled level, not the real ScreenSaver level, so switching
            // to another always-on-top app (VS Code) covers the pet. Cast to
            // `isize` so the value is zero-extended to 64-bit correctly.
            let level = CGWindowLevelForKey(KCG_SCREENSAVER_WINDOW_LEVEL_KEY) as isize;
            let _: () = msg_send![ns_ptr, setLevel: level];
            // Set collectionBehavior so the pet follows the active Space and
            // floats over fullscreen apps. Numeric values:
            //   NSWindowCollectionBehaviorMoveToActiveSpace    = 1 << 1  (2)
            //   NSWindowCollectionBehaviorFullScreenAuxiliary   = 1 << 8  (256)
            //   NSWindowCollectionBehaviorFullScreenAllowsTiling= 1 << 9  (512)
            // Combined = 2 | 256 | 512 = 770. Passed as NSUInteger (isize on
            // 64-bit) to `setCollectionBehavior:`.
            const CB_MOVE_TO_ACTIVE_SPACE: isize = 1 << 1;
            const CB_FULLSCREEN_AUXILIARY: isize = 1 << 8;
            const CB_FULLSCREEN_ALLOWS_TILING: isize = 1 << 9;
            let behavior: isize =
                CB_MOVE_TO_ACTIVE_SPACE | CB_FULLSCREEN_AUXILIARY | CB_FULLSCREEN_ALLOWS_TILING;
            let _: () = msg_send![ns_ptr, setCollectionBehavior: behavior];
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn pet_set_topmost_level(_app: tauri::AppHandle, _label: String) -> Result<(), AppError> {
    // Non-macOS: no equivalent level API; `alwaysOnTop: true` config is the
    // best available. Pet mode is macOS-only at present.
    Ok(())
}

/// Make a Tauri window natively transparent on macOS.
///
/// Tauri 2's `transparent: true` config flag is supposed to disable the
/// macOS WKWebView's native opaque background, but doesn't reliably on all
/// macOS builds. The result: the pet mascot (a circular badge) renders with a
/// white rectangular background around it — CSS-level transparency is
/// exhausted (`pet.css` sets `html.is-pet-window, body, #root, .pet-root`
/// `background: transparent !important`), but the webview's *native* surface
/// still paints white because `drawsBackground = YES` by default and the
/// NSWindow is `opaque = YES` with an opaque `backgroundColor`.
///
/// This command flips three native flags on the main thread:
///   1. `NSWindow setOpaque:NO` — the window is no longer treated as opaque.
///   2. `NSWindow setBackgroundColor:[NSColor clearColor]]` — clear native bg.
///   3. `WKWebView setValue:@(NO) forKey:@"drawsBackground"]` (KVC) — the
///      webview stops painting its own opaque background, so transparent CSS
///      regions finally show the desktop through the native surface.
///
/// KVC (rather than the private `_setDrawsBackground:` selector) is used to
/// avoid App Store notarization private-API flags — `setValue:forKey:` with
/// the `drawsBackground` string is not a private-selector reference. The
/// value is a boxed NSNumber `@NO`; passing a raw BOOL to KVC crashes.
///
/// The closure passed to `with_webview` runs on the macOS main thread, so the
/// `msg_send!` calls are main-thread-safe without a separate
/// `run_on_main_thread` dispatch. `WebviewWindow::with_webview` exposes the
/// platform webview whose `inner()` returns the WKWebView pointer and
/// `ns_window()` returns the NSWindow pointer on macOS. Custom `invoke`
/// commands bypass the ACL, so no capability entry is needed.
///
/// Call once on mount from `PetApp` (the pet window is transparent). Do NOT
/// call for `pet-panel` (opaque by design — `transparent: false`). macOS-only;
/// no-op on other platforms.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pet_make_transparent(app: tauri::AppHandle, label: String) -> Result<(), AppError> {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};

    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{}' not found", label))?;

    // `with_webview` schedules the closure onto the macOS main run loop and
    // gives it a `PlatformWebview` whose `inner()` is the WKWebView pointer
    // and `ns_window()` is the NSWindow pointer. All AppKit msg_send! calls
    // must happen on the main thread — doing the work inside the closure
    // satisfies that without the raw-pointer-across-threads dance used by
    // `pet_set_topmost_level` (which only had the NSWindow pointer, not the
    // WKWebView).
    //
    // The closure ALSO sets the ScreenSaver NSWindow level here (alongside
    // the transparency calls) so the level is set once on mount, reliably,
    // on the main thread. `pet_set_topmost_level` is kept as a separate
    // command for the ~800ms poll re-apply (Tauri's `show()` /
    // `set_always_on_top(true)` can reset the level to Floating). Both use
    // the same `CGWindowLevelForKey(13) as isize` cast so the 64-bit
    // `setLevel:` parameter is correctly zero-extended from the i32 return.
    window
        .with_webview(move |webview| {
            unsafe {
                let wk = webview.inner() as *mut Object;
                let ns = webview.ns_window() as *mut Object;
                if ns.is_null() || wk.is_null() {
                    return;
                }
                // 1. NSWindow opaque = NO
                let _: () = msg_send![ns, setOpaque: objc::runtime::NO];
                // 2. NSWindow backgroundColor = NSColor clearColor
                let clear: id = msg_send![objc::class!(NSColor), clearColor];
                let _: () = msg_send![ns, setBackgroundColor: clear];
                // 3. WKWebView drawsBackground = NO via KVC. The value must
                //    be an NSNumber (boxed BOOL) — a raw BOOL crashes KVC.
                let no_num: id = msg_send![
                    objc::class!(NSNumber),
                    numberWithBool: objc::runtime::NO
                ];
                let key: id = NSString::alloc(nil).init_str("drawsBackground");
                let _: () = msg_send![wk, setValue: no_num forKey: key];
                // 4. Raise to the ScreenSaver NSWindow level + set the
                //    fullscreen-auxiliary collectionBehavior. LEGACY path
                //    only — the NSPanel backend (`to_panel()`) already sets
                //    `Dock` level + `stationary | can_join_all_spaces |
                //    full_screen_auxiliary` (273), and re-asserting the
                //    ScreenSaver level here would overwrite Dock and break
                //    fullscreen-overlay visibility. The transparency calls
                //    above (1-3) still run in both modes — the NSPanel pet
                //    is still a transparent circular badge.
                if crate::pet_panel_macos::backend_is_nspanel() {
                    return;
                }
                extern "C" {
                    fn CGWindowLevelForKey(key: i32) -> i32;
                }
                const KCG_SCREENSAVER_WINDOW_LEVEL_KEY: i32 = 13;
                let level = CGWindowLevelForKey(KCG_SCREENSAVER_WINDOW_LEVEL_KEY) as isize;
                let _: () = msg_send![ns, setLevel: level];
                // Set collectionBehavior so the pet follows the active Space
                // and floats over fullscreen apps. Numeric values:
                //   NSWindowCollectionBehaviorMoveToActiveSpace    = 1 << 1  (2)
                //   NSWindowCollectionBehaviorFullScreenAuxiliary   = 1 << 8  (256)
                //   NSWindowCollectionBehaviorFullScreenAllowsTiling= 1 << 9  (512)
                // Combined = 2 | 256 | 512 = 770. Passed as NSUInteger
                // (isize on 64-bit) to `setCollectionBehavior:`.
                // moveToActiveSpace(2) — the window follows the active Space;
                // when the user switches to VS Code's fullscreen Space, the
                // pet window moves there. canJoinAllSpaces(1) was tried first
                // but didn't take effect (isOnActiveSpace stayed false over
                // fullscreen VS Code).
                const CB_MOVE_TO_ACTIVE_SPACE: isize = 1 << 1;
                const CB_FULLSCREEN_AUXILIARY: isize = 1 << 8;
                const CB_FULLSCREEN_ALLOWS_TILING: isize = 1 << 9;
                let behavior: isize =
                    CB_MOVE_TO_ACTIVE_SPACE | CB_FULLSCREEN_AUXILIARY | CB_FULLSCREEN_ALLOWS_TILING;
                let _: () = msg_send![ns, setCollectionBehavior: behavior];
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn pet_make_transparent(_app: tauri::AppHandle, _label: String) -> Result<(), AppError> {
    // Non-macOS: native transparency is platform-specific and pet mode is
    // macOS-only at present. Tauri's `transparent: true` config is the best
    // available on Windows/Linux.
    Ok(())
}
