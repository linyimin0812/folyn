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
//! Runtime switch: `FOLYN_PET_PANEL_BACKEND=legacy` falls back to the old
//! NSWindow + ScreenSaver-level + behavior-770 path (`reapply_pet_topmost`).
//! Default (unset / `nspanel`) uses this backend.

use tauri::{AppHandle, Manager};
use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel};

/// ponytail: shut down TouchBar autorecalculation on a swizzled NSPanel.
/// `to_panel()` swaps the window's class via `object_setClass` AFTER macOS's
/// Touch Bar finder has already registered a `nextResponder` KVO observer
/// on the original NSWindow class. When the finder later invalidates
/// (window deinit / responder-chain change), it tries to remove the
/// observer from the post-swap class (`FolynPetPanel`/`FolynPanelWindow`/
/// `FolynVoiceOrbPanel`) and throws `NSRangeException` —
/// `_NSTouchBarFinderObservation … because it is not registered as an
/// observer`. Setting `autorecalculatesTouchBar = NO` skips the recalc
/// path that triggers the unregister, so the stale KVO registration is
/// never exercised. `setAutorecalculatesTouchBar:` is not in the
/// objc2-app-kit generated bindings (only `makeTouchBar` is exposed), so
/// we go through raw `msg_send!` — mirrors the `setLevel:` /
/// `setCollectionBehavior:` pattern in `lib.rs:154-170`.
///
/// ponytail: relies on the caller's `exception::catch`. `msg_send!` panics
/// on Obj-C exceptions, but `convert_windows` wraps every per-panel block
/// in `objc2::exception::catch`, which intercepts NSException at the
/// Obj-C layer (independent of Rust panic strategy) — the same approach
/// the previous `setAutorecalculatesTouchBar:`-only catch did, lifted to
/// cover `to_panel()` / `set_level` / `set_style_mask` / etc. too. Re-add
/// a local catch if this is ever called outside `convert_windows`.
fn disable_touch_bar_recalc(panel: &tauri_nspanel::NSPanel) {
    use tauri_nspanel::objc2::msg_send;
    let _: () = unsafe { msg_send![panel, setAutorecalculatesTouchBar: false] };
}

tauri_panel! {
    panel!(FolynPetPanel {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false,
        }
        // ponytail: NO `with: { tracking_area }` here. The crate's
        // `add_tracking_area` (panel.rs:659-692) hardcodes `owner: contentView`
        // (a stock NSView), but the `cursorUpdate:` override that forwards to
        // the delegate lives on the PANEL subclass — a different object.
        // `cursorUpdate:` is dispatched directly to the TA owner; a stock
        // NSView's default impl does nothing and does NOT forward to
        // nextResponder, so the panel's override + the `on_cursor_update`
        // closure NEVER fire. We add the TA manually in `convert_windows`
        // with `owner = the panel` (the object with the override). See
        // research/cursor-nonfrontmost-followup.md (Q1, Q3c option d).
    })
    panel!(FolynPanelWindow {
        config: {
            is_floating_panel: true,
            can_become_key_window: true,
            can_become_main_window: false,
        }
    })
    // ponytail: voice-orb is a pure-display WebGL waveform overlay (pointer
    // events pass through to the app behind). It must NEVER become key —
    // otherwise when Folyn is the frontmost app the orb would intercept the
    // post-recording CGEvent Cmd+V (no text field in the orb → paste lost).
    // Pet/bubble panels keep `can_become_key_window: true` for cursor-on-hover;
    // the orb has no hover interaction so it loses nothing by being non-key.
    panel!(FolynVoiceOrbPanel {
        config: {
            is_floating_panel: true,
            can_become_key_window: false,
            can_become_main_window: false,
        }
    })
    // ponytail: empty delegate body — the mouse callbacks (on_cursor_update,
    // on_mouse_exited, etc.) are built into every panel_event! handler; we
    // just need the class to exist so we can attach it via set_event_handler.
    panel_event!(FolynPetEventHandler {
    })
}

/// Returns true when the NSPanel backend is active (default). Set
/// `FOLYN_PET_PANEL_BACKEND=legacy` to fall back to the old NSWindow +
/// ScreenSaver-level path for safe rollback.
pub fn backend_is_nspanel() -> bool {
    match std::env::var("FOLYN_PET_PANEL_BACKEND") {
        Ok(v) => !v.eq_ignore_ascii_case("legacy"),
        Err(_) => true,
    }
}

