use tauri::Manager;

use crate::commands::pet_common::*;
use crate::errors::AppError;

/// Build and install the macOS app menu bar (Folyn / Edit / Window submenus)
/// with titles localized for `locale`. Called once from `lib.rs::setup` (with
/// `"en"` as the bootstrap default — frontend hydrates `localeStore` and
/// calls `pet_rebuild_app_menu` to sync the user's actual locale) and again
/// whenever the user switches locale. The `Folyn` submenu title is a brand
/// name and never translated; `Edit`/`Window` use `app_menu_label`.
///
/// macOS-only: both call sites are cfg-gated to `target_os = "macos"`
/// (`lib.rs::setup` and `pet_rebuild_app_menu`'s macOS branch) — the macOS
/// app-menu pattern (`services`/`hide_others`/`show_all`/`quit`) fails to
/// build on Windows, so compiling this fn there would only trip `dead_code`.
#[cfg(target_os = "macos")]
pub fn build_app_menu(app: &tauri::AppHandle, locale: &str) -> Result<(), AppError> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Folyn")
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

    // Manual fullscreen trigger for plugin tool windows. macOS blocks NATIVE
    // fullscreen (a separate Space) on always-on-top windows, so this item
    // uses SIMPLE fullscreen instead (`set_simple_fullscreen`, pre-Lion
    // style: fills the screen, no separate Space, keeps the pinned level).
    // Simple fullscreen also closes without the black-flash Space teardown
    // (see the plugin-tool CloseRequested branch in lib.rs). No accelerator:
    // Cmd+Shift+F is reserved for the frontend Global Search shortcut.
    let tool_fullscreen = tauri::menu::MenuItem::with_id(
        app,
        "plugin-tool-fullscreen",
        app_menu_label(locale, AppMenuLabel::PluginToolFullscreen),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let window_menu = SubmenuBuilder::new(app, app_menu_label(locale, AppMenuLabel::Window))
        .minimize()
        .maximize()
        .close_window()
        .separator()
        .item(&tool_fullscreen)
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

/// Build the pet quick-action native menu (show-main / hide-pet / size
/// submenu / opacity submenu / click-through toggle / separator / exit-app).
///
/// Tray-only caller: `tray_set_enabled` (system tray menu). The pet
/// right-click menu moved to a custom HTML window (`pet-menu` — see
/// `PetMenuApp.tsx`), so `hide_pet_as_toggle=true` here — the tray menu
/// pre-checks `hide_pet` from the pet window's current visibility (checked
/// = pet hidden) so the user can toggle the pet on/off from the tray even
/// when the pet is already hidden.
///
/// Item ids are the `PET_CTX_MENU_*` constants; `lib.rs::pet_ctx_menu_action`
/// maps each to the `PetMenuAction` payload the main window expects. The
/// `hide-pet` frontend handler is a real toggle (`toggle_pet_mode` reads
/// `pet.is_visible()` and flips), so the tray's checkable toggle routes
/// correctly.
pub(crate) fn build_pet_context_menu(
    app: &tauri::AppHandle,
    locale: &str,
    hide_pet_as_toggle: bool,
) -> Result<tauri::menu::Menu<tauri::Wry>, AppError> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let show_main = MenuItem::with_id(
        app,
        PET_CTX_MENU_SHOW_MAIN,
        pet_menu_label(locale, PetMenuLabel::ShowMain),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // Hide pet icon. The tray variant uses a `CheckMenuItem` pre-checked
    // from the pet window's current visibility (checked = pet hidden — the
    // click-through toggle convention where a checked "Hide pet icon" means the
    // hide-pet action is in effect, i.e. the pet is currently hidden).
    //
    // ponytail: `CheckMenuItem` and `MenuItem` are distinct concrete types,
    // so the two branches can't share a single `let`. Box them behind a
    // trait object — `Menu::with_items` takes `&[&dyn IsMenuItem<R>]` so a
    // boxed trait object slots in alongside the other `&show_main` etc.
    // references. The Box lives as a local; `Menu::with_items` borrows it
    // for the duration of the call.
    //
    // The tray menu is built once at `tray_set_enabled` time — muda does NOT
    // auto-toggle the checkmark on click, so without `set_checked` the
    // checkmark would go stale after the first toggle. `tray_set_enabled`
    // extracts the `CheckMenuItem` handle via `Menu::get` + `as_check_menuitem`
    // and stashes it in `TrayHidePetItemState`; `toggle_pet_mode` /
    // `show_pet_if_hidden` call `set_checked` on it so the checkmark tracks
    // pet visibility across all toggle paths (tray click, settings tab,
    // pet right-click HTML menu).
    let pet_hidden = !app
        .get_webview_window(PET_LABEL)
        .and_then(|p| p.is_visible().ok())
        .unwrap_or(false);
    let hide_pet: Box<dyn tauri::menu::IsMenuItem<tauri::Wry>> = if hide_pet_as_toggle {
        Box::new(
            CheckMenuItem::with_id(
                app,
                PET_CTX_MENU_HIDE_PET,
                pet_menu_label(locale, PetMenuLabel::HidePet),
                true,
                pet_hidden,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
    } else {
        Box::new(
            MenuItem::with_id(
                app,
                PET_CTX_MENU_HIDE_PET,
                pet_menu_label(locale, PetMenuLabel::HidePet),
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
    };

    // Pet size submenu — five radio items (50%/75%/100%/125%/150%), the
    // current size pre-checked. Reads the shared `PetSizeState` (synced from
    // frontend via `set_pet_size` / `set_pet_size_state`) so the checkmark
    // reflects the last-applied size.
    let current_level = current_pet_size_level(app);
    let size_50 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_SIZE_50,
        pet_menu_label(locale, PetMenuLabel::Size50),
        true,
        current_level == "50",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_75 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_SIZE_75,
        pet_menu_label(locale, PetMenuLabel::Size75),
        true,
        current_level == "75",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_100 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_SIZE_100,
        pet_menu_label(locale, PetMenuLabel::Size100),
        true,
        current_level == "100",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_125 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_SIZE_125,
        pet_menu_label(locale, PetMenuLabel::Size125),
        true,
        current_level == "125",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_150 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_SIZE_150,
        pet_menu_label(locale, PetMenuLabel::Size150),
        true,
        current_level == "150",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let size_submenu = Submenu::with_items(
        app,
        pet_menu_label(locale, PetMenuLabel::SizeSubmenu),
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
        app,
        PET_CTX_MENU_OPACITY_25,
        pet_menu_label(locale, PetMenuLabel::Opacity25),
        true,
        current_opacity == "25",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_50 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_OPACITY_50,
        pet_menu_label(locale, PetMenuLabel::Opacity50),
        true,
        current_opacity == "50",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_75 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_OPACITY_75,
        pet_menu_label(locale, PetMenuLabel::Opacity75),
        true,
        current_opacity == "75",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_100 = CheckMenuItem::with_id(
        app,
        PET_CTX_MENU_OPACITY_100,
        pet_menu_label(locale, PetMenuLabel::Opacity100),
        true,
        current_opacity == "100",
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let opacity_submenu = Submenu::with_items(
        app,
        pet_menu_label(locale, PetMenuLabel::OpacitySubmenu),
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
        app,
        PET_CTX_MENU_CLICK_THROUGH,
        pet_menu_label(locale, PetMenuLabel::ClickThrough),
        true,
        app.state::<PetClickThroughState>().enabled(),
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let exit_app = MenuItem::with_id(
        app,
        PET_CTX_MENU_EXIT_APP,
        pet_menu_label(locale, PetMenuLabel::ExitApp),
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // ponytail: build a `&[&dyn IsMenuItem]` slice — `MenuItem` and
    // `CheckMenuItem` and `PredefinedMenuItem` and `Submenu` all implement
    // `IsMenuItem`, so a heterogeneous slice works without boxing. The
    // previous inline version spelled each item out by name; this is the
    // one place the slice gets assembled (tray menu only).
    let items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
        &show_main,
        &*hide_pet,
        &size_submenu,
        &opacity_submenu,
        &click_through,
        &sep,
        &exit_app,
    ];

    let menu = Menu::with_items(app, &items).map_err(|e| e.to_string())?;
    Ok(menu)
}

/// Toggle the macOS system tray icon. When `enabled`, builds a tray with:
///   - the app's bundled default window icon (no new asset needed)
///   - the shared pet context menu (`build_pet_context_menu` with
///     `hide_pet_as_toggle=true` — the tray menu is a user-facing entry
///     point)
///   - a left-click handler that pops the menu (macOS Tauri 2 tray icons
///     only show the menu on right-click by default; the user explicitly
///     asked for click-to-show-menu)
///
/// When disabled, destroys any existing tray icon. Menu item selections
/// route through the SAME `on_menu_event` handler in `lib.rs` because the
/// item ids are the same `PET_CTX_MENU_*` constants — zero new routing
/// code. Idempotent: toggling on when already on replaces the icon (rebuild
/// for locale switches); toggling off when off is a no-op.
#[tauri::command]
pub async fn tray_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    locale: String,
) -> Result<(), AppError> {
    use std::sync::mpsc::channel;
    use tauri::tray::TrayIconBuilder;

    // NSStatusBar / NSStatusItem destroy + build must run on the main thread
    // (BoardServices `assertBarrierOnQueue` asserts this; running on a tokio
    // worker thread SIGTRAPs the process — observed on reload).
    let (tx, rx) = channel::<Result<(), String>>();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        // Destroy any existing tray icon first so the rebuild path (locale
        // switch, re-enable) is the same as the enable path. Idempotent for
        // the disable case: `remove_tray_by_id` is a no-op when no tray exists.
        app2.remove_tray_by_id(TRAY_ID);
        // Clear the stashed CheckMenuItem handle — the old tray's menu is gone,
        // so `set_checked` on it would be a no-op or UB. Re-populated below when
        // the new menu is built.
        if let Ok(mut guard) = app2.state::<TrayHidePetItemState>().0.lock() {
            *guard = None;
        }
        if !enabled {
            let _ = tx.send(Ok(()));
            return;
        }
        let res = (|| {
            let menu = build_pet_context_menu(&app2, &locale, true).map_err(|e| e.to_string())?;
            // Extract the `hide_pet` CheckMenuItem handle and stash it in
            // `TrayHidePetItemState` so `toggle_pet_mode` / `show_pet_if_hidden`
            // can call `set_checked` on it after each visibility flip. Without
            // this, the tray menu (built once) would show a stale checkmark
            // after the first toggle. `Menu::get(id)` → `MenuItemKind::as_check_menuitem()`.
            if let Some(kind) = menu.get(PET_CTX_MENU_HIDE_PET) {
                if let Some(check_item) = kind.as_check_menuitem() {
                    if let Ok(mut guard) = app2.state::<TrayHidePetItemState>().0.lock() {
                        *guard = Some(check_item.clone());
                    }
                }
            }
            // Dedicated tray icon: the app icon has a dark rounded-square
            // background that vanishes into the macOS menubar. This PNG is the
            // feather + ink drop on transparent background, enlarged to fill the
            // canvas. Embedded at compile time via `include_image!` (raw RGBA,
            // 64x64 = 16KB).
            let icon = tauri::include_image!("icons/tray-icon.png");
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .menu(&menu)
                // macOS Tauri 2 tray icons default to right-click-only for
                // menu; the user asked for click-to-show-menu, so flip this.
                // `show_menu_on_left_click` makes the OS pop the menu on
                // left-click without a JS-side handler.
                .show_menu_on_left_click(true)
                .build(&app2)
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        let _ = tx.send(res);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rebuild the macOS app menu bar with labels localized for `locale`. The
/// menu bar is built once at `lib.rs::setup` (bootstrap locale `"en"`); the
/// frontend calls this command after `localeStore` hydrates and whenever the
/// user switches locale. `set_menu` must run on the main thread, so we marshal
/// via `run_on_main_thread`; the closure reports failure through a channel so
/// the command surfaces a real error instead of swallowing it.
///
/// No-op on non-macOS: the macOS app-menu pattern (`services`/`hide_others`/
/// `show_all`/`quit`) does not apply on Windows, and `build_app_menu`'s
/// `SubmenuBuilder::services()` etc. fail to build there. The bootstrap call
/// in `lib.rs::setup` is cfg-gated to macOS; this command must mirror that or
/// the frontend's locale-hydrate invoke surfaces a spurious error on Windows.
#[tauri::command]
pub async fn pet_rebuild_app_menu(
    app: tauri::AppHandle,
    locale: String,
) -> Result<(), AppError> {
    #[cfg(not(target_os = "macos"))]
    {
        // Avoid unused-arg warnings; the command still must match the macOS
        // signature so the invoke_handler! registration is uniform.
        let _ = (app, locale);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
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
}

// ────────────────────────────────────────────────────────────────────────────
// HTML pet right-click menu (`pet-menu` window).
//
// Replaces the native NSMenu path so the menu can be positioned adaptively
// outside the pet view (no overlap with the pet, no internal scroll arrows).
// The frontend renders the menu in the `pet-menu` Tauri window, measures its
// DOM size, computes a quadrant-aware position (reusing
// `computePanelPosition`'s math from `petPosition.ts`), and calls
// `pet_menu_set_size` + `pet_menu_set_position` + `pet_menu_show` in that
// order. Item clicks emit `pet://menu-action` directly (no Rust
// `on_menu_event` routing). Closes on item click, ESC, and window blur
// (click outside).
//
// Commands mirror `pet_bubble_*` (bypass ACL; window capability grants only
// `core:event`).
// ────────────────────────────────────────────────────────────────────────────

/// Show the `pet-menu` window and make it key so the React ESC keydown listener
/// fires. The caller sets size + position via `pet_menu_set_size` /
/// `pet_menu_set_position` first. Mirrors `pet_panel_show`: `set_focus()`
/// makes the window key + makes the WKWebView first responder so `document`
/// receives `keydown` without a click. The Folyn app is briefly activated
/// (`set_focus()` calls `activateIgnoringOtherApps:YES`) — acceptable for a
/// transient context menu; matches the pet-panel pattern.
#[tauri::command]
pub async fn pet_menu_show(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_MENU_LABEL)
        .ok_or_else(|| "pet-menu window not found".to_string())?;
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())?;

    // Make the WKWebView (not the contentView / parent view) the first
    // responder so `document` receives `keydown` → ESC works without a click.
    // Mirrors `pet_panel_show`. Must run on the main thread (`with_webview`);
    // re-applied on every show because `orderOut` (hide) resigns the FR.
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

/// Hide the `pet-menu` window without closing it (stays alive for the next
/// show). Called on item click, ESC, and window blur.
#[tauri::command]
pub async fn pet_menu_hide(app: tauri::AppHandle) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_MENU_LABEL)
        .ok_or_else(|| "pet-menu window not found".to_string())?;
    panel.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Set the `pet-menu` window's screen position (physical pixels). The
/// frontend computes a clamped, quadrant-aware position (using
/// `get_pet_position` + `pet_get_work_area` + measured menu size) and
/// passes it here. Mirrors `pet_bubble_set_position`.
#[tauri::command]
pub async fn pet_menu_set_position(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_MENU_LABEL)
        .ok_or_else(|| "pet-menu window not found".to_string())?;
    panel
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| AppError::from(e.to_string()))
}

/// Set the `pet-menu` window's size (physical pixels). The frontend measures
/// the rendered menu DOM and passes the physical size here before
/// `pet_menu_show` so the window matches the content exactly (no clipping,
/// no internal scroll). Mirrors `pet_bubble_set_size`.
#[tauri::command]
pub async fn pet_menu_set_size(
    app: tauri::AppHandle,
    width: i32,
    height: i32,
) -> Result<(), AppError> {
    let panel = app
        .get_webview_window(PET_MENU_LABEL)
        .ok_or_else(|| "pet-menu window not found".to_string())?;
    panel
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|e| AppError::from(e.to_string()))
}
