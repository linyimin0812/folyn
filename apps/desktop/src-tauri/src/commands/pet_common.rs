use std::sync::Mutex;
use serde::Serialize;
use tauri::Manager;

/// Shared pet-size level state ("50"|"75"|"100"|"125"|"150"). Synced from
/// the frontend via the `set_pet_size` command and from `on_menu_event` when
/// the user picks a size from the tray submenu. Read by
/// `build_pet_context_menu` to pre-check the current size radio item.
/// Defaults to `"100"` so existing users keep the 96×96 layout on first
/// right-click.
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
/// `on_menu_event` on a submenu pick; read by `build_pet_context_menu` to
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
/// `build_pet_context_menu` to pre-check the click-through menu item.
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

/// Shared handle to the tray menu's `hide_pet` `CheckMenuItem`. The tray menu
/// is built once at `tray_set_enabled` time; muda does NOT auto-toggle the
/// checkmark on click, so without `set_checked` the checkmark would go stale
/// after the first toggle. `tray_set_enabled(true)` clones the `CheckMenuItem`
/// (Arc-backed — cheap) into this state; `toggle_pet_mode` /
/// `show_pet_if_hidden` call `set_checked` on it so the checkmark tracks pet
/// visibility across all toggle paths (tray click, settings tab, pet
/// right-click popup). `None` when the tray is disabled or not yet built.
pub struct TrayHidePetItemState(pub Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>);

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

pub(crate) const PET_LABEL: &str = "pet";

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
}

/// Resolve a pet context-menu label for the given locale. `zh` → Chinese;
/// any other value (including unknown locales) falls back to English. Used
/// by `build_pet_context_menu` (tray menu) and `build_app_menu`.
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

/// Map a `PetSize` level string ("50"|"75"|"100"|"125"|"150") to the logical
/// pixel footprint of the pet window. Mirrors `PET_SIZE_TO_PX` in
/// `petPosition.ts` — keep both in sync. Used by `set_pet_size` to resolve
/// the level to a `LogicalSize`.
pub(crate) fn pet_size_to_px(level: &str) -> Option<(u32, u32)> {
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
pub(crate) fn current_pet_size_level(app: &tauri::AppHandle) -> String {
    app.state::<PetSizeState>().level()
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
pub(crate) fn pet_opacity_to_alpha(level: &str) -> Option<f64> {
    match level {
        "25" => Some(0.25),
        "50" => Some(0.50),
        "75" => Some(0.75),
        "100" => Some(1.00),
        _ => None,
    }
}

/// Compute the AppKit bottom-left origin (logical points) for the pet
/// window's top-left `(x, y)` (physical px, top-left origin) when the
/// NSPanel backend is active. Finds the Tauri monitor containing the
/// target point, matches it to an `NSScreen` by size + scale, then flips
/// Y using that screen's own `frame` (not `mainScreen`'s frame — the
/// root cause of Tauri's `set_position` bug). Returns `None` if no
/// matching monitor/screen pair is found (caller falls back to Tauri).
#[cfg(target_os = "macos")]
pub(crate) fn nspanel_target_appkit_origin(
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

/// Size payload for `pet_panel_get_size` (physical px, matches Tauri's
/// `PhysicalSize`).
#[derive(Serialize)]
pub struct PetPanelSize {
    pub width: i32,
    pub height: i32,
}

/// Tray icon id — stable so `tray_by_id` lookups (for destroy / show_menu)
/// always find the same icon regardless of how many times the user toggles
/// the setting on/off-on.
pub(crate) const TRAY_ID: &str = "quill-tray";

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

pub(crate) const PET_PANEL_LABEL: &str = "pet-panel";

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

pub(crate) const PET_BUBBLE_LABEL: &str = "pet-bubble";

// ────────────────────────────────────────────────────────────────────────────
// Pet right-click context menu window (`pet-menu`).
//
// A transparent, decorations:false, skipTaskbar NSPanel window that hosts the
// HTML right-click menu (replaces the native NSMenu so positioning can be
// adaptive — no overlap with the pet, no internal scroll). Shown/hidden/
// positioned/sized via custom invoke commands that bypass the ACL, mirroring
// the `pet-bubble` pattern. The window's own capability file grants only
// `core:event` (listen for `pet://menu-show` if needed, emit
// `pet://menu-action`) — no `core:window:*` perms.
// ────────────────────────────────────────────────────────────────────────────

pub(crate) const PET_MENU_LABEL: &str = "pet-menu";

// ────────────────────────────────────────────────────────────────────────────
// Pet corner toast window (`pet-corner`).
//
// A transparent, decorations:false, skipTaskbar NSPanel window that stacks
// passive notification toasts at a screen corner on `pet://corner-show`.
// Mirrors the `pet-bubble` panel pattern: shown/hidden/positioned/sized via
// custom invoke commands so the frontend bypasses the ACL. The window's own
// capability file grants only `core:event` (listen for `pet://corner-show`,
// emit `pet://bubble-action` — click → jump reuses the bubble's action
// channel so App.tsx's jump router is unchanged).
// ────────────────────────────────────────────────────────────────────────────

pub(crate) const PET_CORNER_LABEL: &str = "pet-corner";

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