/// `[DEBUG-toolwin]` probe log — append-only file in /tmp so the runtime
/// state is readable without the dev terminal. TEMPORARY instrumentation
/// for the "extension popup only opens above Folyn" bug (called from
/// `commands/webview_commands.rs` through a cfg'd wrapper); remove
/// everything by grepping the `DEBUG-toolwin` tag.
pub(crate) fn dbg_toolwin_log(msg: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/folyn-toolwin-debug.log")
    {
        let _ = writeln!(f, "[DEBUG-toolwin {}] {}", ts, msg);
    }
}

/// Raise a dynamically-created Tauri window to the global floating tier so
/// it appears over the frontmost app (including fullscreen apps) without
/// activating Folyn. Used by `open_extension_tool_window` for sandbox
/// extension popups triggered from the pet panel while the user is in
/// another app.
///
/// Space model (space-switch experiment, 2026-09-18 — the earlier notes'
/// conclusion was half-right and the missing half cost a day): a window
/// shows on every Space iff its behavior is
/// `CanJoinAllSpaces | **Stationary** | fullScreenAuxiliary` (1 + 16 +
/// 256 = 273 — the FULL pet-panel recipe). Experiment matrix with a
/// space-switch canary window (flips `isOnActiveSpace` when the Space
/// really changes): no-stationary combos (with or without panel class)
/// PIN to one Space; stationary combos — plain NSWindow AND NSPanel alike —
/// stay on the active Space across switches. The pet panels work because
/// of Stationary, not because they are panels.
///
/// Constant values verified against objc2-app-kit's SDK-generated bindings
/// (the codebase's old comments had them wrong — e.g. "stationary(2)" is
/// actually MoveToActiveSpace, real Stationary is 16):
///   CanJoinAllSpaces = 1<<0, MoveToActiveSpace = 1<<1, Stationary = 1<<4,
///   FullScreenAuxiliary = 1<<8, FullScreenAllowsTiling = 1<<11.
///
/// Deliberately raw `msg_send!` on the plain NSWindow — NOT `to_panel()` /
/// any class swap. Three separate crashes (contentView unwrap panic;
/// style-mask strip → frame rebuild → detached contentView; close-time
/// uncatchable Obj-C exception) all came from the class-swap family. These
/// window-server-only calls (same category as `reapply_pet_topmost`, which
/// runs indefinitely on the pet) cannot reproduce any of them: no content
/// view access, no style change, no lifecycle interference.
///
/// Must run on the macOS main thread (caller schedules via
/// `run_on_main_thread`). Sets:
///   - `setLevel:` ScreenSaver (`CGWindowLevelForKey(13)`) — above every
///     normal app window (and above the pet panels at Dock level);
///   - `setCollectionBehavior:` CanJoinAllSpaces | Stationary |
///     fullScreenAuxiliary (1 + 16 + 256 = 273);
///   - `orderFrontRegardless` — only when `order_front` is true (initial
///     raise / singleton re-surface). The 500ms reapply loop calls with
///     false: re-`orderFront` every tick is what macOS interprets as "the
///     user wants this window" and ACTIVATES the app (the "自动切换到 folyn"
///     regression); `reapply_pet_topmost` never orders front either.
///
/// Wrapped in `objc2::exception::catch` (worst case the level stays
/// Floating, no abort). Logs the post-state readback to
/// `/tmp/folyn-toolwin-debug.log` (temporary `[DEBUG-toolwin]` probes).
/// Returns true when the level/behavior were applied.
pub fn convert_window_to_floating_panel(
    window: &tauri::WebviewWindow,
    order_front: bool,
) -> bool {
    use std::panic::AssertUnwindSafe;
    use tauri_nspanel::objc2::exception::catch;
    use tauri_nspanel::objc2::msg_send;
    use tauri_nspanel::objc2::runtime::AnyObject;

    let log = |msg: &str| dbg_toolwin_log(msg);

    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    const KCG_SCREENSAVER_WINDOW_LEVEL_KEY: i32 = 13;

    let Ok(ns_window) = window.ns_window() else {
        log("raise: no ns_window handle");
        return false;
    };
    let ns = ns_window as *mut AnyObject;
    if ns.is_null() {
        log("raise: null ns_window");
        return false;
    }
    let applied = catch(AssertUnwindSafe(|| unsafe {
        // 64-bit `setLevel:` takes NSInteger — the `as isize` cast widens
        // the i32 CG level (same cast as `reapply_pet_topmost` in lib.rs).
        let level = CGWindowLevelForKey(KCG_SCREENSAVER_WINDOW_LEVEL_KEY) as isize;
        let _: () = msg_send![ns, setLevel: level];
        const CB_CAN_JOIN_ALL_SPACES: isize = 1 << 0; // 1
        const CB_STATIONARY: isize = 1 << 4; // 16 — the load-bearing bit
        const CB_FULLSCREEN_AUXILIARY: isize = 1 << 8; // 256
        let behavior: isize =
            CB_CAN_JOIN_ALL_SPACES | CB_STATIONARY | CB_FULLSCREEN_AUXILIARY;
        let _: () = msg_send![ns, setCollectionBehavior: behavior];
        if order_front {
            let _: () = msg_send![ns, orderFrontRegardless];
        }
    }));
    let ok = applied.is_ok();
    // Probe readback: level / behavior / space membership after the raise.
    // `Bool` (objc2's BOOL wrapper, FFI-safe for msg_send!) → as_bool().
    let level: isize = unsafe { msg_send![ns, level] };
    let behavior: isize = unsafe { msg_send![ns, collectionBehavior] };
    let on_active_space = unsafe {
        let b: tauri_nspanel::objc2::runtime::Bool = msg_send![ns, isOnActiveSpace];
        b.as_bool()
    };
    log(&format!(
        "raise: applied={} level={} behavior={} onActiveSpace={}",
        ok, level, behavior, on_active_space
    ));
    ok
}

