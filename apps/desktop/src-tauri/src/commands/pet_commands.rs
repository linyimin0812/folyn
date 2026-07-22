use std::sync::Mutex;
use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

use crate::errors::AppError;

/// Shared pet-size level state ("50"|"75"|"100"|"125"|"150"). Synced from
/// the frontend via the `set_pet_size` command and from `on_menu_event` when
/// the user picks a size from the native submenu. Read by `pet_show_context_menu`
/// to pre-check the current size radio item. Defaults to `"100"` so
/// existing users keep the 96×96 layout on first right-click.
///
/// Defined here (not in `lib.rs`) so both `commands.rs` and `lib.rs` share
/// the SAME type — Rust treats same-name structs in different modules as
/// distinct types, which would break `app.state::<PetSizeState>()`.
pub struct PetSizeState(pub Mutex<String>);

impl PetSizeState {
    /// The default size level — matches `PET_SIZE_DEFAULT` in
    /// `petPosition.ts` and the `PET_WINDOW_SIZE` (96) default.
    pub const DEFAULT_LEVEL: &'static str = "100";

    /// Read the current level. Returns the default if the mutex is poisoned
    /// (shouldn't happen — only a panic while holding the lock would poison
    /// it, and we never panic under the lock).
    pub fn level(&self) -> String {
        self.0.lock().map(|g| g.clone()).unwrap_or_else(|_| Self::DEFAULT_LEVEL.to_string())
    }

    /// Set the current level. Silently ignores a poison error.
    pub fn set_level(&self, level: &str) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = level.to_string();
        }
    }
}

/// Shared pet-opacity level state ("25"|"50"|"75"|"100"). Same pattern as
/// `PetSizeState`: synced from the frontend (`set_pet_opacity`) and from
/// `on_menu_event` on a submenu pick; read by `pet_show_context_menu` to
/// pre-check the current opacity radio item. Defaults to `"100"` (fully
/// opaque) so existing users keep the pre-opacity-feature look on first
/// right-click.
pub struct PetOpacityState(pub Mutex<String>);

impl PetOpacityState {
    pub const DEFAULT_LEVEL: &'static str = "100";

    pub fn level(&self) -> String {
        self.0.lock().map(|g| g.clone()).unwrap_or_else(|_| Self::DEFAULT_LEVEL.to_string())
    }

    pub fn set_level(&self, level: &str) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = level.to_string();
        }
    }
}

/// Shared pet-click-through flag. When true, the pet Tauri window has
/// `setIgnoreCursorEvents(true)` so clicks fall through to apps behind.
/// Same pattern as `PetSizeState`/`PetOpacityState`. Defaults to `false`
/// (pet receives clicks — the pre-feature behavior). Read by
/// `pet_show_context_menu` to pre-check the click-through menu item.
pub struct PetClickThroughState(pub Mutex<bool>);

impl PetClickThroughState {
    pub const DEFAULT: bool = false;

    pub fn enabled(&self) -> bool {
        self.0.lock().map(|g| *g).unwrap_or(Self::DEFAULT)
    }

    pub fn set_enabled(&self, enabled: bool) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = enabled;
        }
    }
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
pub const PET_CTX_MENU_HIDE_PET: &str = "pet-ctx-hide-pet";
pub const PET_CTX_MENU_SIZE_50: &str = "pet-ctx-size-50";
pub const PET_CTX_MENU_SIZE_75: &str = "pet-ctx-size-75";
pub const PET_CTX_MENU_SIZE_100: &str = "pet-ctx-size-100";
pub const PET_CTX_MENU_SIZE_125: &str = "pet-ctx-size-125";
pub const PET_CTX_MENU_SIZE_150: &str = "pet-ctx-size-150";
pub const PET_CTX_MENU_OPACITY_25: &str = "pet-ctx-opacity-25";
pub const PET_CTX_MENU_OPACITY_50: &str = "pet-ctx-opacity-50";
pub const PET_CTX_MENU_OPACITY_75: &str = "pet-ctx-opacity-75";
pub const PET_CTX_MENU_OPACITY_100: &str = "pet-ctx-opacity-100";
pub const PET_CTX_MENU_CLICK_THROUGH: &str = "pet-ctx-click-through";
pub const PET_CTX_MENU_EXIT_APP: &str = "pet-ctx-exit-app";
/// Native context-menu item that fires the demo bubble notification (PRD:
/// pet-popup-bubble-notification). `on_menu_event` in `lib.rs` maps this id
/// to a `pet://notify` emit with a demo payload; the main window's dispatcher
/// routes it by `settingsStore.notificationForm` (bubble / system / both /
/// off) so the bubble window can be exercised without any real trigger
/// source wired up yet.
pub const PET_CTX_MENU_TEST_BUBBLE: &str = "pet-ctx-test-bubble";

