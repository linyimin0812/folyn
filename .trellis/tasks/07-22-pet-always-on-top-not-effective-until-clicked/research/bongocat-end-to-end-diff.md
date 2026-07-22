# Research: BongoCat vs Quill — end-to-end diff for pet always-on-top

- **Query**: Complete end-to-end diff BongoCat vs Quill — find what previous research missed
- **Scope**: internal (BongoCat + Quill source)
- **Date**: 2026-07-22

## Summary (TL;DR)

The single most important difference: **BongoCat's `main` window IS the pet — there is no separate editor window.** It is created with `alwaysOnTop: true`, `acceptFirstMouse: true`, default `visible: true`, default `focus: true`, and is converted to an NSPanel **synchronously inside `.setup()`**. Quill has a separate `pet` window created with `alwaysOnTop: false`, `visible: false`, `focus: false`, no `acceptFirstMouse`, and converted to an NSPanel **asynchronously via `run_on_main_thread` after `.setup()` returns**. None of the previously-applied fixes touch the tauri.conf.json `pet` window config — that config is the gap.

Neither app uses `LSUIElement` / bundle-level Info.plist accessory config. Both call runtime `set_dock_visibility(false)` inside `.setup()`. So that is NOT the difference.

---

## Section 1 — BongoCat's complete pet window lifecycle

### 1.1 tauri.conf.json — window config

File: `/Users/yiminlin/project/BongoCat/src-tauri/tauri.conf.json:14-37`

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [
    {
      "label": "main",
      "title": "BongoCat",
      "url": "index.html/#/",
      "shadow": false,
      "alwaysOnTop": true,        // <-- FLOATING at creation
      "transparent": true,
      "decorations": false,
      "acceptFirstMouse": true,   // <-- accepts click without activation
      "skipTaskbar": true,
      "maximizable": false
      // no "visible" field  → default true (created visible)
      // no "focus" field    → default true (created with focus)
      // no "resizable" field → default true
    },
    {
      "label": "preference",
      "url": "index.html/#/preference",
      "visible": false,
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,
      "minWidth": 800,
      "minHeight": 600,
      "skipTaskbar": true
    }
  ],
  ...
}
```

Key facts:
- The `main` window IS the pet/mascot. There is no editor window. BongoCat is a single-window overlay app plus a hidden preference dialog.
- `alwaysOnTop: true` at config level — Tauri creates the NSWindow already at `NSFloatingWindowLevel` (level 3).
- `acceptFirstMouse: true` — mouse-down on the window is delivered even when the app is not active, without first making the app key.
- No `visible: false` → default true → the window is created visible.
- No `focus: false` → default true.
- `transparent: true`, `decorations: false`, `shadow: false`, `skipTaskbar: true`, `maximizable: false`.

### 1.2 Bundle config — no Info.plist at all

- `/Users/yiminlin/project/BongoCat/src-tauri/tauri.macos.conf.json` (full content):

```json
{
  "identifier": "com.ayangweb.BongoCat",
  "bundle": {
    "resources": ["assets/tray-mac.png", "assets/models"]
  }
}
```

- There is NO `bundle.macOS.infoPlist` field. BongoCat does NOT set `LSUIElement` at the bundle level. There is NO Info.plist file under `src-tauri/`.
- Conclusion: BongoCat is a regular app at bundle launch; it becomes an accessory at runtime via `set_dock_visibility(false)` inside `.setup()`.

### 1.3 App startup ordering — `.setup()` hook

File: `/Users/yiminlin/project/BongoCat/src-tauri/src/lib.rs:17-29`

```rust
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let main_window = app.get_webview_window(MAIN_WINDOW_LABEL).unwrap();
            let preference_window = app.get_webview_window(PREFERENCE_WINDOW_LABEL).unwrap();
            setup::default(&app_handle, main_window.clone(), preference_window.clone());
            Ok(())
        })
        ...