/// Prewarm the `extension-tool-panel` at startup: order it front ONCE with
/// alpha 0 + ignoresMouseEvents so it stops being the app's "first window".
/// macOS activates the whole app when the FIRST window of a windowless app
/// is ordered front (the "第一次触发跳转到 folyn" bug: in pet mode the main
/// window is hidden, so the tool panel's first orderFront activated Folyn;
/// subsequent hide→show cycles don't, which is exactly the observed
/// first-time-only behavior). Ordering it during setup — while the app is
/// legitimately activating its own windows at launch — burns that first-window
/// slot invisibly. Must run on the macOS main thread (called from
/// `apply_pet_backend_init` after `convert_windows`).
pub fn prewarm_extension_tool_panel(app: &AppHandle) {
    use std::panic::AssertUnwindSafe;
    use tauri_nspanel::objc2::exception::catch;
    use tauri_nspanel::objc2::msg_send;
    use tauri_nspanel::objc2::runtime::AnyObject;

    let Some(window) = app.get_webview_window("extension-tool-panel") else {
        return;
    };
    let Ok(ns_window) = window.ns_window() else { return };
    let ns = ns_window as *mut AnyObject;
    if ns.is_null() {
        return;
    }
    let _ = catch(AssertUnwindSafe(|| unsafe {
        let _: () = msg_send![ns, setAlphaValue: 0.0f64];
        let _: () = msg_send![ns, setIgnoresMouseEvents: true];
        let _: () = msg_send![ns, orderFrontRegardless];
    }));
    dbg_toolwin_log("prewarm: ordered invisible (alpha 0 + ignoresMouse)");
}