/// Localized label keys for the pet right-click context menu. One enum entry
/// per `PET_CTX_MENU_*` id that has a user-visible label (separators have
/// none). Translations live in `pet_menu_label`; IDs and `PetMenuAction`
/// strings stay locale-independent.
#[derive(Copy, Clone)]
pub enum PetMenuLabel {
    ShowMain,
    HidePet,
    SizeSubmenu,
    Size50,
    Size75,
    Size100,
    Size125,
    Size150,
    OpacitySubmenu,
    Opacity25,
    Opacity50,
    Opacity75,
    Opacity100,
    ClickThrough,
    ExitApp,
    TestBubble,
}

/// Resolve a pet context-menu label for the given locale. `zh` → Chinese;
/// any other value (including unknown locales) falls back to English. The
/// frontend passes its `localeStore` value (`zh` / `en`) when invoking
/// `pet_show_context_menu`.
pub fn pet_menu_label(locale: &str, key: PetMenuLabel) -> &'static str {
    match locale {
        "zh" => match key {
            PetMenuLabel::ShowMain => "显示主窗口",
            PetMenuLabel::HidePet => "隐藏桌宠图标",
            PetMenuLabel::SizeSubmenu => "桌宠大小",
            PetMenuLabel::Size50 => "50%",
            PetMenuLabel::Size75 => "75%",
            PetMenuLabel::Size100 => "100%",
            PetMenuLabel::Size125 => "125%",
            PetMenuLabel::Size150 => "150%",
            PetMenuLabel::OpacitySubmenu => "桌宠透明度",
            PetMenuLabel::Opacity25 => "25%",
            PetMenuLabel::Opacity50 => "50%",
            PetMenuLabel::Opacity75 => "75%",
            PetMenuLabel::Opacity100 => "100%",
            PetMenuLabel::ClickThrough => "桌宠穿透",
            PetMenuLabel::ExitApp => "退出应用",
            PetMenuLabel::TestBubble => "测试气泡通知",
        },
        _ => match key {
            PetMenuLabel::ShowMain => "Show Main Window",
            PetMenuLabel::HidePet => "Hide Pet Icon",
            PetMenuLabel::SizeSubmenu => "Pet Size",
            PetMenuLabel::Size50 => "50%",
            PetMenuLabel::Size75 => "75%",
            PetMenuLabel::Size100 => "100%",
            PetMenuLabel::Size125 => "125%",
            PetMenuLabel::Size150 => "150%",
            PetMenuLabel::OpacitySubmenu => "Pet Opacity",
            PetMenuLabel::Opacity25 => "25%",
            PetMenuLabel::Opacity50 => "50%",
            PetMenuLabel::Opacity75 => "75%",
            PetMenuLabel::Opacity100 => "100%",
            PetMenuLabel::ClickThrough => "Click Through",
            PetMenuLabel::ExitApp => "Exit App",
            PetMenuLabel::TestBubble => "Test Bubble Notification",
        },
    }
}

/// Localized label keys for the macOS app menu bar submenus. "Quill" is a
/// brand name and stays untranslated; `PredefinedMenuItem` (Cut/Copy/Paste
/// /About/…) is OS-localized and untouched.
#[derive(Copy, Clone)]
pub enum AppMenuLabel {
    Edit,
    Window,
}

pub fn app_menu_label(locale: &str, key: AppMenuLabel) -> &'static str {
    match locale {
        "zh" => match key {
            AppMenuLabel::Edit => "编辑",
            AppMenuLabel::Window => "窗口",
        },
        _ => match key {
            AppMenuLabel::Edit => "Edit",
            AppMenuLabel::Window => "Window",
        },
    }
}

/// Build and install the macOS app menu bar (Quill / Edit / Window submenus)
/// with titles localized for `locale`. Called once from `lib.rs::setup` (with
/// `"en"` as the bootstrap default — frontend hydrates `localeStore` and
/// calls `pet_rebuild_app_menu` to sync the user's actual locale) and again
/// whenever the user switches locale. The `Quill` submenu title is a brand
/// name and never translated; `Edit`/`Window` use `app_menu_label`.
pub fn build_app_menu(app: &tauri::AppHandle, locale: &str) -> Result<(), AppError> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Quill")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
        .map_err(|e| e.to_string())?;

    let edit_menu = SubmenuBuilder::new(app, app_menu_label(locale, AppMenuLabel::Edit))
        .cut()
        .copy()
        .paste()
        .build()
        .map_err(|e| e.to_string())?;

    let window_menu = SubmenuBuilder::new(app, app_menu_label(locale, AppMenuLabel::Window))
        .minimize()
        .maximize()
        .close_window()
        .separator()
        .fullscreen()
        .build()
        .map_err(|e| e.to_string())?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .build()
        .map_err(|e| e.to_string())?;

    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