```

`setup::default` (file `/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/mod.rs:15-24`):

```rust
pub fn default(
    app_handle: &AppHandle,
    main_window: WebviewWindow,
    preference_window: WebviewWindow,
) {
    #[cfg(debug_assertions)]
    main_window.open_devtools();

    platform(app_handle, main_window.clone(), preference_window.clone());
}
```

`platform` (file `/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs:28-92`) — this is the heart of the BongoCat recipe:

```rust
pub fn platform(
    app_handle: &AppHandle,
    main_window: WebviewWindow,
    _preference_window: WebviewWindow,
) {
    let _ = app_handle.plugin(tauri_nspanel::init());

    let _ = app_handle.set_dock_visibility(false);   // line 35 — accessory mode, BEFORE to_panel

    let panel = main_window.to_panel::<NsPanel>().unwrap();   // line 37 — SYNC, on the .setup() main thread

    panel.set_level(PanelLevel::Dock.value());                // line 39

    panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());  // line 41

    panel.set_collection_behavior(                            // line 43-49
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()
            .full_screen_auxiliary()
            .into(),
    );

    let handler = NsPanelEventHandler::new();
    // ... wire window_did_become_key / window_did_resign_key / window_did_resize / window_did_move ...
    panel.set_event_handler(Some(handler.as_ref()));          // line 91
}
```

Sequence on the main thread, still inside `.setup()` closure:
1. `app_handle.plugin(tauri_nspanel::init())` — register the nspanel plugin (ManagerExt panel store).
2. `app_handle.set_dock_visibility(false)` — accessory activation policy, no Dock icon.
3. `main_window.to_panel::<NsPanel>()` — swap the NSWindow's class to the custom NSPanel subclass IN PLACE.
4. `panel.set_level(PanelLevel::Dock.value())` — Dock level (20).
5. `panel.set_style_mask(empty().resizable().nonactivating_panel())` — nonactivating panel.
6. `panel.set_collection_behavior(stationary | move_to_active_space | full_screen_auxiliary)` = 386.
7. Build `NsPanelEventHandler` with 4 closure-backed notification callbacks, attach via `panel.set_event_handler(...)`.

**Critical**: all of 1–7 run SYNCHRONOUSLY on the main thread, INSIDE `.setup()`, BEFORE the main run loop starts. The window was created VISIBLE by tauri.conf.json, so it is already in the window server's z-order list at the moment `to_panel()` swaps its class. The panel flags are applied while the window is live and visible.

### 1.4 Panel / event handler declaration

File: `/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs:11-26`

```rust
tauri_panel! {
    panel!(NsPanel {
        config: {
            is_floating_panel: true,      // setFloatingPanel:YES — NSPanel-specific
            can_become_key_window: true,
            can_become_main_window: false
        }
    })

    panel_event!(NsPanelEventHandler {
        window_did_become_key(notification: &NSNotification) -> (),
        window_did_resign_key(notification: &NSNotification) -> (),
        window_did_resize(notification: &NSNotification) -> (),
        window_did_move(notification: &NSNotification) -> (),
    })
}
```

### 1.5 Runtime toggle (`set_always_on_top` command)

File: `/Users/yiminlin/project/BongoCat/src-tauri/src/plugins/window/src/commands/macos.rs:82-103`

```rust
#[command]
pub async fn set_always_on_top<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    always_on_top: bool,
) {
    if is_main_window(&window) {
        return set_macos_panel(
            &app_handle, &window,
            MacOSPanelStatus::SetAlwaysOnTop(always_on_top),
        );
    }
    if always_on_top {
        let _ = window.set_always_on_bottom(false);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_bottom(true);
    }
}
```

`set_macos_panel` for the main/pet window (same file, `MacOSPanelStatus::SetAlwaysOnTop` branch, lines 49-55):

```rust
MacOSPanelStatus::SetAlwaysOnTop(always_on_top) => {
    if always_on_top {
        panel.set_level(PanelLevel::Dock.value());
    } else {
        panel.set_level(-1);
    };
}
```

Important: BongoCat's `set_always_on_top(true)` for the pet does ONLY `panel.set_level(PanelLevel::Dock.value())`. It does NOT call `to_panel()` again (the window was already converted at startup). It does NOT call `panel.show()`. It does NOT call `set_collection_behavior()` again (it was set at startup). Compare this to Quill's `pet_set_always_on_top` which re-calls `to_panel()`, `panel.show()`, `set_level`, AND `set_collection_behavior` every toggle.

### 1.6 show/hide commands for the pet

Same file, `MacOSPanelStatus::Show` / `Hide` branches (lines 27-48):

```rust
MacOSPanelStatus::Show => {
    panel.show();                                   // orderFrontRegardless
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .can_join_all_spaces()                  // ← Show uses can_join_all_spaces
            .full_screen_auxiliary()
            .into(),
    );
}
MacOSPanelStatus::Hide => {
    panel.hide();
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()                 // ← Hide uses move_to_active_space
            .full_screen_auxiliary()
            .into(),
    );
}
```

BongoCat swaps collection behavior between `can_join_all_spaces` (visible) and `move_to_active_space` (hidden). Quill's ON-branch `pet_set_always_on_top` always uses `move_to_active_space` (matching BongoCat's HIDE branch, not its SHOW branch).

### 1.7 List of all AppKit / NSWindow / NSPanel touches in BongoCat src-tauri

Grep result for `msg_send|NSPanel|NSWindow|setLevel|setFloatingPanel|setHidesOnDeactivate|orderFront|setActivationPolicy|ActivationPolicy|LSUIElement` in `*.rs`: NO MATCHES in BongoCat's own Rust source.

Grep for `panel\.|set_level|set_collection_behavior|set_style_mask|to_panel|show\(\)|hide\(\)` in `*.rs`:

| File | Line | Call |
|---|---|---|
| `core/setup/macos.rs` | 35 | `app_handle.set_dock_visibility(false)` |
| `core/setup/macos.rs` | 37 | `main_window.to_panel::<NsPanel>()` |
| `core/setup/macos.rs` | 39 | `panel.set_level(PanelLevel::Dock.value())` |
| `core/setup/macos.rs` | 41 | `panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into())` |
| `core/setup/macos.rs` | 43 | `panel.set_collection_behavior(stationary \| move_to_active_space \| full_screen_auxiliary)` |
| `core/setup/macos.rs` | 91 | `panel.set_event_handler(Some(handler.as_ref()))` |
| `plugins/window/src/commands/macos.rs` | 28 | `panel.show()` (Show command) |
| `plugins/window/src/commands/macos.rs` | 30 | `panel.set_collection_behavior(stationary \| can_join_all_spaces \| full_screen_auxiliary)` (Show) |
| `plugins/window/src/commands/macos.rs` | 39 | `panel.hide()` (Hide command) |
| `plugins/window/src/commands/macos.rs` | 41 | `panel.set_collection_behavior(stationary \| move_to_active_space \| full_screen_auxiliary)` (Hide) |
| `plugins/window/src/commands/macos.rs` | 51 | `panel.set_level(PanelLevel::Dock.value())` (set_always_on_top ON) |
| `plugins/window/src/commands/macos.rs` | 53 | `panel.set_level(-1)` (set_always_on_top OFF) |
| `plugins/window/src/commands/macos.rs` | 107 | `app_handle.set_dock_visibility(visible)` (set_taskbar_visibility command) |

No `setFloatingPanel:YES` is sent by BongoCat's own Rust code. `is_floating_panel: true` in the `panel!` config block is what makes `tauri-nspanel` call `setFloatingPanel:YES` inside `to_panel()` (in the crate, not in BongoCat's source).

No `setHidesOnDeactivate:` — the default `NO` for an NSPanel (via `is_floating_panel: true`) is used. No `orderFront` / `orderFrontRegardless` outside of what `panel.show()` does internally.

No `set_activation_policy` direct call. Only the Tauri-level `set_dock_visibility(false)`.

### 1.8 Reopen behavior (Dock click / app relaunch)

File: `/Users/yiminlin/project/BongoCat/src-tauri/src/lib.rs:76-84`

```rust
app.run(|app_handle, event| match event {
    #[cfg(target_os = "macos")]
    tauri::RunEvent::Reopen { .. } => {
        show_preference_window(app_handle);
    }
    _ => { let _ = app_handle; }
});
```

Reopen shows the preference window (not the pet — pet is always visible).

---

## Section 2 — Quill's complete pet window lifecycle

### 2.1 tauri.conf.json — window config

File: `/Users/yiminlin/project/quill/apps/desktop/src-tauri/tauri.conf.json:32-111`

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [
    {
      "label": "main",
      "title": "Quill",
      "width": 1440, "height": 900,
      "minWidth": 800, "minHeight": 600,
      "resizable": true,
      "fullscreen": false,
      "dragDropEnabled": false
      // decorations default = true (titled), title bar present
      // no transparent, no alwaysOnTop, no skipTaskbar → normal editor window
    },
    {
      "label": "pet",
      "url": "/#/pet",
      "title": "Quill Pet",
      "width": 96, "height": 96,
      "center": true,
      "resizable": false,
      "decorations": false,
      "transparent": true,
      "alwaysOnTop": false,     // ← NOT floating at creation
      "skipTaskbar": true,
      "shadow": false,
      "visible": false,         // ← created hidden
      "focus": false,           // ← does not accept focus on creation
      "dragDropEnabled": false
      // no "acceptFirstMouse" → defaults false
    },
    {
      "label": "pet-panel", "url": "/#/pet-panel",
      "width": 440, "height": 620,
      "minWidth": 280, "minHeight": 360,
      "resizable": true, "decorations": false, "transparent": false,
      "alwaysOnTop": false, "skipTaskbar": true, "shadow": true,
      "visible": false, "focus": true, "dragDropEnabled": false
    },
    { "label": "pet-bubble", ... "visible": false, "focus": false },
    { "label": "voice-orb", ... "visible": false, "focus": false }
  ],
  ...
}
```

