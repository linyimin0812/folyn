//! macOS NSPanel backend for the `pet` window (and later `pet-panel`).
//!
//! Converts the Tauri `WebviewWindow` into a real `NSPanel` via the
//! `tauri-nspanel` crate's `to_panel()` — the BongoCat-proven recipe for
//! appearing over fullscreen apps. See
//! `.trellis/tasks/07-06-pet-overlay-on-fullscreen-apps/research/tauri-nspanel-to-panel-safety.md`.
//!
//! `to_panel()` uses `object_setClass` (same primitive as our reverted
//! `c2269ab` attempt), BUT swaps onto a custom `objc2`-defined `RawNsPanel`
//! subclass with an **empty ivar struct** and **mouse-event method overrides**
//! that forward to the window delegate — the materially different design that
//! prevents the click crash our base-`NSPanel` + `objc 0.2.7` + no-override
//! swap hit (commit `c2269ab`, reverted `81bc9b8`).
//!
//! Configuration (mirrors BongoCat `src-tauri/src/core/setup/macos.rs:33-49`):
//!   - `PanelLevel::Dock` (20) — above normal floating windows, below
//!     ScreenSaver. Dock level + `nonactivating_panel` is the panel tier
//!     AppKit routes into the fullscreen-auxiliary layer.
//!   - `StyleMask::nonactivating_panel()` — does not steal focus from the
//!     foreground app; `can_become_main_window: false` (panel config) keeps
//!     the pet out of the key-window chain except for explicit interaction.
//!   - `collectionBehavior = stationary | can_join_all_spaces |
//!     full_screen_auxiliary` (273) — the documented floating-panel combo
//!     (Spotlight / Notification Center use the same). The earlier note that
//!     `stationary` conflicts with `canJoinAllSpaces` was a misdiagnosis
//!     specific to a vanilla NSWindow at ScreenSaver level; on a real NSPanel
//!     at Dock level the combo works (BongoCat ships it).
//!
//! Runtime switch: `QUILL_PET_PANEL_BACKEND=legacy` falls back to the old
//! NSWindow + ScreenSaver-level + behavior-770 path (`reapply_pet_topmost`).
//! Default (unset / `nspanel`) uses this backend.

use tauri::{AppHandle, Manager};
use tauri_nspanel::{
    CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel,
};

tauri_panel! {
    panel!(QuillPetPanel {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false,
        }
    })
    panel!(QuillPanelWindow {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false,
        }
    })
}

/// Returns true when the NSPanel backend is active (default). Set
/// `QUILL_PET_PANEL_BACKEND=legacy` to fall back to the old NSWindow +
/// ScreenSaver-level path for safe rollback.
pub fn backend_is_nspanel() -> bool {
    match std::env::var("QUILL_PET_PANEL_BACKEND") {
        Ok(v) => !v.eq_ignore_ascii_case("legacy"),
        Err(_) => true,
    }
}

/// Convert the `pet`, `pet-panel`, and `pet-bubble` windows into NSPanels with the
/// fullscreen-overlay configuration. Must run on the macOS main thread
/// (NSWindow API is main-thread-only). `to_panel()` swaps the window's class
/// in place; calling it again on an already-converted window re-asserts the
/// class and re-applies level/style/behavior. Returns the count of windows
/// successfully converted.
///
/// Two panel types are used: `QuillPetPanel` for the `pet` mascot and
/// `pet-bubble` (no keyboard interaction; `can_become_key_window: true` so
/// the webview can become key for CSS cursor updates after a click — plain
/// hover doesn't update the cursor without a click on macOS because the
/// panel isn't key until clicked), and `QuillPanelWindow` for the
/// `pet-panel`, which needs keyboard focus for its Esc keydown listener
/// (`pet_panel_show` calls Tauri's `set_focus()`, which activates the Quill
/// app and makes the panel key).
/// Both get the same level/style/collection recipe: `Dock` level +
/// `nonactivating_panel` + `stationary | can_join_all_spaces |
/// full_screen_auxiliary` (273). The `pet-panel` is opaque (not transparent)
/// but still benefits from the panel tier — a regular `alwaysOnTop` NSWindow
/// at Floating level cannot rise over a fullscreen app, but an NSPanel at Dock
/// level with `full_screen_auxiliary` can.
pub fn convert_windows(app: &AppHandle) -> usize {
    // The nspanel plugin provides the `ManagerExt` panel store (label-based
    // lookup). Registering it is also what BongoCat does before `to_panel()`.
    let _ = app.plugin(tauri_nspanel::init());

    let mut count = 0;

    // Pet mascot.
    if let Some(window) = app.get_webview_window("pet") {
        if let Ok(panel) = window.to_panel::<QuillPetPanel>() {
            panel.set_level(PanelLevel::Dock.value());
            panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .stationary()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .into(),
            );
            count += 1;
        }
    }

    // Pet-panel — needs key window for Esc; set_focus() makes it key on show.
    if let Some(window) = app.get_webview_window("pet-panel") {
        if let Ok(panel) = window.to_panel::<QuillPanelWindow>() {
            panel.set_level(PanelLevel::Dock.value());
            panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .stationary()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .into(),
            );
            count += 1;
        }
    }

    // Pet-bubble — clickable notification bubble, no keyboard needed; same
    // non-key panel as the mascot so first clicks on action buttons deliver
    // immediately.
    if let Some(window) = app.get_webview_window("pet-bubble") {
        if let Ok(panel) = window.to_panel::<QuillPetPanel>() {
            panel.set_level(PanelLevel::Dock.value());
            panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .stationary()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .into(),
            );
            count += 1;
        }
    }

    count
}