/// Map a `PetSize` level string ("50"|"75"|"100"|"125"|"150") to the logical
/// pixel footprint of the pet window. Mirrors `PET_SIZE_TO_PX` in
/// `petPosition.ts` — keep both in sync. Used by `set_pet_size` to resolve
/// the level to a `LogicalSize`.
fn pet_size_to_px(level: &str) -> Option<(u32, u32)> {
    match level {
        "50" => Some((48, 48)),
        "75" => Some((72, 72)),
        "100" => Some((96, 96)),
        "125" => Some((120, 120)),
        "150" => Some((144, 144)),
        _ => None,
    }
}

/// Resolve the current pet size level from the app's shared `PetSizeState`.
/// Returns `"100"` (the default) when the state is unset, which preserves
/// the pre-feature 96×96 layout for existing users on first right-click.
fn current_pet_size_level(app: &tauri::AppHandle) -> String {
    app.state::<PetSizeState>().level()
}

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

/// Map an opacity level string ("25"|"50"|"75"|"100") to the f64 alpha
/// value NSWindow `setAlphaValue:` expects (CGFloat = c_double on 64-bit).
/// MUST be f64, not f32: the objc 0.2 crate encodes f32 as ObjC 'f' (float)
/// and f64 as 'd' (double); `setAlphaValue:`'s parameter is CGFloat = 'd'.
/// Passing f32 mismatches the runtime signature — on arm64 the float is
/// written to the low 32 bits of v0 and the high 32 bits are undefined per
/// AAPCS, so the callee reads a garbage double, frequently ≈0 → the window
/// goes fully transparent at any level <100% (and 100% only "works" because
/// PetApp skips the invoke at the default level). Mirrors the frontend
/// `PetOpacity` type. Used by `set_pet_opacity`.
fn pet_opacity_to_alpha(level: &str) -> Option<f64> {
    match level {
        "25" => Some(0.25),
        "50" => Some(0.50),
        "75" => Some(0.75),
        "100" => Some(1.00),
        _ => None,
    }
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

/// Compute the AppKit bottom-left origin (logical points) for the pet
/// window's top-left `(x, y)` (physical px, top-left origin) when the
/// NSPanel backend is active. Finds the Tauri monitor containing the
/// target point, matches it to an `NSScreen` by size + scale, then flips
/// Y using that screen's own `frame` (not `mainScreen`'s frame — the
/// root cause of Tauri's `set_position` bug). Returns `None` if no
/// matching monitor/screen pair is found (caller falls back to Tauri).
#[cfg(target_os = "macos")]
fn nspanel_target_appkit_origin(
    app: &tauri::AppHandle,
    pet: &tauri::WebviewWindow,
    x: i32,
    y: i32,
) -> Option<cocoa::foundation::NSPoint> {
    use cocoa::appkit::NSScreen;
    use cocoa::base::id;
    use cocoa::foundation::{NSPoint, NSRect};
    use objc::{class, msg_send, sel, sel_impl};

    // Find the Tauri monitor containing the target point.
    let monitors = app.available_monitors().ok()?;
    let monitor = monitors.into_iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        x >= pos.x
            && x < pos.x + size.width as i32
            && y >= pos.y
            && y < pos.y + size.height as i32
    })?;
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let scale = monitor.scale_factor();
    // Pet window may currently be on a different monitor than the target
    // point (e.g., window on retina laptop while target is on non-retina
    // external). For window-size physical→logical conversion, use the
    // WINDOW's own scale_factor, not the monitor's. Other conversions
    // (target point, monitor position) keep using the monitor's scale.
    let win_scale = pet.scale_factor().unwrap_or(scale);

    // Window's logical height: NSPanel's frame is in logical points, so
    // derive from Tauri's `outer_size()` (physical) / window's own scale.
    let win_size = pet.outer_size().ok()?;
    let win_h_logical = win_size.height as f64 / win_scale;

    let target_x_logical = x as f64 / scale;
    let target_y_logical = y as f64 / scale;
    let mx_logical = m_pos.x as f64 / scale;
    let my_logical = m_pos.y as f64 / scale;

    unsafe {
        let screens: id = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return None;
        }
        let count: usize = msg_send![screens, count];
        // Match by size (logical) — Tauri monitor size / scale should equal
        // NSScreen frame.size. ponytail: if two screens share size, the
        // first match wins; upgrade to position-matching if that bites.
        for i in 0..count {
            let screen: id = msg_send![screens, objectAtIndex: i];
            let frame: NSRect = NSScreen::frame(screen);
            let size_match =
                (frame.size.width - m_size.width as f64 / scale).abs() < 1.0
                    && (frame.size.height - m_size.height as f64 / scale).abs() < 1.0;
            if !size_match {
                continue;
            }
            let ax = frame.origin.x;
            let ay = frame.origin.y;
            let ah = frame.size.height;
            // Offset from monitor's top-left (Tauri, top-down) → offset
            // from monitor's bottom-left (AppKit, bottom-up). Y-flip is
            // local to the screen, so mainScreen's height is irrelevant.
            let offset_x_logical = target_x_logical - mx_logical;
            let offset_y_from_top_logical = target_y_logical - my_logical;
            let appkit_y =
                ay + ah - offset_y_from_top_logical - win_h_logical;
            return Some(NSPoint {
                x: ax + offset_x_logical,
                y: appkit_y,
            });
        }
    }
    None
}