Key facts:
- Quill has FIVE windows. The `main` editor is a regular decorated Tauri window (no `transparent`, no `decorations: false`, no `skipTaskbar`). The `pet` is a SECONDARY window with `alwaysOnTop: false`, `visible: false`, `focus: false`.
- `alwaysOnTop: false` at config level — Tauri creates the NSWindow at `NSNormalWindowLevel` (level 0). The pet is NOT staged as a floating window by Tauri.
- `visible: false` — created hidden. The window does not enter the window server's z-order list until `show()` is called later.
- `focus: false` — does not accept focus on creation.
- No `acceptFirstMouse` → defaults false — first mouse-down on the pet when Quill is inactive first activates Quill before delivering the click.

### 2.2 Bundle Info.plist — also no LSUIElement

File: `/Users/yiminlin/project/quill/apps/desktop/src-tauri/Info.plist`:

```xml
<plist version="1.0">
<dict>
  <key>NSMicrophoneUsageDescription</key>      <string>...</string>
  <key>NSAccessibilityUsageDescription</key>   <string>...</string>
  <key>NSAppleEventsUsageDescription</key>     <string>...</string>
  <key>NSSpeechRecognitionUsageDescription</key> <string>...</string>
</dict>
</plist>
```

Only privacy usage strings. No `LSUIElement`, no `LSBackgroundOnly`, no `NSUIElement`. So Quill also becomes an accessory at runtime via `set_dock_visibility(false)` inside `.setup()`. Same as BongoCat. This is NOT the difference.