/// Surface the `extension-tool-panel` (the sandbox extension popup) without
/// activating Folyn. Must run on the macOS main thread. The window was
/// converted to a nonactivating NSPanel at startup (`convert_windows`) and
/// prewarmed there (`prewarm_extension_tool_panel` — alpha 0, first-window
/// slot burned), so this restores alpha/mouse and orders front without
/// `makeKeyAndOrderFront:` — no IMK observer attach, no app switch. The
/// panel-recipe re-assert (behavior 273 + hidesOnDeactivate) is idempotent
/// insurance against AppKit/tauri downgrades — attribute-only, NEVER
/// `to_panel`/`object_setClass` here (one class swap per window, ever — see
/// the crash ledger in the spec).
pub fn surface_extension_tool_panel(window: &tauri::WebviewWindow) -> bool {
    use std::panic::AssertUnwindSafe;
    use tauri_nspanel::objc2::exception::catch;
    use tauri_nspanel::objc2::msg_send;
    use tauri_nspanel::objc2::runtime::AnyObject;
    use tauri_nspanel::ManagerExt;

    let app = window.app_handle();
    // Re-assert the panel attributes through the panel store (no class
    // swap). Not-converted (legacy backend / store miss) → fall back to the
    // plain-window raise.
    if let Ok(panel) = app.get_webview_panel(window.label()) {
        let _ = catch(AssertUnwindSafe(|| {
            // 273 = CanJoinAllSpaces(1) | Stationary(16) | FullScreenAuxiliary(256)
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .stationary()
                    .can_join_all_spaces()
                    .full_screen_auxiliary()
                    .into(),
            );
            panel.set_hides_on_deactivate(false);
        }));
    } else {
        crate::pet_panel_macos::convert_window_to_floating_panel(window, true);
    }
    let applied = catch(AssertUnwindSafe(|| unsafe {
        let Ok(ns_window) = window.ns_window() else { return false };
        let ns = ns_window as *mut AnyObject;
        if ns.is_null() {
            return false;
        }
        // Undo the prewarm state (alpha 0 + ignoresMouse) — the prewarm only
        // runs once at startup, but restoring unconditionally is idempotent.
        let _: () = msg_send![ns, setAlphaValue: 1.0f64];
        let _: () = msg_send![ns, setIgnoresMouseEvents: false];
        let _: () = msg_send![ns, orderFrontRegardless];
        true
    }));
    let ok = applied.unwrap_or(false);
    dbg_toolwin_log(&format!("surface: orderFrontRegardless applied={}", ok));
    ok
}

