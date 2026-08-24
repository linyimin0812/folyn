# Research: BongoCat NSPanel setup diff vs Mochi

- **Query**: Why does BongoCat's pet stay on top without a click while Mochi's doesn't, even after the `panel.show()` kick was added?
- **Scope**: internal (BongoCat source tree + tauri-nspanel crate source)
- **Date**: 2026-07-22

## Findings

### Files Found

| File Path | Description |
|---|---|
| `/Users/yiminlin/project/BongoCat/src-tauri/src/core/setup/macos.rs` | BongoCat startup NSPanel conversion (the canonical recipe Mochi's `pet_panel_macos.rs` comments cite). |
| `/Users/yiminlin/project/BongoCat/src-tauri/src/plugins/window/src/commands/macos.rs` | BongoCat runtime `show_window` / `hide_window` / `set_always_on_top` commands for the main window. |
| `/Users/yiminlin/project/BongoCat/src-tauri/src/plugins/window/src/commands/mod.rs` | `show_main_window` / `show_preference_window` wrappers; `MAIN_WINDOW_LABEL = "main"`. |
| `/Users/yiminlin/project/BongoCat/src-tauri/tauri.conf.json` | BongoCat `main` window config: `alwaysOnTop: true`, `acceptFirstMouse: true`, `transparent: true`, `decorations: false`, `shadow: false`, `skipTaskbar: true`, `macOSPrivateApi: true`. |
| `/Users/yiminlin/project/BongoCat/src-tauri/src/lib.rs` | App entry; calls `setup::default(...)` in the Tauri `setup` hook (line 26). `show_main_window` is NOT called at startup — main window is `visible: true` by default. |
| `/Users/yiminlin/.cargo/git/checkouts/tauri-nspanel-cab3955568b3504c/a3122e8/src/panel.rs` | tauri-nspanel `Panel` trait impls: `show()` = `orderFrontRegardless` (line 244), `set_floating_panel` → `setFloatingPanel:` (line 428), `apply_instance_property` (line 634) wires `is_floating_panel: true` → `setFloatingPanel:YES` during `to_panel()`. |
| `/Users/yiminlin/.cargo/git/checkouts/tauri-nspanel-cab3955568b3504c/a3122e8/src/builder.rs` | `PanelLevel` enum: `Normal=0, Floating=4, ModalPanel=8, Utility=19, Dock=20, MainMenu=24, Status=25, PopUpMenu=101, ScreenSaver=1000`. |
| `/Users/yiminlin/project/mochi/apps/desktop/src-tauri/src/pet_panel_macos.rs` | Mochi `convert_windows` startup conversion + `MochiPetPanel` config. |
| `/Users/yiminlin/project/mochi/apps/desktop/src-tauri/src/commands/pet_commands.rs` | Mochi `pet_set_always_on_top` runtime toggle (lines 1081–1136). |
| `/Users/yiminlin/project/mochi/apps/desktop/src-tauri/tauri.conf.json` | Mochi `pet` window: `alwaysOnTop: false`, no `acceptFirstMouse`, `visible: false`, `focus: false`, `resizable: false`. |
| `/Users/yiminlin/project/mochi/apps/desktop/src/components/pet/PetApp.tsx` | Mochi mount sequence: `set_pet_position` → `getCurrentWindow().show()` → `pet_set_topmost_level` (no-op on NSPanel) → `pet_make_transparent`; separate effect calls `pet_set_always_on_top({ enabled: petAlwaysOnTop })` on `[petAlwaysOnTop]` deps (lines 657–666). |

### Code Patterns

#### A. BongoCat startup conversion — `core/setup/macos.rs:28-92`

```rust
pub fn platform(app_handle: &AppHandle, main_window: WebviewWindow, _preference_window: WebviewWindow) {
    let _ = app_handle.plugin(tauri_nspanel::init());

    let _ = app_handle.set_dock_visibility(false);              // ← HIDE DOCK ICON (accessory app)

    let panel = main_window.to_panel::<NsPanel>().unwrap();

    panel.set_level(PanelLevel::Dock.value());

    panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());

    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()       // ← move_to_active_space (NOT can_join_all_spaces)
            .full_screen_auxiliary()
            .into(),
    );

    let handler = NsPanelEventHandler::new();
    // ... key/resign/resize/move handlers attached, only emit Tauri events ...
    panel.set_event_handler(Some(handler.as_ref()));   // ← DELEGATE ATTACHED
}
```

Key flags: `stationary | move_to_active_space | full_screen_auxiliary`.

#### B. BongoCat `tauri_panel!` config — `core/setup/macos.rs:11-26`

```rust
tauri_panel! {
    panel!(NsPanel {
        config: {
            is_floating_panel: true,
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

Identical to Mochi's `MochiPetPanel` config (`is_floating_panel: true, can_become_key_window: true, can_become_main_window: false`). **Not a differentiator.** The differentiator is that BongoCat *attaches* the handler (`panel.set_event_handler(Some(handler.as_ref()))`) — Mochi never calls `set_event_handler` for `MochiPetEventHandler`.

#### C. BongoCat `Show` flow — `plugins/window/src/commands/macos.rs:27-37`

```rust
MacOSPanelStatus::Show => {
    panel.show();                    // orderFrontRegardless FIRST

    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .can_join_all_spaces()    // ← SWITCHES to can_join_all_spaces AFTER show
            .full_screen_auxiliary()
            .into(),
    );
}
```

Two-phase: setup uses `move_to_active_space`; on explicit re-show the panel switches to `can_join_all_spaces` **after** `orderFrontRegardless`. This `Show` flow is only invoked via the `show_window` command (e.g. tray re-open) — NOT at startup, since the main window is `visible: true` by default.

#### D. BongoCat `set_always_on_top` toggle — `plugins/window/src/commands/macos.rs:49-55`

```rust
MacOSPanelStatus::SetAlwaysOnTop(always_on_top) => {
    if always_on_top {
        panel.set_level(PanelLevel::Dock.value());   // ← ONLY set_level; NO behavior change, NO show()
    } else {
        panel.set_level(-1);                          // ← -1 (below Normal)
    };
}
```

Minimal toggle: only `set_level`. Does **not** re-call `to_panel`, `set_collection_behavior`, or `panel.show()`. The collection behavior set once at startup (`move_to_active_space`) is never touched by the toggle. Mochi's toggle re-applies everything — a sign that Mochi's startup state isn't "sticky" the way BongoCat's is.

#### E. BongoCat tauri.conf.json main window — lines 16-26

```json
{
  "label": "main",
  "title": "BongoCat",
  "url": "index.html/#/",
  "shadow": false,
  "alwaysOnTop": true,        // ← Tauri-level always-on-top at window creation
  "transparent": true,
  "decorations": false,
  "acceptFirstMouse": true,   // ← accepts first mouse-down without activation
  "skipTaskbar": true,
  "maximizable": false
}
```

No `visible` field → defaults to `true`. No `focus`, `resizable` fields. Top-level `"macOSPrivateApi": true` (line 13).

#### F. Mochi pet window — `tauri.conf.json` lines 44-60

```json
{
  "label": "pet",
  "url": "/#/pet",
  "width": 96, "height": 96, "center": true,
  "resizable": false,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": false,   // ← NOT always-on-top at creation
  "skipTaskbar": true,
  "shadow": false,
  "visible": false,       // ← hidden at creation; frontend shows on mount
  "focus": false,
  "dragDropEnabled": false
}
```

No `acceptFirstMouse`. `macOSPrivateApi: true` is set at top-level (line 31) — matches BongoCat.

#### G. Mochi `pet_set_always_on_top` ON path — `pet_commands.rs:1093-1132`

```rust
app.run_on_main_thread(move || {
    let window = ...;
    let panel = window.to_panel::<MochiPetPanel>()...;   // re-swizzle (idempotent)
    if enabled {
        panel.set_level(PanelLevel::Dock.value());
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .stationary()
                .can_join_all_spaces()        // ← still can_join_all_spaces (same as startup)
                .full_screen_auxiliary()
                .into(),
        );
        panel.show();                          // ← orderFrontRegardless kick (the previous fix)
    } else {
        panel.set_level(PanelLevel::Normal.value());
        panel.set_collection_behavior(
            CollectionBehavior::new().can_join_all_spaces().into(),
        );
    }
});
```

#### H. Mochi never calls `set_event_handler` — `pet_panel_macos.rs:112-204`

`MochiPetEventHandler` is declared empty in the `tauri_panel!` macro (lines 77-79) but `convert_windows` never calls `panel.set_event_handler(...)`. BongoCat attaches its handler at setup (`macos.rs:91`). Without an event handler / delegate, `window_did_become_key` / `window_did_resign_key` callbacks never fire — but more importantly, attaching a delegate is what makes `is_floating_panel`'s "stay floating on deactivate" behavior stick on some macOS builds (the floating-panel dance is partly delegate-driven).

### Diff Table: Mochi vs BongoCat

| Aspect | Mochi (pet) | BongoCat (main) | Likely Impact |
|---|---|---|---|
| **App activation policy** | Regular app (dock icon visible); no `set_dock_visibility(false)` anywhere in `src-tauri/` | `set_dock_visibility(false)` at setup (`macos.rs:35`) → accessory-style app | **HIGH.** Accessory apps' panels don't get demoted on app-switch because the app never "activates" in the regular sense. Regular apps' floating panels can be demoted by AppKit on `applicationDidResignActive:` unless `hidesOnDeactivate=NO` is re-asserted. |
| **collectionBehavior at startup** | `stationary \| can_join_all_spaces \| full_screen_auxiliary` (265 / 273) | `stationary \| move_to_active_space \| full_screen_auxiliary` | **MEDIUM-HIGH.** `move_to_active_space` (128) makes AppKit actively move the panel to whichever Space is active; the side-effect is that AppKit re-evaluates the panel's z-order each time the active Space changes (which can happen when switching apps on different Spaces). `can_join_all_spaces` (8) just leaves the panel on all Spaces without re-evaluating order. |
| **`alwaysOnTop` in tauri.conf.json** | `false` | `true` | **MEDIUM.** Tauri sets the initial NSWindow level to `NSFloatingWindowLevel` (3) at creation when `alwaysOnTop: true`. `set_level(Dock)` later overrides, but the creation-time flag also seeds AppKit's window-server state for the panel tier. |
| **`acceptFirstMouse` in tauri.conf.json** | (absent) | `true` | **LOW-MEDIUM.** Makes the panel accept the first mouse-down without needing to become active first. This is the "click brings it forward" path — explains why clicking Mochi's pet fixes it (the click activates the panel and re-orders it). Doesn't directly cause the on-top bug, but its absence is consistent with "needs a click to come forward". |
| **`panel.set_event_handler(...)` at startup** | Never called — `MochiPetEventHandler` declared but not attached | Called at setup (`macos.rs:91`) with `window_did_become_key` / `resign_key` / `resize` / `move` callbacks | **MEDIUM.** Attaching a delegate (even one that only emits Tauri events) is what makes AppKit route panel lifecycle callbacks through the panel subclass. Without a delegate, `is_floating_panel: true` + `can_become_key_window: true` may not fully take effect on a swizzled class. |
| **Show path on launch** | Tauri `getCurrentWindow().show()` from frontend (PetApp.tsx mount) — uses `[NSWindow orderFront]` family, which is a no-op when the app is not frontmost | Window `visible: true` at creation; setup modifies class/level/behavior; no `panel.show()` at startup | **MEDIUM.** Tauri's `win.show()` on a swizzled NSPanel may not exercise the `orderFrontRegardless` path that the panel subclass expects; the panel's z-order is "whatever Tauri's orderFront did", not the panel-tier order. |
| **`pet_set_always_on_top(true)` order** | `to_panel` → `set_level(Dock)` → `set_collection_behavior(can_join_all_spaces...)` → `panel.show()` | (BongoCat's toggle does NOT call `to_panel` / `set_collection_behavior` / `show` — only `set_level(Dock)`) | **MEDIUM.** BongoCat's toggle is minimal because the startup state is already correct. Mochi's toggle re-applies everything, suggesting the startup state isn't sticky. The order `set_behavior → show` is the *opposite* of BongoCat's `Show` flow (`show → set_behavior`). |
| **Panel config in `tauri_panel!` macro** | `is_floating_panel: true, can_become_key_window: true, can_become_main_window: false` | Identical | (no diff) |
| **`StyleMask`** | `empty().resizable().nonactivating_panel()` | `empty().resizable().nonactivating_panel()` | (no diff) |
| **`set_level` value (ON)** | `PanelLevel::Dock` (20) | `PanelLevel::Dock` (20) | (no diff) |
| **`set_level` value (OFF)** | `PanelLevel::Normal` (0) | `-1` (below Normal) | **LOW.** Different OFF-level, not relevant to ON-path bug. |
| **`macOSPrivateApi`** | `true` | `true` | (no diff) |
| **`shadow`** | `false` | `false` | (no diff) |
| **`transparent`** | `true` | `true` | (no diff) |
| **`decorations`** | `false` | `false` | (no diff) |
| **`skipTaskbar`** | `true` | `true` | (no diff) |
| **App activation / deactivation notifications** | Not subscribed | Not subscribed (only window-level `did_become_key` / `resign_key`, and only to emit Tauri events — no level re-apply) | (no diff — neither side re-applies level on app-switch) |

### External References

- `tauri-nspanel` v2.1 branch, `panel.rs` — confirms `show()` = `orderFrontRegardless` (line 244), `to_panel()` swizzles class via `object_setClass` and applies instance properties (`is_floating_panel → setFloatingPanel:YES`), `set_event_handler` attaches the objc2 delegate. Located at `/Users/yiminlin/.cargo/git/checkouts/tauri-nspanel-cab3955568b3504c/a3122e8/`.
- Apple docs (NSWindowCollectionBehavior): `moveToActiveSpace` (1<<7 = 128) — "The window moves to the active space when it's made visible"; `canJoinAllSpaces` (1<<3 = 8) — "The window appears on all spaces". They are mutually exclusive in practice — AppKit routes the panel through the active-space re-evaluation path only when `moveToActiveSpace` is set.
- Apple docs (NSPanel): `setFloatingPanel:YES` makes the panel float above normal windows even when its app isn't active; `setHidesOnDeactivate:` defaults to YES for non-floating panels and NO for floating panels. However, `is_floating_panel` is applied via `setFloatingPanel:` at `to_panel()` time — if the panel was already ordered front before `setFloatingPanel:YES` landed (race), the float behavior may not retroactively re-evaluate z-order.

## Ranked Root Causes (most likely → least likely)

### #1 — App runs as a regular (dock-icon) app, not an accessory app

BongoCat calls `set_dock_visibility(false)` at setup (`macos.rs:35`), which sets `NSApplicationActivationPolicyAccessory`. Under the accessory policy, the app never "activates" or "deactivates" in the regular sense, so AppKit never demotes its floating panels on app-switch. Mochi runs as a regular app (`NSApplicationActivationPolicyRegular`) — when the user switches to VS Code, Mochi receives `applicationDidResignActive:`, and AppKit's window server demotes non-key floating panels below the newly-frontmost app's windows until something (a click → `makeKeyAndOrderFront:`) re-asserts them.

This is the single biggest structural difference between the two apps and it's not in the NSPanel setup at all — it's in the **app activation policy**. The previous implementer focused on `panel.show()` because that's visible in BongoCat's `Show` flow, but BongoCat's main window is `visible: true` by default and `show_window` isn't even called at startup; the thing that makes BongoCat "just work" is `set_dock_visibility(false)` at setup.

**Specific change to try in Mochi**: add `let _ = app.set_dock_visibility(false);` in `convert_windows` (or wherever the Mochi app handle is available at setup). Caveat: this hides the dock icon for the WHOLE Mochi app, not just the pet — Mochi is an editor with a main window, so this is likely **not acceptable** as-is. The alternative is to set the activation policy to accessory only while the pet mode is active, or to subscribe to `NSApplicationDidResignActiveNotification` and re-assert `panel.show()` (orderFrontRegardless) + `set_level(Dock)` on every resign-active. Mochi's existing `pet_set_topmost_level` ~800ms poll (PetApp.tsx:434) is a hacky version of this for the legacy ScreenSaver path; the NSPanel path has no such poll.

### #2 — `can_join_all_spaces` vs `move_to_active_space` in startup collectionBehavior

BongoCat uses `stationary | move_to_active_space | full_screen_auxiliary` at setup. Mochi uses `stationary | can_join_all_spaces | full_screen_auxiliary`. The `moveToActiveSpace` flag (128) routes the panel through AppKit's active-space re-evaluation, which has a z-order re-evaluation side-effect; `canJoinAllSpaces` (8) does not. While collectionBehavior is primarily about Spaces (not z-order), in practice on macOS the two are entangled — switching apps often switches Spaces, and a panel that "moves to active space" also gets re-ordered to the front of its level.

**Specific change to try in Mochi**: in `convert_windows` (and in `pet_set_always_on_top` ON branch), swap `can_join_all_spaces()` for `move_to_active_space()`:

```rust
panel.set_collection_behavior(
    CollectionBehavior::new()
        .stationary()
        .move_to_active_space()      // was: can_join_all_spaces()
        .full_screen_auxiliary()
        .into(),
);
```

Single-line, zero-risk to try. This is the most surgical fix and the most likely to work without touching the activation policy.

### #3 — No delegate attached via `set_event_handler`

BongoCat attaches an `NsPanelEventHandler` with `window_did_become_key` / `resign_key` callbacks at setup (`macos.rs:91`). Mochi declares `MochiPetEventHandler` empty but never calls `panel.set_event_handler(...)`. Without the delegate, the objc2 panel subclass's override methods (which is what makes `is_floating_panel` + `can_become_key_window` actually take effect on a swizzled class) may not route correctly.

**Specific change to try in Mochi**: in `convert_windows`, after `set_collection_behavior`, add:

```rust
let handler = crate::pet_panel_macos::MochiPetEventHandler::new();
panel.set_event_handler(Some(handler.as_ref()));
```

The `MochiPetEventHandler` class already exists (empty body is fine for this purpose — the point is to attach *some* delegate so the panel-subclass overrides engage). Needs the same treatment for `pet-panel`, `pet-bubble`, `voice-orb`.

### #4 — Order of operations in `pet_set_always_on_top` ON branch

Mochi: `to_panel` → `set_level` → `set_collection_behavior` → `panel.show()`. BongoCat's `Show` flow: `panel.show()` → `set_collection_behavior`. The BongoCat order lets `orderFrontRegardless` re-evaluate z-order FIRST, then applies the new behavior so AppKit re-stages the panel under the new rules. Mochi's order applies behavior changes to a panel that hasn't been re-ordered, then the `show()` kicks the re-order — but the behavior change may not retroactively apply to the newly-ordered panel.

**Specific change to try in Mochi**: reorder the ON branch:

```rust
if enabled {
    panel.show();                  // orderFrontRegardless FIRST
    panel.set_level(PanelLevel::Dock.value());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .stationary()
            .move_to_active_space()        // see root cause #2
            .full_screen_auxiliary()
            .into(),
    );
}
```

### #5 — Tauri `win.show()` on a swizzled NSPanel doesn't trigger `orderFrontRegardless`

Mochi's pet is shown via `getCurrentWindow().show()` (Tauri's standard show, PetApp.tsx:480+) which maps to `[NSWindow orderFront]` / `[NSWindow makeKeyAndOrderFront:]` — these respect app-activation state and are effectively no-ops when Mochi isn't frontmost. BongoCat's main window is `visible: true` at creation, so it never goes through Tauri's show path — it's ordered front by the window server at creation. The first time Mochi's pet is shown, it's via Tauri's `orderFront`, not the panel's `orderFrontRegardless`. Later, `pet_set_always_on_top(true)` calls `panel.show()` (orderFrontRegardless), but by then the panel has already been "staged" at whatever z-order Tauri's `orderFront` left it in, and `orderFrontRegardless` on a panel that's already visible may not actually re-order it (AppKit short-circuits `orderFrontRegardless` if the window is already frontmost in its level).

**Specific change to try in Mochi**: replace `getCurrentWindow().show()` in PetApp.tsx's mount effect with `invoke('pet_panel_show', ...)` (or a new `pet_show` Rust command) that calls `panel.show()` (`orderFrontRegardless`) instead of Tauri's `orderFront`. This makes the initial show go through the NSPanel path, matching BongoCat's "panel-tier from frame 1" behavior.

## Caveats / Not Found

- **BongoCat's `show_window` Show flow (`panel.show()` + switch to `can_join_all_spaces`) is NOT called at startup.** The main window is `visible: true` by default in tauri.conf.json. The Show flow only runs when the `show_window` command is invoked (e.g. tray reopen). So the previous implementer's observation that "BongoCat calls `panel.show()` in its Show flow" is technically true but misleading — that flow isn't the startup path. The startup path is `set_dock_visibility(false)` + `to_panel` + level/style/behavior, no `panel.show()`.
- **Neither BongoCat nor Mochi subscribes to `NSApplicationDidBecomeActiveNotification` / `NSApplicationDidResignActiveNotification` / Space-change notifications** to re-apply level. The difference is that BongoCat doesn't need to (accessory policy) and Mochi does (regular policy) but doesn't.
- **Mochi's `pet_set_topmost_level` ~800ms poll (PetApp.tsx:434)** targets the LEGACY backend (`MOCHI_PET_PANEL_BACKEND=legacy`, ScreenSaver level). The NSPanel backend's `pet_set_topmost_level` is a no-op (per `pet_panel_macos.rs` comments). So under the NSPanel backend, there is NO periodic re-assert of level/behavior — once the panel is demoted on app-switch, nothing brings it back until the user clicks.
- **`setFloatingPanel:YES` IS applied in both apps** via `to_panel()` → `apply_instance_property` (panel.rs:646-648). So the `is_floating_panel: true` config field is not the differentiator — both have it.
- I did not find any `setFloatingPanel:` / `setHidesOnDeactivate:` / `setBecomesKeyOnlyIfNeeded:` calls outside the `tauri_panel!` macro config in either codebase. Neither app calls these directly.
- I did not find a `tracking_area` / `with: { ... }` block in BongoCat's `tauri_panel!` macro. So root cause #7 from the task brief (custom tracking area re-asserting level) is not present in BongoCat.
- The exact numeric value of Mochi's collectionBehavior (the task says 273) doesn't match `stationary(2) | can_join_all_spaces(8) | full_screen_auxiliary(256)` = 266. The discrepancy (273 vs 266) suggests Mochi may have an extra flag bit (7 = `ignoresCycle`? or the value includes `managed`/`participatesInCycle` bits). I did not verify the actual bit values in `objc2-app-kit`'s `NSWindowCollectionBehavior` — the task description's "273" is taken at face value. The flag *names* (`stationary | can_join_all_spaces | full_screen_auxiliary`) match BongoCat's Show-flow combo, just not BongoCat's setup combo.