### 2.3 App startup ordering — `.setup()` hook

File: `/Users/yiminlin/project/quill/apps/desktop/src-tauri/src/lib.rs:438-528` (relevant slice):

```rust
.setup(|app| {
    app.manage(commands::PetSizeState(...));
    app.manage(commands::PetShortcutState::new());
    app.manage(voice::VoiceState::new());

    // ... menu building ...
    app.set_menu(menu)?;

    #[cfg(debug_assertions)]
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }

    // ponytail: hide the Dock icon — accessory activation policy
    #[cfg(target_os = "macos")]
    let _ = app.handle().set_dock_visibility(false);

    // Apply the pet window's topmost backend at creation
    let app_handle = app.handle().clone();
    apply_pet_backend_init(&app_handle);
    spawn_legacy_reapply_thread(app_handle);

    Ok(())
})
```

`apply_pet_backend_init` (same file, lines 144-157):

```rust
#[cfg(target_os = "macos")]
fn apply_pet_backend_init(app: &tauri::AppHandle) {
    if pet_panel_macos::backend_is_nspanel() {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            pet_panel_macos::convert_windows(&app2);   // ← SCHEDULED, not sync
        });
    } else {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            reapply_pet_topmost(&app2);
        });
    }
}
```

Sequence:
1. `set_dock_visibility(false)` — accessory activation policy (sync, on main thread inside `.setup()`).
2. `apply_pet_backend_init(&app_handle)` — schedules `convert_windows` via `run_on_main_thread`.
3. `.setup()` returns.
4. Main run loop starts.
5. On the next main loop iteration, `convert_windows` fires.