/// Convert the `pet`, `pet-panel`, `pet-bubble`, and `pet-corner` windows into
/// NSPanels with the fullscreen-overlay configuration. Must run on the macOS
/// main thread (NSWindow API is main-thread-only). `to_panel()` swaps the
/// window's class in place; calling it again on an already-converted window
/// re-asserts the class and re-applies level/style/behavior. Returns the
/// count of windows successfully converted.
///
/// Two panel types are used: `FolynPetPanel` for the `pet` mascot,
/// `pet-bubble`, and `pet-corner` (no keyboard interaction;
/// `can_become_key_window: true` so the webview can become key for CSS
/// cursor updates after a click — plain hover doesn't update the cursor
/// without a click on macOS because the panel isn't key until clicked), and
/// `FolynPanelWindow` for the `pet-panel`, which needs keyboard focus for
/// its Esc keydown listener (`pet_panel_show` calls Tauri's `set_focus()`,
/// which activates the Folyn app and makes the panel key).
/// Both get the same level/style/collection recipe: `Dock` level +
/// `nonactivating_panel` + `stationary | can_join_all_spaces |
/// full_screen_auxiliary` (273). The `pet-panel` is opaque (not transparent)
/// but still benefits from the panel tier — a regular `alwaysOnTop` NSWindow
/// at Floating level cannot rise over a fullscreen app, but an NSPanel at Dock
/// level with `full_screen_auxiliary` can.
pub fn convert_windows(app: &AppHandle) -> usize {
    // ponytail: use tauri_nspanel's re-exported objc2 (0.6.4 via
    // tauri-nspanel's `v2.1` branch) — the project also depends on
    // objc2 directly, and the `Message` trait is not compatible across
    // major versions.
    use std::panic::AssertUnwindSafe;
    use tauri_nspanel::objc2::exception::catch;
    // The nspanel plugin provides the `ManagerExt` panel store (label-based
    // lookup). Registering it is also what BongoCat does before `to_panel()`.
    let _ = app.plugin(tauri_nspanel::init());

    let mut count = 0;

    // Pet mascot.
    if let Some(window) = app.get_webview_window("pet") {
        // ponytail: wrap in `exception::catch` — `to_panel()` / `set_*` /
        // `set_event_handler` go through objc2 bindings that panic on Obj-C
        // exceptions (swizzled NSPanel KVO / TouchBar recalc paths). `catch`
        // intercepts NSException at the Obj-C layer, independent of Rust
        // panic strategy — keeps `panic = "abort"` viable for binary size.
        // Worst case: panel stays as a plain NSWindow, no SIGABRT.
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPetPanel>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                // ponytail: `move_to_active_space` (not `can_join_all_spaces`) —
                // matches BongoCat `core/setup/macos.rs:41-46`. The
                // `moveToActiveSpace` flag (1<<7=128) routes the panel through
                // AppKit's active-space re-evaluation, which has a z-order re-
                // evaluation side-effect on app-switch. Combo value:
                // stationary(2) | move_to_active_space(128) | full_screen_auxiliary(256)
                // = 386.
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .move_to_active_space()
                        .full_screen_auxiliary()
                        .into(),
                );
                // ponytail: `setHidesOnDeactivate:NO` — the nspanel Panel trait
                // method (src/panel.rs:438). `nonactivating_panel` only controls
                // focus stealing, NOT hide-on-deactivate: AppKit still hides a
                // panel by default on `NSApplicationDidResignActive`, which is the
                // source of the "click to bring pet back" delay. Disabling it
                // keeps the pet visible across app-switches; the resign-active
                // observer then only re-asserts level/behavior (a run-loop tick,
                // not a window-server draw cycle).
                panel.set_hides_on_deactivate(false);
                // ponytail: attach the (empty-body) delegate — BongoCat
                // `core/setup/macos.rs:91`. Without a delegate attached via
                // `set_event_handler`, the swizzled NSPanel subclass's override
                // methods (which make `is_floating_panel: true` +
                // `can_become_key_window: true` actually take effect on a swizzled
                // class) may not route correctly; the float-on-deactivate behavior
                // is partly delegate-driven.
                let handler = FolynPetEventHandler::new();
                panel.set_event_handler(Some(handler.as_ref()));
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Pet-panel — needs key window for Esc; set_focus() makes it key on show.
    if let Some(window) = app.get_webview_window("pet-panel") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPanelWindow>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Extension-tool-panel — the sandbox extension popup, pet-panel
    // machinery (the "桌宠弹窗同款" architecture): statically declared in
    // tauri.conf.json, converted HERE AT SETUP (the one proven-safe
    // conversion moment — the window exists, the app event loop is fresh,
    // and nothing has interacted with it yet), then shown/hidden for its
    // whole life (never destroyed, never re-converted — see the crash
    // ledger in .trellis/spec/desktop/frontend/tauri-window-patterns.md for
    // why dynamic creation + runtime conversion kept crashing). Loads the
    // extension's tool page via iframe from the #/extension-tool host route;
    // the extension-rpc-request event is dispatched by the MAIN window's
    // listener (Tauri events are global), so this window needs no RPC wiring.
    if let Some(window) = app.get_webview_window("extension-tool-panel") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPanelWindow>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                // AppKit hides a panel on app-deactivate by default; Folyn
                // stays background while the user works elsewhere.
                panel.set_hides_on_deactivate(false);
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Pet-bubble — clickable notification bubble, no keyboard needed; same
    // non-key panel as the mascot so first clicks on action buttons deliver
    // immediately.
    if let Some(window) = app.get_webview_window("pet-bubble") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPetPanel>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Pet-corner — passive notification toast stack at a screen corner; same
    // non-key panel as the mascot and bubble so first clicks on action
    // buttons deliver immediately.
    if let Some(window) = app.get_webview_window("pet-corner") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPetPanel>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Pet-menu — HTML right-click context menu (replaces native NSMenu so the
    // menu can be positioned adaptively outside the pet view: no overlap, no
    // internal scroll). Same non-key panel as the mascot/bubble; `pet_menu_show`
    // calls `set_focus()` + `makeFirstResponder(wkwebview)` to make the panel
    // key on demand for the ESC keydown listener (mirrors `pet_panel_show`).
    if let Some(window) = app.get_webview_window("pet-menu") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynPetPanel>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    // Voice orb — the SiriGL waveform window shown during voice recording. Pure
    // display (no keyboard interaction); same non-key panel as the mascot so it
    // appears without stealing focus from the foreground app (the user is
    // dictating into VS Code, the browser, etc. — focus must stay there so the
    // post-recording CGEvent Cmd+V lands in the right field). Transparent so
    // the WebGL canvas floats over the desktop without an opaque square.
    if let Some(window) = app.get_webview_window("voice-orb") {
        let _ = catch(AssertUnwindSafe(|| {
            if let Ok(panel) = window.to_panel::<FolynVoiceOrbPanel>() {
                panel.set_level(PanelLevel::Dock.value());
                panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
                panel.set_collection_behavior(
                    CollectionBehavior::new()
                        .stationary()
                        .can_join_all_spaces()
                        .full_screen_auxiliary()
                        .into(),
                );
                disable_touch_bar_recalc(panel.as_panel());
                count += 1;
            }
        }));
    }

    count
}