/// Get the pet window's current screen position (physical pixels).
#[derive(Serialize)]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
}

#[tauri::command]
pub async fn get_pet_position(app: tauri::AppHandle) -> Result<PetPosition, AppError> {
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

/// Get the pet's usable work-area rect on the primary monitor, plus the
/// monitor's `scale_factor` (physical px per logical point). On macOS the
/// rect is `NSScreen::mainScreen().visibleFrame` (logical points, excludes
/// the Dock and menu bar); on other platforms it's the full monitor rect as
/// a best-effort fallback (pet mode is macOS-only at present anyway).
///
/// **Unit contract**: `x`/`y`/`width`/`height` are **logical points** with a
/// top-left origin (NOT the bottom-left origin that AppKit's NSRect uses
/// natively — we flip Y here so the value is directly comparable across
/// platforms). `scale_factor` converts logical points to physical pixels:
/// `physical = logical * scale_factor`. `set_pet_position` / `outerPosition()`
/// operate in physical px, so the JS caller must multiply by `scale_factor`
/// before calling those APIs and divide by `scale_factor` after reading from
/// them. The math in `petPosition.ts` runs in logical space.
#[derive(Serialize)]
pub struct PetWorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
}

#[tauri::command]
pub async fn pet_get_work_area(_app: tauri::AppHandle) -> Result<PetWorkArea, AppError> {
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
                return Err("NSScreen.mainScreen is null".into());
            }
            // `visibleFrame` excludes the Dock and menu bar. NSRect uses
            // bottom-left origin; we convert to top-left origin below.
            let vis_rect: NSRect = NSScreen::visibleFrame(screen);
            // Full frame gives us the total screen height, used to flip Y.
            let full_rect: NSRect = NSScreen::frame(screen);
            let flip_y =
                full_rect.size.height - vis_rect.origin.y - vis_rect.size.height;
            // `backingScaleFactor` is the physical-px-per-logical-point ratio
            // (2.0 on Retina, 1.0 on non-Retina). The math in petPosition.ts
            // runs in logical points; the JS caller uses this to convert at
            // the set_pet_position / outerPosition() boundary.
            let scale_factor: f64 = msg_send![screen, backingScaleFactor];

            let result = PetWorkArea {
                x: vis_rect.origin.x as i32,
                y: flip_y as i32,
                width: vis_rect.size.width as i32,
                height: vis_rect.size.height as i32,
                scale_factor,
            };
            Ok(result)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {        let monitor = _app
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

#[tauri::command]
pub async fn pet_show_context_menu(
    app: tauri::AppHandle,
    locale: String,
) -> Result<(), AppError> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::Manager;

    // ponytail: popup the menu attached to the pet NSPanel's own ns_view, with
    // the cursor position relative to the pet window. The pet panel carries
    // `full_screen_auxiliary` collectionBehavior so it stays on the active
    // Space even when another app is fullscreen — attaching the menu to the
    // pet's view (inView = Some) makes NSMenu popUp on the same Space.
    // Position=None would use `NSEvent::mouseLocation()` + inView=nil (an
    // orphaned menu that opens on the frontmost app's Space — invisible when
    // our app isn't frontmost). Computing cursor-relative-to-pet-frame and
    // passing to `popup_menu_at` keeps the menu anchored to the pet window.
    let pet = app
        .get_webview_window(PET_LABEL)
        .ok_or_else(|| "pet window not found".to_string())?;

    let loc = locale.as_str();
    let show_main = MenuItem::with_id(
        &app,
        PET_CTX_MENU_SHOW_MAIN,
        pet_menu_label(loc, PetMenuLabel::ShowMain),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // Hide pet icon — sole "hide the pet" entry (the old `disable-pet`
    // sibling was dropped from the right-click menu; the pet-panel launcher
    // grid also dropped its `disable-pet` button, so `hide-pet` is the only
    // remaining path that turns the pet off).
    let hide_pet = MenuItem::with_id(
        &app,
        PET_CTX_MENU_HIDE_PET,
        pet_menu_label(loc, PetMenuLabel::HidePet),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // Pet size submenu — five radio items (50%/75%/100%/125%/150%), the
    // current size pre-checked. Reads the shared `PetSizeState` (synced from
    // frontend via `set_pet_size` / `set_pet_size_state`) so the checkmark
    // reflects the last-applied size.
    let current_level = current_pet_size_level(&app);
    let size_50 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_SIZE_50,
        pet_menu_label(loc, PetMenuLabel::Size50),
        true,
        current_level == "50",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_75 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_SIZE_75,
        pet_menu_label(loc, PetMenuLabel::Size75),
        true,
        current_level == "75",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_100 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_SIZE_100,
        pet_menu_label(loc, PetMenuLabel::Size100),
        true,
        current_level == "100",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_125 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_SIZE_125,
        pet_menu_label(loc, PetMenuLabel::Size125),
        true,
        current_level == "125",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_150 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_SIZE_150,
        pet_menu_label(loc, PetMenuLabel::Size150),
        true,
        current_level == "150",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_submenu = Submenu::with_items(
        &app,
        pet_menu_label(loc, PetMenuLabel::SizeSubmenu),
        true,
        &[&size_50, &size_75, &size_100, &size_125, &size_150],
    )
    .map_err(|e| e.to_string())?;

    // Pet opacity submenu — four radio items (25/50/75/100%), the current
    // opacity pre-checked. Mirrors the size submenu pattern; reads the
    // shared `PetOpacityState` (synced from frontend via `set_pet_opacity`
    // and from `on_menu_event` on a submenu pick).
    let current_opacity = app.state::<PetOpacityState>().level();
    let opacity_25 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_OPACITY_25,
        pet_menu_label(loc, PetMenuLabel::Opacity25),
        true,
        current_opacity == "25",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_50 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_OPACITY_50,
        pet_menu_label(loc, PetMenuLabel::Opacity50),
        true,
        current_opacity == "50",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_75 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_OPACITY_75,
        pet_menu_label(loc, PetMenuLabel::Opacity75),
        true,
        current_opacity == "75",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_100 = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_OPACITY_100,
        pet_menu_label(loc, PetMenuLabel::Opacity100),
        true,
        current_opacity == "100",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_submenu = Submenu::with_items(
        &app,
        pet_menu_label(loc, PetMenuLabel::OpacitySubmenu),
        true,
        &[&opacity_25, &opacity_50, &opacity_75, &opacity_100],
    )
    .map_err(|e| e.to_string())?;

    // Pet click-through toggle — when checked, the pet window ignores all
    // cursor events so clicks fall through to apps behind. The pet itself
    // becomes non-interactive, so the user toggles it OFF from the Pet
    // settings tab (the settings page is in the main window, always
    // clickable). Pre-checked from the shared `PetClickThroughState`.
    let click_through = CheckMenuItem::with_id(
        &app,
        PET_CTX_MENU_CLICK_THROUGH,
        pet_menu_label(loc, PetMenuLabel::ClickThrough),
        true,
        app.state::<PetClickThroughState>().enabled(),
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let exit_app = MenuItem::with_id(
        &app,
        PET_CTX_MENU_EXIT_APP,
        pet_menu_label(loc, PetMenuLabel::ExitApp),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    // Demo: fire a test bubble notification (PRD pet-popup-bubble-notification).
    // Routed in `lib.rs` `on_menu_event` to a `pet://notify` emit (the main
    // window's dispatcher routes it by `notificationForm`).
    let test_bubble = MenuItem::with_id(
        &app,
        PET_CTX_MENU_TEST_BUBBLE,
        pet_menu_label(loc, PetMenuLabel::TestBubble),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        &app,
        &[
            &show_main,
            &hide_pet,
            &size_submenu,
            &opacity_submenu,
            &click_through,
            &sep,
            &exit_app,
            &test_bubble,
        ],
    )
    .map_err(|e| e.to_string())?;

    // popup_menu_at anchors the menu to `pet`'s ns_view (so NSMenu opens on
    // the pet panel's Space — visible even when the frontmost app is
    // fullscreen) at the cursor position expressed in the view's top-left
    // origin (logical points). muda flips Y to the NSView's bottom-left.
    let popup_pos = pet_cursor_pos_relative(&pet)?;
    pet.popup_menu_at(&menu, popup_pos).map_err(|e| e.to_string())?;
    Ok(())
}

/// Rebuild the macOS app menu bar with labels localized for `locale`. The
/// menu bar is built once at `lib.rs::setup` (bootstrap locale `"en"`); the
/// frontend calls this command after `localeStore` hydrates and whenever the
/// user switches locale. `set_menu` must run on the main thread, so we marshal
/// via `run_on_main_thread`; the closure reports failure through a channel so
/// the command surfaces a real error instead of swallowing it.
#[tauri::command]
pub async fn pet_rebuild_app_menu(
    app: tauri::AppHandle,
    locale: String,
) -> Result<(), AppError> {
    use std::sync::mpsc::channel;
    let (tx, rx) = channel::<Result<(), String>>();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let res = build_app_menu(&app2, &locale).map_err(|e| e.to_string());
        let _ = tx.send(res);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Compute the current cursor position relative to the pet window's top-left,
/// in logical points (top-left origin, Y-down) — the format muda's
/// `popup_menu_at` expects. Uses Tauri's portable `cursor_position()` +
/// `outer_position()` / `outer_size()` so we don't have to call struct-
/// returning AppKit methods (`NSEvent::mouseLocation`, `NSWindow::frame`)
/// through `msg_send!`, which is UB on ARM64 and crashes. Falls back to
/// (0,0) if any of the calls fail (menu shows at the pet window's top-left).
fn pet_cursor_pos_relative(pet: &tauri::WebviewWindow) -> Result<tauri::Position, AppError> {
    let cursor = pet.cursor_position().map_err(|e| e.to_string())?;
    let win = pet.outer_position().map_err(|e| e.to_string())?;
    let size = pet.outer_size().map_err(|e| e.to_string())?;
    let scale_factor = pet.scale_factor().unwrap_or(1.0);
    // Tauri returns physical px with top-left origin. muda's popup_menu_at
    // takes Position in logical points (top-left origin, Y-down); it flips
    // Y internally to NSView's bottom-left.
    let dx = (cursor.x - win.x as f64) / scale_factor;
    let dy = (cursor.y - win.y as f64) / scale_factor;
    // Clamp to the pet window's bounds so the menu origin is always inside
    // the window (muda attaches the menu to the view, an out-of-bounds
    // origin can render the menu off-screen).
    let max_x = size.width as f64 / scale_factor;
    let max_y = size.height as f64 / scale_factor;
    let dx = dx.clamp(0.0, max_x.max(0.0));
    let dy = dy.clamp(0.0, max_y.max(0.0));
    Ok(tauri::Position::Logical(tauri::LogicalPosition::new(dx, dy)))
}

// ────────────────────────────────────────────────────────────────────────────
// Pet quick-action panel window (`pet-panel`).
//
// The panel is a second managed Tauri window (label `pet-panel`) shown on pet
// left-click. It is opaque, decorated:false, always-on-top, skipTaskbar, and
// hidden at launch. Positioning + show/hide are driven by these Rust commands
// so the pet frontend's `invoke` calls bypass the ACL (only built-in `core:*`
// plugin commands are ACL-gated; custom invoke commands are not). The panel
// frontend still needs `capabilities/pet-panel.json` for its own
// `@tauri-apps/api/window` calls (hide on Esc/close, drag, listen for events).
// ────────────────────────────────────────────────────────────────────────────

const PET_PANEL_LABEL: &str = "pet-panel";

/// Show the pet-panel window and set focus. The caller sets the window's
/// position via `pet_panel_set_position` first (or right after) so the panel
/// appears next to the pet.
///
/// After `set_focus()` (which activates the Quill app + makes the panel key),
/// this also makes the **WKWebView** the first responder via
/// `makeFirstResponder:` on the main thread. `set_focus()` alone makes the
/// WINDOW key but does NOT make the WKWebView first responder — `document`
/// never receives `keydown` until a click makes the webview FR. This is the
/// deterministic Esc fix: `makeFirstResponder(wkwebview)` → AppKit delivers
/// `keyDown:` to the webview → the DOM `document` receives `keydown` → the
/// React Esc listener fires without a click. See
/// `research/makefirstresponder-keyboard.md` — the crate's own
/// `show_and_make_key` does `makeFirstResponder: &*content_view` (the tao
/// parent view, NOT the WKWebView), which routes `keyDown:` to the wrong
/// target; we must target the WKWebView ns_view specifically.
#[tauri::command]
pub async fn pet_panel_show(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.show().map_err(|e| e.to_string())?;
    // `set_focus()` activates the Quill app (`activateIgnoringOtherApps:YES`)
    // so the pet-panel becomes the active app's key window — required for
    // the React Esc keydown listener to fire (otherwise keyboard events go
    // to whatever app was frontmost, e.g. VS Code, and Esc can't close the
    // panel). The side effect: when the panel hides, the main Quill editor
    // stays frontmost instead of returning to the user's previous app.
    // Restoring the previous app needs `NSWorkspace.frontmostApplication`
    // tracking + `activateWithOptions:` on hide — out of scope for this fix.
    panel.set_focus().map_err(|e| e.to_string())?;

    // Make the WKWebView (NOT the contentView / parent view) the first
    // responder so `document` receives `keydown` → Esc works without a click.
    // Reuses the `pet_make_transparent` `with_webview` accessor pattern:
    // `webview.inner()` = WKWebView pointer, `webview.ns_window()` = NSWindow.
    // Must run on the main thread (AppKit API); `with_webview` schedules the
    // closure onto the macOS main run loop. The panel is shown/hidden (not
    // recreated), so `makeFirstResponder` must be re-applied on every show —
    // after `orderOut` (hide) the first responder resigns and is NOT
    // auto-restored on the next `makeKeyAndOrderFront` for a nonactivating
    // panel.
    #[cfg(target_os = "macos")]
    {
        use objc::runtime::Object;
        use objc::{msg_send, sel, sel_impl};
        panel
            .with_webview(move |webview| {
                unsafe {
                    let wk = webview.inner() as *mut Object;
                    let ns = webview.ns_window() as *mut Object;
                    if ns.is_null() || wk.is_null() {
                        return;
                    }
                    let _: () = msg_send![ns, makeFirstResponder: wk];
                }
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Hide the pet-panel window without closing it (the window stays alive for
/// the next show). Used by the close button, Esc, and the second pet click.
#[tauri::command]
pub async fn pet_panel_hide(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.hide().map_err(|e| e.to_string())?;
    // ponytail: emit the fade-out event so PetPanelApp resets `is-visible`.
    // The previous blur-based `isVisible()` check in PetPanelApp's
    // onFocusChanged was unreliable during the app activation that
    // `set_focus()` (in pet_panel_show) triggers — `isVisible()` could
    // return false momentarily mid-activation, causing setVisible(false)
    // to interrupt the fade-in transition → 忽隐忽现 (flicker: appear,
    // vanish, reappear). The explicit event fires ONLY on actual hide, so
    // the fade-in transition is never interrupted by spurious blur events.
    // File-upload (NSOpenPanel steals key window → blur, but panel still
    // visible) does NOT emit this event → panel stays at opacity:1.
    let _ = app.emit("pet://panel-fade-out", ());
    Ok(())
}

/// Shared pet-panel global-shortcut state. Holds the currently-registered
/// pet-panel HotKey so `pet_panel_set_shortcut` can do a TARGETED unregister
/// of just the previous pet HotKey — NOT `unregister_all`, which would also
/// wipe the voice push-to-talk HotKey registered by `voice::voice_set_global_hotkey`.
/// See the "Multiple OS-wide Shortcuts" scenario in
/// `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — the
/// `unregister_all` here was the root cause of bug #3 (pet-panel mount wiped
/// the voice hotkey registered at main-window mount).
///
/// `None` = no pet-panel shortcut currently registered. `Shortcut`
/// (= `global_hotkey::HotKey`) is `Copy + Send + Sync`, so storing it in a
/// `Mutex` is cheap and safe — same shape as `voice::VoiceState::voice_hotkey`.
pub struct PetShortcutState(pub Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>);

impl PetShortcutState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// Snapshot of the currently-registered pet HotKey (Copy). `None` when
    /// no pet shortcut is registered. Unwrap-to-None on a poisoned lock so
    /// a poisoned lock never breaks shortcut re-registration.
    pub fn hotkey(&self) -> Option<tauri_plugin_global_shortcut::Shortcut> {
        self.0.lock().ok().and_then(|guard| *guard)
    }

    /// Swap the stored HotKey. Silently ignores a poison error.
    pub fn set_hotkey(&self, hotkey: Option<tauri_plugin_global_shortcut::Shortcut>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = hotkey;
        }
    }
}

impl Default for PetShortcutState {
    fn default() -> Self {
        Self::new()
    }
}

/// Register (or replace) the global keyboard shortcut that toggles the
/// pet-panel window. Pass an empty string to unregister without re-binding.
///
/// The accelerator string follows Tauri's accelerator grammar
/// (e.g. `"Cmd+Shift+Q"`, `"CommandOrControl+Shift+Q"`). The plugin is built
/// with a single global handler (see `lib.rs` `tauri_plugin_global_shortcut::Builder`)
/// that dispatches by HotKey id — the voice HotKey emits `voice://hotkey-*`,
/// every other registered HotKey (currently just this one) emits
/// `pet://shortcut-toggle` on Pressed. This command only swaps WHICH
/// accelerator fires the pet-panel branch.
///
/// Bug #3 fix: TARGETED unregister of the previously-stored pet HotKey only,
/// NOT `unregister_all`. The pet window mounts at app startup (visible:false
/// still loads the webview → PetApp mount effect calls this command), so the
/// previous `unregister_all` impl wiped the voice hotkey registered by
/// `App.tsx`'s mount effect. Migrated to the same targeted-unregister shape
/// as `voice::voice_set_global_hotkey` — the two accelerators are now
/// independent.
#[tauri::command]
pub async fn pet_panel_set_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), AppError> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    use std::str::FromStr;

    let state = app.state::<PetShortcutState>();

    // Targeted unregister: only the previously-stored pet HotKey, leaving
    // the voice HotKey (and any other feature's) intact.
    let prev = state.hotkey();
    if let Some(prev_hotkey) = prev {
        let _ = app.global_shortcut().unregister(prev_hotkey);
    }

    if accelerator.trim().is_empty() {
        // Unregister-only path.
        state.set_hotkey(None);
        return Ok(());
    }

    // Parse so we store a HotKey (Copy) — the catch-all in `lib.rs` compares
    // by id, so storing the parsed HotKey (not the string) lets it recognize
    // this shortcut's fired events. Registering via the HotKey (not the
    // string) keeps parse + register consistent.
    let hotkey = Shortcut::from_str(&accelerator)
        .map_err(|e| format!("invalid pet-panel shortcut '{accelerator}': {e}"))?;
    app.global_shortcut()
        .register(hotkey)
        .map_err(|e| format!("register pet-panel shortcut failed: {e}"))?;
    state.set_hotkey(Some(hotkey));
    log::info!("[pet] global shortcut registered: {accelerator}");
    Ok(())
}

/// Size payload for `pet_panel_get_size` (physical px, matches Tauri's
/// `PhysicalSize`).
#[derive(Serialize)]
pub struct PetPanelSize {
    pub width: i32,
    pub height: i32,
}

/// Set the pet-panel window's screen position (physical pixels). The pet
/// frontend computes a clamped position next to the pet (using
/// `pet_get_work_area`) and passes it here so Rust stays the single source of
/// truth for window mutation.
#[tauri::command]
pub async fn pet_panel_set_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Get the pet-panel window's current screen position (physical pixels).
#[tauri::command]
pub async fn pet_panel_get_position(app: tauri::AppHandle) -> Result<PetPosition, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    let pos = panel.outer_position().map_err(|e| e.to_string())?;
    Ok(PetPosition { x: pos.x, y: pos.y })
}

/// Set the pet-panel window's size (physical pixels). Used to restore a
/// persisted size on panel open. The window is declared `resizable: true`
/// with `minWidth/minHeight` in tauri.conf.json, so the OS enforces a floor.
#[tauri::command]
pub async fn pet_panel_set_size(
    app: tauri::AppHandle,
    width: i32,
    height: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Get the pet-panel window's current size (physical pixels). Used by the
/// panel frontend's periodic poller to detect a user-driven resize and
/// persist the new size.
#[tauri::command]
pub async fn pet_panel_get_size(app: tauri::AppHandle) -> Result<PetPanelSize, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    let size = panel.outer_size().map_err(|e| e.to_string())?;
    Ok(PetPanelSize {
        width: size.width as i32,
        height: size.height as i32,
    })
}

/// Returns whether the pet-panel window is currently visible. The pet
/// frontend uses this for the toggle-on-second-click decision.
#[tauri::command]
pub async fn pet_panel_is_visible(app: tauri::AppHandle) -> Result<bool, AppError> {
    let panel = app
        .get_webview_window(PET_PANEL_LABEL)
        .ok_or_else(|| "pet-panel window not found".to_string())?;
    panel.is_visible().map_err(|e| AppError::from(e.to_string()))
}

// ────────────────────────────────────────────────────────────────────────────
// Pet bubble notification window (`pet-bubble`).
//
// A transparent, decorations:false, skipTaskbar NSPanel window that pops a
// speech bubble above the pet on `pet://bubble-show`. Shown/hidden/positioned
// via these custom invoke commands so the bubble frontend's calls bypass the
// ACL (mirrors the `pet-panel` command pattern). The bubble window's own
// capability file grants only `core:event` (listen for `pet://bubble-show`,
// emit `pet://bubble-action`) — no `core:window:*` perms are needed because
// all window mutation goes through these commands.
// ────────────────────────────────────────────────────────────────────────────

const PET_BUBBLE_LABEL: &str = "pet-bubble";

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `PetMenuLabel` key resolves to a non-empty string in both zh
    /// and en. Catches a future key added to the enum but forgotten in one
    /// of the match arms. (Size labels are locale-neutral "50%" etc., so the
    /// zh≠en assertion is dropped — only non-empty is asserted.)
    #[test]
    fn pet_menu_labels_cover_all_keys_in_both_locales() {
        let keys = [
            PetMenuLabel::ShowMain,
            PetMenuLabel::HidePet,
            PetMenuLabel::SizeSubmenu,
            PetMenuLabel::Size50,
            PetMenuLabel::Size75,
            PetMenuLabel::Size100,
            PetMenuLabel::Size125,
            PetMenuLabel::Size150,
            PetMenuLabel::OpacitySubmenu,
            PetMenuLabel::Opacity25,
            PetMenuLabel::Opacity50,
            PetMenuLabel::Opacity75,
            PetMenuLabel::Opacity100,
            PetMenuLabel::ClickThrough,
            PetMenuLabel::ExitApp,
            PetMenuLabel::TestBubble,
        ];
        for key in keys {
            let zh = pet_menu_label("zh", key);
            let en = pet_menu_label("en", key);
            assert!(!zh.is_empty(), "zh label empty for key");
            assert!(!en.is_empty(), "en label empty for key");
        }
    }

    /// Unknown locale falls back to en (not panic, not empty).
    #[test]
    fn pet_menu_label_unknown_locale_falls_back_to_en() {
        assert_eq!(pet_menu_label("fr", PetMenuLabel::ShowMain), "Show Main Window");
    }

    #[test]
    fn app_menu_labels_cover_all_keys_in_both_locales() {
        assert_eq!(app_menu_label("zh", AppMenuLabel::Edit), "编辑");
        assert_eq!(app_menu_label("zh", AppMenuLabel::Window), "窗口");
        assert_eq!(app_menu_label("en", AppMenuLabel::Edit), "Edit");
        assert_eq!(app_menu_label("en", AppMenuLabel::Window), "Window");
        assert_eq!(app_menu_label("fr", AppMenuLabel::Edit), "Edit");
    }
}