### 2.4 `convert_windows` — the actual NSPanel setup

File: `/Users/yiminlin/project/quill/apps/desktop/src-tauri/src/pet_panel_macos.rs:219-320` (pet branch shown):

```rust
pub fn convert_windows(app: &AppHandle) -> usize {
    let _ = app.plugin(tauri_nspanel::init());

    // Pet mascot.
    if let Some(window) = app.get_webview_window("pet") {
        if let Ok(panel) = window.to_panel::<QuillPetPanel>() {
            panel.set_level(PanelLevel::Dock.value());
            panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .stationary()
                    .move_to_active_space()
                    .full_screen_auxiliary()       // ← matches BongoCat's HIDE combo, not SHOW
                    .into(),
            );
            let handler = QuillPetEventHandler::new();
            panel.set_event_handler(Some(handler.as_ref()));
            count += 1;
        }
    }
    // ... pet-panel, pet-bubble, voice-orb follow same pattern ...
    register_re_assert_on_resign_active(app);
    count
}
```

Compared to BongoCat's `core/setup/macos.rs:37-91`, Quill's `convert_windows` is essentially identical in panel flags (Dock level, nonactivating_panel, `stationary | move_to_active_space | full_screen_auxiliary`, `is_floating_panel: true`, event handler attached). The differences are elsewhere:

- Quill's pet is `visible: false` at config → `to_panel()` runs on an INVISIBLE window (not in the window server's z-order list yet).
- Quill schedules `convert_windows` via `run_on_main_thread` → it runs AFTER `.setup()` returns, on the next main loop iteration. BongoCat runs `to_panel()` synchronously inside `.setup()`.

### 2.5 Pet show / hide path (the user's toggle)

`toggle_pet_mode` (file `apps/desktop/src-tauri/src/commands/pet_commands.rs:124-143`):

```rust
pub async fn toggle_pet_mode(app: tauri::AppHandle) -> Result<bool, AppError> {
    let pet = app.get_webview_window(PET_LABEL)?;
    let currently_visible = pet.is_visible()?;
    let next = !currently_visible;
    if next {
        pet.show()?;   // ← Tauri's WebviewWindow::show → [ns_window orderFront:nil]
        // NOTE: does NOT call panel.show() / orderFrontRegardless
    } else {
        pet.hide()?;
    }
    let _ = app.emit("pet://visibility-changed", next);
    Ok(next)
}
```

`pet.show()` is Tauri's `WebviewWindow::show()` → calls `[ns_window orderFront:nil]` (or equivalent). For an NSPanel, the proper "show without activating" call is `orderFrontRegardless` (which is what `panel.show()` from tauri-nspanel does). Quill uses Tauri's stock `show()` on an NSPanel-converted window, NOT the panel-specific `panel.show()`.

### 2.6 Always-on-top runtime toggle

File: `apps/desktop/src-tauri/src/commands/pet_commands.rs:1088-1143` — `pet_set_always_on_top(true)`:

```rust
app.run_on_main_thread(move || {
    let window = app2.get_webview_window(PET_LABEL)?;
    let panel = window.to_panel::<QuillPetPanel>()?;   // re-calls to_panel
    if enabled {
        panel.show();                                    // orderFrontRegardless
        panel.set_level(PanelLevel::Dock.value());
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .stationary()
                .move_to_active_space()               // ← BongoCat's HIDE combo
                .full_screen_auxiliary()
                .into(),
        );
    } else { ... }
})
```

