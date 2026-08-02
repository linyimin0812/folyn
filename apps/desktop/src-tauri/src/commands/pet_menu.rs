use tauri::Manager;

use crate::commands::pet_common::*;
use crate::errors::AppError;

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
        .select_all()
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

/// Build the pet quick-action native menu (show-main / hide-pet / size
/// submenu / opacity submenu / click-through toggle / separator / exit-app,
/// plus the `test-bubble` demo item when `include_test_bubble` is true).
///
/// Shared between two callers so the item ids — and therefore the
/// `pet://menu-action` routing in `lib.rs::on_menu_event` — stay identical:
///   - `pet_show_context_menu` (right-click popup): includes `test-bubble`,
///     `hide_pet` is a plain `MenuItem` (single-shot hide — you can't
///     right-click a hidden pet, so a toggle would be dead state).
///   - `tray_set_enabled` (system tray menu): excludes `test-bubble`,
///     `hide_pet` is a `CheckMenuItem` pre-checked from the pet window's
///     current visibility (checked = pet hidden) so the user can toggle
///     the pet on/off from the tray even when the pet is already hidden.
///
/// Item ids are the `PET_CTX_MENU_*` constants; `lib.rs::pet_ctx_menu_action`
/// maps each to the `PetMenuAction` payload the main window expects. The
/// `hide-pet` frontend handler is a real toggle (`toggle_pet_mode` reads
/// `pet.is_visible()` and flips), so the same id routes both the popup's
/// single-shot hide and the tray's checkable toggle.
pub(crate) fn build_pet_context_menu(
    app: &tauri::AppHandle,
    locale: &str,
    include_test_bubble: bool,
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

    // Hide pet icon. In the tray variant this is a `CheckMenuItem` pre-checked
    // from the pet window's current visibility (checked = pet hidden — the
    // click-through toggle convention where a checked "Hide pet icon" means the
    // hide-pet action is in effect, i.e. the pet is currently hidden). The
    // popup variant keeps a plain `MenuItem` because right-clicking a hidden
    // pet is impossible, so the checkmark state would never visibly flip from
    // the popup.
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
    // pet right-click popup).
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
    // previous inline version spelled each item out by name; `build_pet_context_menu`
    // is called twice (popup + tray), so this is the one place the slice
    // gets assembled.
    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![
        &show_main,
        &*hide_pet,
        &size_submenu,
        &opacity_submenu,
        &click_through,
        &sep,
        &exit_app,
    ];
    // Demo: fire a test bubble notification (PRD pet-popup-bubble-notification).
    // Routed in `lib.rs` `on_menu_event` to a `pet://notify` emit (the main
    // window's dispatcher routes it by `notificationForm`). Only included in
    // the pet right-click popup, not the tray menu (debug surface).
    let test_bubble;
    if include_test_bubble {
        test_bubble = MenuItem::with_id(
            app,
            PET_CTX_MENU_TEST_BUBBLE,
            pet_menu_label(locale, PetMenuLabel::TestBubble),
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        items.push(&test_bubble);
    }

    let menu = Menu::with_items(app, &items).map_err(|e| e.to_string())?;
    Ok(menu)
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
pub async fn pet_show_context_menu(
    app: tauri::AppHandle,
    locale: String,
) -> Result<(), AppError> {
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

    let menu = build_pet_context_menu(&app, &locale, true, false)?;
    // popup_menu_at anchors the menu to `pet`'s ns_view (so NSMenu opens on
    // the pet panel's Space — visible even when the frontmost app is
    // fullscreen) at the cursor position expressed in the view's top-left
    // origin (logical points). muda flips Y to the NSView's bottom-left.
    let popup_pos = pet_cursor_pos_relative(&pet)?;
    pet.popup_menu_at(&menu, popup_pos).map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggle the macOS system tray icon. When `enabled`, builds a tray with:
///   - the app's bundled default window icon (no new asset needed)
///   - the shared pet context menu (`build_pet_context_menu` with
///     `include_test_bubble=false` — the tray menu is a user-facing entry
///     point, not a debug surface)
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
    use tauri::tray::TrayIconBuilder;

    // Destroy any existing tray icon first so the rebuild path (locale
    // switch, re-enable) is the same as the enable path. Idempotent for the
    // disable case: `remove_tray_by_id` is a no-op when no tray exists.
    app.remove_tray_by_id(TRAY_ID);
    // Clear the stashed CheckMenuItem handle — the old tray's menu is gone,
    // so `set_checked` on it would be a no-op or UB. Re-populated below when
    // the new menu is built.
    if let Ok(mut guard) = app.state::<TrayHidePetItemState>().0.lock() {
        *guard = None;
    }
    if !enabled {
        return Ok(());
    }

    let menu = build_pet_context_menu(&app, &locale, false, true)?;
    // Extract the `hide_pet` CheckMenuItem handle and stash it in
    // `TrayHidePetItemState` so `toggle_pet_mode` / `show_pet_if_hidden`
    // can call `set_checked` on it after each visibility flip. Without this,
    // the tray menu (built once) would show a stale checkmark after the
    // first toggle. `Menu::get(id)` → `MenuItemKind::as_check_menuitem()`.
    if let Some(kind) = menu.get(PET_CTX_MENU_HIDE_PET) {
        if let Some(check_item) = kind.as_check_menuitem() {
            if let Ok(mut guard) = app.state::<TrayHidePetItemState>().0.lock() {
                *guard = Some(check_item.clone());
            }
        }
    }
    // Dedicated tray icon: the app icon has a dark rounded-square background
    // that vanishes into the macOS menubar. This PNG is the feather + ink
    // drop on transparent background, enlarged to fill the canvas. Embedded
    // at compile time via `include_image!` (raw RGBA, 64x64 = 16KB).
    let icon = tauri::include_image!("icons/tray-icon.png");
    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        // macOS Tauri 2 tray icons default to right-click-only for menu; the
        // user asked for click-to-show-menu, so flip this. `show_menu_on_left_click`
        // makes the OS pop the menu on left-click without a JS-side handler.
        .show_menu_on_left_click(true)
        .build(&app)
        .map_err(|e| e.to_string())?;
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