Re-calls `to_panel()` (idempotent), then `panel.show()`, `set_level`, `set_collection_behavior`. BongoCat's equivalent just does `panel.set_level(Dock)` and nothing else (see Section 1.5).

### 2.7 Re-assert on resign-active observer

File: `apps/desktop/src-tauri/src/pet_panel_macos.rs:60-141` — `handle_app_did_resign_active` re-applies `panel.show()` + `set_level(Dock)` + `set_collection_behavior(stationary | move_to_active_space | full_screen_auxiliary)` when the flag is on. This is the fix #4 from the previous round. It is not present in BongoCat (BongoCat doesn't need it).

### 2.8 Frontend mount sequence

File: `apps/desktop/src/components/pet/PetApp.tsx:639-666`:

```tsx
useEffect(() => {
  (async () => {
    await invoke('pet_set_topmost_level', { label: 'pet' });  // no-op under NSPanel backend
  })();
}, []);

useEffect(() => {
  if (!isTauri()) return;
  (async () => {
    await invoke('pet_set_always_on_top', { enabled: petAlwaysOnTop });  // ← toggle
  })();
}, [petAlwaysOnTop]);
```

The pet window mounts → `pet_set_topmost_level` (no-op) → `pet_set_always_on_top(petAlwaysOnTop)`. So the runtime toggle IS being invoked. It is not a missing-invoke bug.

---

## Section 3 — Differences that matter (ranked)

| # | Difference | BongoCat | Quill | Why it matters / Confidence |
|---|---|---|---|---|
| **1** | **Window architecture** | `main` window IS the pet. No editor window. Single NSPanel + hidden preference window. | `main` is a normal editor; `pet` is a SECONDARY NSPanel among 5 windows. | **HIGH.** When Quill is backgrounded, AppKit's `applicationDidResignActive:` runs against an app with a regular editor window as the frontmost/key. AppKit's floating-panel-over-fullscreen behavior is most reliable when the app has no "main document window" competing for the key/main slot. Hard to fix without restructuring (move pet into main window? or make main window also a panel?). |
| **2** | **`alwaysOnTop` config flag** | `true` — Tauri creates the NSWindow already at `NSFloatingWindowLevel` (3) and routes it as a floating window in the window server. | `false` — Tauri creates the NSWindow at `NSNormalWindowLevel` (0) and stages it as a regular document window. | **HIGH.** `to_panel()` swaps the class but the window's z-order tier in the window server was already established at Normal. A later `set_level(Dock)` raises the level number, but the window-server-side "floating" classification set at creation is harder to retroactively establish. BongoCat's window enters the floating tier at creation. **Fix to try: set `alwaysOnTop: true` in the `pet` window config.** |
| **3** | **`visible` at config** | default `true` — window is created visible, enters the window server's z-order list immediately. `to_panel()` runs on a visible window. | `false` — created hidden. `to_panel()` runs on a hidden window. Window doesn't enter z-order list until later `pet.show()`. | **MEDIUM-HIGH.** AppKit applies `setCollectionBehavior` and `setLevel:` differently when the window is on-screen vs off-screen. Some flags only fully take effect on the next `orderFront`. BongoCat's panel is configured while visible — the flags stick. Quill's panel is configured while invisible — the first `pet.show()` (via `toggle_pet_mode`) reenters the window server and may not honor all flags without a re-assertion. **Fix to try: set `visible: true` in the `pet` config, or call `panel.show()` once inside `convert_windows` right after `to_panel()`.** |
| **4** | **Timing of `to_panel()`** | Synchronous inside `.setup()`, before the main run loop starts. The window is a panel by the time the first `applicationDidBecomeActive` / space-change event fires. | Asynchronous via `run_on_main_thread` — fires on the next main loop iteration AFTER `.setup()` returns. There is a window of time (between run-loop start and the `run_on_main_thread` block firing) where the pet is still a stock NSWindow with `alwaysOnTop: false`. | **MEDIUM.** If any AppKit event (activation, space change, Dock icon click) fires in that window, the pet is staged as a regular NSWindow. Once `to_panel()` runs later, the class swap + level change may not fully restage it. **Fix to try: call `convert_windows` SYNCHRONOUSLY inside `.setup()` instead of via `run_on_main_thread`** (since `.setup()` already runs on the main thread, this is safe). |
| **5** | **`acceptFirstMouse` config** | `true` — clicks on the window are delivered without first activating the app. | not set → default `false` — first click on the pet when Quill is not frontmost first activates Quill. | **MEDIUM.** This is a strong candidate for the "doesn't work until clicked" symptom: the user's first click on the pet activates Quill, and as part of activation AppKit re-evaluates z-order and promotes the panel. Without that click, the panel sits wherever AppKit staged it. **Fix to try: add `"acceptFirstMouse": true` to the `pet` window config.** |
| **6** | **`focus` config** | default `true`. | `false`. | **LOW-MEDIUM.** `focus: false` at the Tauri level maps to the window not becoming key on creation. The NSPanel config has `can_become_key_window: true`, so the panel CAN become key — but `focus: false` may set some Tauri-side flag that interferes. Probably not the root cause but worth ruling out. |
| **7** | **Show path uses Tauri `show()`** | BongoCat's `show_window` command for the main/pet window calls `panel.show()` (tauri-nspanel's `orderFrontRegardless`), not Tauri's `window.show()`. | Quill's `toggle_pet_mode` calls `pet.show()` — Tauri's `WebviewWindow::show()` — NOT the panel-specific `panel.show()`. | **MEDIUM-HIGH.** `orderFrontRegardless` is the correct call for a floating panel — it brings the panel to the front of its level WITHOUT activating the app. Tauri's `show()` may call `orderFront:` which respects the window-server ordering rules and may not promote the panel above other apps' frontmost windows. **Fix to try: in `toggle_pet_mode`, when showing the pet, call `panel.show()` (via `to_panel`) instead of `pet.show()`.** |
| **8** | **`set_always_on_top` re-calls `to_panel` + `panel.show()`** | BongoCat's `set_always_on_top(true)` does ONLY `panel.set_level(Dock)`. No `to_panel` re-call, no `panel.show()`, no `set_collection_behavior` (it was set at startup). | Quill's `pet_set_always_on_top(true)` re-calls `to_panel()`, calls `panel.show()`, `set_level`, `set_collection_behavior`. | **LOW.** Quill's version is more defensive but should not break things. BongoCat's minimal version suggests the startup `to_panel` + level + behavior is enough — if the level is later reset, just re-setting the level suffices. Probably not the bug. |
| **9** | **`move_to_active_space` vs `can_join_all_spaces` on the always-on-top ON branch** | BongoCat's `set_always_on_top(true)` does NOT change collection_behavior (it was set at startup to `stationary | move_to_active_space | full_screen_auxiliary`). The `Show` command separately uses `can_join_all_spaces`, the `Hide` command uses `move_to_active_space`. | Quill's `pet_set_always_on_top(true)` sets `stationary | move_to_active_space | full_screen_auxiliary` (386). | **LOW.** Previous research already swapped this to match BongoCat. Not the remaining bug. |
| **10** | **Number of converted windows** | Only `main` is converted to NSPanel. `preference` is a regular Tauri window. | FOUR windows are converted to NSPanels: `pet`, `pet-panel`, `pet-bubble`, `voice-orb`. | **LOW-MEDIUM.** Multiple panels with `can_become_key_window: true` in the same app may compete for the key-window slot when the app activates. Not present in BongoCat. Probably not the direct cause but adds noise. |

### Long shots (lower confidence)

| # | Difference | Why it is a long shot |
|---|---|---|
| L1 | `resizable: false` (Quill pet) vs default `true` (BongoCat). | The StyleMask includes `.resizable()` in both, so the Tauri `resizable` flag is overridden. Unlikely to matter. |
| L2 | `center: true` (Quill pet) vs not set (BongoCat). | Just initial position; irrelevant to z-order. |
| L3 | `maximizable: false` (BongoCat) vs not set (Quill pet). | Pet is 96×96, maximization is irrelevant. |
| L4 | Quill has the resign-active observer; BongoCat does not. | Quill added this as fix #4 — BongoCat does not need it because its panel is the only window and never gets demoted. The observer is necessary in Quill's multi-window architecture. Keep it. |
| L5 | Quill has the legacy backend fallback (`reapply_pet_topmost` + 500ms thread). | Only active when `QUILL_PET_PANEL_BACKEND=legacy`. Default is NSPanel backend. Irrelevant under default config. |

---

## Section 4 — Most likely root cause #1

**The `pet` window is created with `alwaysOnTop: false` in `tauri.conf.json`, so Tauri stages the underlying NSWindow at `NSNormalWindowLevel` as a regular document window. `to_panel()` + `set_level(Dock)` later promotes the level number, but the window-server-side floating-tier classification that BongoCat gets at creation (via `alwaysOnTop: true`) is never established. AppKit does not fully re-stage an existing on-screen (or about-to-be-shown) window as a floating panel just because its class was swapped and its level was raised — the first user interaction (click) forces a z-order re-evaluation, which is why the bug presents as "works after I click it."**

Combined contributing factor (Section 3 #3 + #4): `visible: false` + async `convert_windows` means the panel flags are applied to an invisible window on the next run-loop tick, so the first `pet.show()` via `toggle_pet_mode` enters the window server with stale staging. BongoCat's panel is configured while visible, on the same main-thread tick as `.setup()`, so the flags stick from frame 1.

### Specific change to try next (in priority order)

1. **In `/Users/yiminlin/project/quill/apps/desktop/src-tauri/tauri.conf.json`, change the `pet` window config:**
   - `"alwaysOnTop": false` → `"alwaysOnTop": true`
   - Add `"acceptFirstMouse": true`
   - Optionally flip `"visible": false` → `"visible": true` (and have `toggle_pet_mode` hide-on-startup if the user has pet mode off).

   This is the single highest-leverage change and the closest analog to BongoCat's working recipe at the config layer. It is also the only one of the candidate fixes that has not been attempted yet — all four prior fixes were Rust-side (`pet_panel_macos.rs` / `lib.rs` / `pet_commands.rs`).

2. **In `/Users/yiminlin/project/quill/apps/desktop/src-tauri/src/lib.rs` `apply_pet_backend_init`, call `convert_windows` SYNCHRONOUSLY inside `.setup()` instead of via `run_on_main_thread`** (`.setup()` already runs on the main thread, so this is safe and matches BongoCat's `core/setup/macos.rs:37` pattern). This removes the run-loop-tick gap where the pet is a stock NSWindow with `alwaysOnTop: false`.

3. **In `/Users/yiminlin/project/quill/apps/desktop/src-tauri/src/commands/pet_commands.rs` `toggle_pet_mode`, when `next == true`, call the panel's `show()` (via `window.to_panel::<QuillPetPanel>()` + `panel.show()` = `orderFrontRegardless`) instead of Tauri's `pet.show()`.** This matches BongoCat's `plugins/window/src/commands/macos.rs:28` `MacOSPanelStatus::Show` path.

If #1 alone does not fix it, #2 + #3 together should. The previous four fixes all post-date the panel-creation moment; they cannot retroactively make a Normal-level window behave like a creation-time floating window.

---

## Caveats / Not Found

- I did not verify the actual tauri-nspanel crate internals for `to_panel()`'s `setFloatingPanel:YES` plumbing — that lives in the crate, not in either project's source. The `is_floating_panel: true` config field is documented (in the prior research file `bongocat-nspanel-setup.md`) to map to `setFloatingPanel:YES` inside the crate. Both Quill and BongoCat set `is_floating_panel: true`, so this flag is set in both. The difference must be in how the window enters the window server BEFORE `to_panel()` runs.
- I did not run the app to verify behavior — this is a static-source diff.
- Tauri 2's exact behavior for `alwaysOnTop: true` at the config level (does it call `setLevel:` on the NSWindow at creation, or does it set a Tauri-side flag that is only applied on first show?) is not verified against Tauri's source. If Tauri only applies `alwaysOnTop` on first show, then #1 may reduce to "make the visible-default and call show early" — the test is the same.
- The user's environment (dev build vs signed .app) may affect Dock/activation behavior; the symptom "works after click" is consistent across both per prior research.
