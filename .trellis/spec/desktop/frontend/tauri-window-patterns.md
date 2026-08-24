# Tauri Window & ACL Patterns

> Executable contracts for multi-window Tauri 2 features: transparent/always-on-top windows,
> native popup menus, close-to-tray, click-through, and the ACL permission contract that gates
> every frontend `@tauri-apps/api/window` call.

---

## Scenario: Secondary Tauri Window (transparent, always-on-top, click-through)

### 1. Scope / Trigger
- Trigger: adding a second top-level window (e.g. desktop pet, floating panel, overlay) that is
  transparent, always-on-top, skips the taskbar, and has regions that pass clicks through.

### 2. Signatures
- `tauri.conf.json` `app.windows[]` entry — declares the window with flags (preferred over
  runtime creation when the window is structural):
  ```json
  {
    "label": "pet",
    "url": "/#/pet",
    "width": 120, "height": 120,
    "resizable": false,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "shadow": false,
    "visible": false,
    "focus": false,
    "dragDropEnabled": false
  }
  ```
- Frontend route switch in `main.tsx` mounts ONLY the secondary component in the secondary
  window (hash route), the full `App` everywhere else:
  ```ts
  const isPet = window.location.hash.startsWith('#/pet');
  isPet ? <PetApp /> : <App />;
  ```
- Rust commands (in `commands/` — split by domain into `file_commands`/`webview_commands`/`project_commands`/`pet_commands.rs`, re-exported by `commands/mod.rs` so `lib.rs` references them as `commands::<name>`; registered in `lib.rs` `invoke_handler`) for anything the
  ACL cannot grant or that needs host logic (e.g. `toggle_pet_mode`, `set_pet_position`,
  `pet_cursor_probe`, `pet_show_context_menu`). Custom `invoke` commands are NOT gated by the
  ACL — only the built-in `core:*` plugin commands are.

### 3. Contracts
- **Window label** is the single source of truth for capability scoping. `capabilities/<window>.json`
  MUST set `"windows": ["<label>"]` so permissions apply only to that window.
- **Event channel naming**: app-private IPC events use a `pet://` (or `<feature>://`) prefix and
  a typed payload shared across Rust and the frontend listener:
  - Rust emit: `app.emit("pet://menu-action", serde_json::json!({ "action": "new-note" }))`
  - TS listen: `listen<{ action: PetMenuAction }>('pet://menu-action', (e) => …)`
  - The `PetMenuAction` union is the contract — both sides import it; action strings must match
    exactly.

### 4. Validation & Error Matrix

| Frontend call | Required ACL permission | If missing |
|---|---|---|
| `getCurrentWindow().show()` | `core:window:allow-show` | call throws, silently swallowed by `try/catch` → feature inert |
| `getCurrentWindow().hide()` | `core:window:allow-hide` | same silent failure |
| `getCurrentWindow().isVisible()` | `core:window:allow-is-visible` | same |
| `getCurrentWindow().setFocus()` | `core:window:allow-set-focus` | same |
| `getCurrentWindow().startDragging()` | `core:window:allow-start-dragging` | drag broken |
| `getCurrentWindow().setIgnoreCursorEvents(b)` | `core:window:allow-set-ignore-cursor-events` | click-through broken |
| `getCurrentWindow().outerPosition()` | `core:window:allow-outer-position` | position probe broken |
| `getCurrentWindow().emit(...)` | `core:event:allow-emit` | cross-window event dropped |
| `listen(...)` | `core:event:allow-listen` (or `core:default`) | listener never registers |
| custom `invoke('my_cmd')` | none (custom commands bypass ACL) | n/a — only check Rust `invoke_handler` registration |

> **`core:default` does NOT include `allow-show`, `allow-hide`, `allow-is-visible`,
> `allow-start-dragging`, `allow-set-ignore-cursor-events`.** Each must be granted explicitly.

### 5. Good / Base / Bad Cases
- **Good**: declare structural window in `tauri.conf.json`; grant exactly the permissions traced
  from each frontend call; route dynamic behavior through custom `invoke` commands.
- **Base**: a normal single-window app needs no per-window capability file — `core:default` on
  the main window covers `invoke`, `listen`, basic dialog/fs.
- **Bad**: wrap every Tauri call in `try/catch` and ship — a missing permission fails silently,
  the feature looks "on" but does nothing (this bit the pet feature's fullscreen auto-hide: the
  `hide()`/`show()` calls were swallowed because `allow-show`/`allow-hide` were never granted).

### 6. Tests Required
- **Permission trace test (manual or spec)**: for each frontend Tauri API call site, assert the
  matching `core:*` permission exists in the window's capability JSON. A grep-based check is
  sufficient: for every `getCurrentWindow().<api>(` there must be a `core:window:allow-<api>`
  in the same window's capability file.
- **Event contract test**: the `PetMenuAction` union and the Rust id→action map must produce the
  same string set — assert in the frontend contract test (see `PetContextMenu.test.tsx`).
- **Window-state unit test**: toggle state + persisted position round-trip in the relevant
  Zustand store (see `settingsStore.test.ts` pet-mode tests).

### 7. Wrong vs Correct

#### Wrong — silent swallow
```ts
useEffect(() => {
  const t = setInterval(async () => {
    try {
      const win = getCurrentWindow();
      if (await win.isVisible()) await win.hide();   // throws if allow-hide missing → swallowed
    } catch { /* swallowed */ }
  }, 250);
  return () => clearInterval(t);
}, []);
// capability file has no core:window:allow-hide → feature is inert, no error surfaced
```

#### Correct — grant what you call
```json
// capabilities/pet.json
{
  "identifier": "pet-cap",
  "windows": ["pet"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-is-visible",
    "core:window:allow-start-dragging",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-outer-position",
    "core:event:allow-emit"
  ]
}
```

---

## Scenario: Native Popup Context Menu (escape small transparent window bounds)

### Problem
An HTML `position: fixed` menu rendered inside a small transparent Tauri window (e.g. 120x120)
is **clipped to the window bounds** — menu items outside the rect are invisible and unclickable.
Resizing the window or clamping `left/top` cannot fix this cleanly.

### Solution
Build the menu Rust-side and show it as an OS-rendered popup — it ignores the window bounds
entirely.

```rust
// commands.rs
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

const PET_CTX_SHOW: &str = "pet_ctx_show_main";
const PET_CTX_NEW: &str = "pet_ctx_new_note";
const PET_CTX_AI: &str = "pet_ctx_toggle_ai";
const PET_CTX_DISABLE: &str = "pet_ctx_disable";

#[tauri::command]
pub async fn pet_show_context_menu(window: tauri::WebviewWindow) -> Result<(), String> {
    let sep = PredefinedMenuItem::separator(window.app_handle()).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(window.app_handle(), &[
        MenuItem::with_id(window.app_handle(), PET_CTX_SHOW, "Show Main Window", true, None::<&str>).map_err(|e| e.to_string())?,
        MenuItem::with_id(window.app_handle(), PET_CTX_NEW, "New Note", true, None::<&str>).map_err(|e| e.to_string())?,
        MenuItem::with_id(window.app_handle(), PET_CTX_AI, "Toggle AI Panel", true, None::<&str>).map_err(|e| e.to_string())?,
        sep,
        MenuItem::with_id(window.app_handle(), PET_CTX_DISABLE, "Disable Pet Mode", true, None::<&str>).map_err(|e| e.to_string())?,
    ]).map_err(|e| e.to_string())?;
    window.popup_menu(menu).map_err(|e| e.to_string())?; // blocks until dismissed
    Ok(())
}
```

```rust
// lib.rs — map item id → action, emit the existing event so the frontend listener is unchanged
fn pet_ctx_menu_action(id: &str) -> Option<&'static str> {
    match id {
        PET_CTX_SHOW => Some("show-main"),
        PET_CTX_NEW => Some("new-note"),
        PET_CTX_AI => Some("toggle-ai"),
        PET_CTX_DISABLE => Some("disable-pet"),
        _ => None,
    }
}

.on_menu_event(|app, event| {
    if let Some(action) = pet_ctx_menu_action(event.id().as_ref()) {
        let _ = app.emit("pet://menu-action", serde_json::json!({ "action": action }));
    } else if event.id() == PET_MODE_MENU_ID {
        // … checkable menu toggle handling
    }
})
```

**Why**: the OS menu is unbounded by the source window, handles its own dismiss (Escape /
outside-click), and fires `on_menu_event` per item. No second window, no resize hack. Custom
`invoke` + `popup_menu` need no ACL permission; `core:menu` is in `core:default`.

**Don't**: render an HTML context menu inside a small transparent window and try to clamp it —
clipping is a hard platform limit, not a layout bug.

---

## Scenario: Close-to-Tray (keep app alive while a persistent window is open)

### Problem
Tauri quits when the last window closes by default. For a "persistent" feature (pet, tray
replacement), closing the main window must NOT quit the app as long as the secondary window is
visible.

### Solution
Handle `WindowEvent::CloseRequested` on the main window: prevent the close and hide instead when
the secondary window is visible.

```rust
.on_window_event(|window, event| {
    if window.label() != "main" { return; }
    let tauri::WindowEvent::CloseRequested { api, .. } = event else { return; };
    let pet_visible = window
        .app_handle()
        .get_webview_window("pet")
        .map(|p| p.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if pet_visible {
        api.prevent_close();
        let _ = window.hide();
    }
    // default: close proceeds → app quits, secondary window cleaned up with the process
})
```

**Gotcha**: read `is_visible()` live each time — do NOT cache a `petModeEnabled` boolean in Rust,
or a frontend-driven hide/show can desync the close decision. Quitting via the app menu bypasses
`CloseRequested`, so there is no stuck-window path.

**Gotcha (Windows reopen)**: with close-to-tray hiding the main window, the
`tauri-plugin-single-instance` callback must call `main.show()` + `set_focus()` **before**
checking `filter_argv_paths(&argv)` — a bare double-click of the icon passes no file path, and
an early-return on empty paths leaves the hidden window stuck. File-arg plumbing stays gated on
non-empty paths; only the window-surfacing is unconditional.

**Fullscreen-aware teardown** (macOS, `macOSPrivateApi`): hiding/destroying a window that is in
NATIVE fullscreen leaves a black fullscreen Space behind — the Space belongs to the window and
macOS does not tear it down when the window vanishes mid-transition. The exit-fullscreen step
is therefore mandatory, but it can be hidden from the user: the window content is made
invisible (`setAlphaValue:0`, main thread), the Space is dismissed via `exit_fullscreen_and_wait`,
then the window is destroyed (plugin tool windows, `close_fullscreen_window_directly`) or hidden
(main window pet-mode close-to-hide, `hide_fullscreen_window_directly`, which restores opacity to
1.0 while hidden so the next show is never transparent). Caveat: the native Space dismissal
animation briefly composites black while the window is invisible, so this path still flashes on
the uncommon ⌃⌘F "Enter Full Screen" route.

**Plugin tool windows use SIMPLE fullscreen (⌘⇧F "插件弹窗全屏")**: macOS blocks NATIVE fullscreen
on `alwaysOnTop` windows, so the plugin-tool fullscreen item uses `set_simple_fullscreen` (the
pre-Lion fullscreen: fills the screen, auto-hides dock/menu bar, **no separate Space**, pinned
level kept). Because there is no Space, closing a simple-fullscreen tool is a plain teardown in
the `CloseRequested` handler: make the window invisible (`setAlphaValue:0`), restore the
app-global dock/menu-bar presentation options + the windowed frame synchronously
(`set_simple_fullscreen(false)`, no animation), then let the default close destroy it — no
shrink-back, no black flash. Simple-fullscreen state is tracked per window label in
`PluginToolWindowState.simple_labels` because `is_fullscreen()` only reports native Space
fullscreen and there is no public getter.

**Main-window fullscreen restore**: the pet-mode close-to-hide path records whether the main
window was fullscreen when hidden (`MainWindowFullscreenRestore`), and the same handler's
`Focused(true)` branch restores fullscreen on the next show (dock reopen, pet "show-main",
open-file, ...) — so closing a fullscreen editor and reopening it comes back fullscreen.

**Per-tool fullscreen memory** (plugin tool windows): the close handler records, per
`plugin-tool-<plugin>-<tool>` key, the mode the window was closed in
(`ToolFullscreenMode::Native` for ⌃⌘F, `ToolFullscreenMode::Simple` for ⌘⇧F) in
`PluginToolWindowState` (`commands/webview_commands.rs`), and `open_plugin_tool_window` restores
it on the next open of the same tool (Native drops `alwaysOnTop` first — macOS blocks native
fullscreen on always-on-top windows — while Simple keeps it). The key is derived from the label
by stripping the trailing numeric instance counter.

---

## Scenario: Windows Custom Titlebar (undecorated main window + in-app window controls)

### Problem
On Windows, the native titlebar renders the app icon + "Folyn" title on the left and
minimize/maximize/close on the right. Folyn's own Topbar already shows the logo + name on the
left, so the native bar duplicates the branding and wastes a 30px strip. macOS is fine (traffic
lights are unobtrusive and there is no icon/title duplication), so the titlebar must be removed
**on Windows only** — `"decorations": false` in `tauri.conf.json` is NOT per-platform, it would
strip macOS too.

### Solution
1. **Create the main window hidden** (`"visible": false` in `tauri.conf.json`) so Windows can
   drop decorations BEFORE first paint — no decorated→borderless startup flash.
2. **Windows-only `set_decorations(false)` in Rust setup** (`#[cfg(target_os = "windows")]`
   inside the `.setup` closure), then `show()` + `set_focus()` the main window at the END of
   setup on all platforms (replaces the implicit show-at-build; macOS appearance timing is
   unchanged in practice).
3. **In-app window controls**: `WindowControls.tsx` (components/shell) renders
   minimize / maximize-restore / close at the right end of the Topbar, but only when
   `isWindowsPlatform()` (`utils/shellSidecar.ts`) — macOS/Linux render nothing.
4. **Drag + double-click-maximize come free**: the Topbar header has
   `data-tauri-drag-region="deep"`; tauri-core's injected drag script handles mousedown-drag AND
   double-click→`internal_toggle_maximize` on Windows (macOS maximizes on mouseup instead).
   Use the `"deep"` value — the bare attribute only recognizes mousedowns whose target IS the
   header element, which excludes the flex children that cover the bar. `"deep"` instead treats
   any non-interactive descendant as a drag handle; buttons/links remain clickable (and marks
   them `data-tauri-drag-region={false}` only where they sit deep inside a dedicated drag strip).
   Edge resizing + aero-snap still work: tao hit-tests undecorated resizable windows itself
   (WM_NCHITTEST), and the window keeps its shadow (`"shadow"` defaults to true).

### ACL (main window, `capabilities/default.json`) — grant what you call

| Frontend call | Required ACL permission | If missing |
|---|---|---|
| `win.minimize()` | `core:window:allow-minimize` | click no-ops silently |
| `win.toggleMaximize()` | `core:window:allow-toggle-maximize` | click no-ops silently |
| `win.close()` | `core:window:allow-close` | click no-ops silently |
| `data-tauri-drag-region` drag | `core:window:allow-start-dragging` | header drag broken (also silently broken today on macOS!) |
| `win.isMaximized()` | in `core:window:default` | n/a |
| `win.onResized()` | `core:event:allow-listen` (in `core:default`) | icon never flips on aero-snap |

Double-click-maximize via the drag region (`internal_toggle_maximize`) is in
`core:window:default` already. `onResized` is `listen('tauri://resize')` — event-system only.

### Tests Required
- `WindowControls.test.tsx` mocks `@tauri-apps/api/window` + `isWindowsPlatform`; asserts the
  three buttons render only on Windows, each click reaches the right window API, and a resize
  while maximized swaps the maximize→restore icon. Note: `test/setup.desktop.ts` initializes
  i18n with `zh`, so assert the Chinese `t()` strings like `Topbar.test.tsx` does.

---

## Scenario: Click-Through on Transparent Regions

### Problem
A transparent always-on-top window should let clicks on transparent areas pass through to the
desktop, while the mascot sprite remains interactive.

### Decision: do NOT toggle `setIgnoreCursorEvents` for the pet window

The pet window keeps `setIgnoreCursorEvents(false)` for its entire lifetime — the whole 120×120
window receives pointer events at all times. The transparent 20 px border around the 80×80
sprite does NOT pass clicks through to apps behind.

**Why**: the previous best-effort polling approach (60 ms `pet_cursor_probe` + 80×80 sprite
hit-test toggling `setIgnoreCursorEvents`) raced with native drag end. After `startDragging()`
returned, the cursor frequently rested in the 20 px transparent border; the next probe tick
flipped `setIgnoreCursorEvents(true)`, and the next click on the sprite passed through the
window without firing `handlePointerDown`. Symptom: the pet could be dragged once and then
stuck — "drag-once-then-blocked". The proactive `setIgnoreCursorEvents(false)` after drag end
did not help because the probe overwrote it within 60 ms.

**Trade-off**: the transparent border eats clicks (small UX cost — clicks intended for apps
behind the pet's transparent border hit the pet window instead). In exchange, drag and click
become 100 % reliable. Click-through via per-pixel `NSWindow` hit-testing is possible later if
the border's click-eating becomes a real problem, but MVP does not need it.

**What the probe still does**: `pet_cursor_probe` is still invoked periodically, but only for
fullscreen detection (hide the pet while the main editor window is fullscreen, re-show when
not). The cursor / window-position fields remain in the payload for future use; the JS side
ignores them.

### Required ACL (changed)

`core:window:allow-set-ignore-cursor-events` is **no longer required** for the pet window
(no `setIgnoreCursorEvents` calls remain). Keep `core:window:allow-outer-position` (drag-end
position read) and `core:window:allow-show` / `allow-hide` (fullscreen path).

---

## Scenario: Default & Restored Position via Work Area

### Problem
The pet's default bottom-right position must clear the macOS Dock and menu bar regardless of
Dock size, Dock position (bottom / left / right), or screen scale. Using `monitor.size` (the
full monitor rect) for the default-position math clips the mascot under the Dock. Restoring a
saved `petPositionX/Y` from a previous session without clamping also clips when the saved value
is off-screen (e.g. saved on a different monitor or before a margin fix).

### Solution: Rust `pet_get_work_area` + TS `clampPetPosition`

**Rust** (`commands.rs::pet_get_work_area`, registered in `lib.rs`): returns the primary
monitor's **work area in LOGICAL POINTS** with top-left origin, **plus `scale_factor`**:

- macOS: `NSScreen::mainScreen().visibleFrame` — excludes the Dock and menu bar. The native
  NSRect uses bottom-left origin, so flip Y before returning: `y = fullHeight - visOriginY - visHeight`.
  `scale_factor` = `[screen backingScaleFactor]` (2.0 on Retina, 1.0 on non-Retina).
- Other platforms (fallback): the full monitor rect from `app.primary_monitor()`,
  `scale_factor` = `monitor.scale_factor()`.

Payload shape: `{ x: i32, y: i32, width: i32, height: i32, scale_factor: f64 }`. The
`x`/`y`/`width`/`height` are **logical points**, NOT physical px.

**TS** (`petPosition.ts::clampPetPosition`): pure function that clamps a saved LOGICAL
position to a LOGICAL work-area rect so the whole 120×120 window stays on-screen. Returns
the clamped position; the caller persists the clamped value back to `settingsStore` so the
next launch doesn't re-clamp.

**TS** (`petPosition.ts::computeDefaultPetPosition`): unchanged signature — takes the work
area's `{width, height}` (logical) and returns a position **relative to the work area's
top-left** in logical points. The caller adds the work area's `(x, y)` origin to get an
absolute LOGICAL position, then multiplies by `scale_factor` before calling
`set_pet_position`. Margins (`PET_RIGHT_MARGIN`, `PET_BOTTOM_MARGIN`, `PET_MIN_TOP`) are a
small safety inset ON TOP of the work area, not a Dock-clearance buffer.

**Initial restore flow** (`PetApp.tsx`) — note the `× sf` at the `set_pet_position`
boundary and `÷ sf` after `outerPosition()`:

```ts
const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
const sf = workArea.scale_factor || 1;
const { petPositionX, petPositionY } = useSettingsStore.getState();  // saved as LOGICAL
if (petPositionX >= 0 && petPositionY >= 0) {
  const clamped = clampPetPosition({x: petPositionX, y: petPositionY}, workArea);
  if (clamped.x !== petPositionX || clamped.y !== petPositionY) {
    useSettingsStore.getState().setPetPosition(clamped.x, clamped.y);  // persist correction
  }
  await invoke('set_pet_position', { x: Math.round(clamped.x * sf), y: Math.round(clamped.y * sf) });
} else {
  const rel = computeDefaultPetPosition({ width: workArea.width, height: workArea.height });
  const abs = { x: workArea.x + rel.x, y: workArea.y + rel.y };  // LOGICAL
  await invoke('set_pet_position', { x: Math.round(abs.x * sf), y: Math.round(abs.y * sf) });
  useSettingsStore.getState().setPetPosition(abs.x, abs.y);       // persist LOGICAL
}
// poller persist: const pos = await getCurrentWindow().outerPosition();  // PHYSICAL
//   setPetPosition(Math.round(pos.x / sf), Math.round(pos.y / sf));     // store LOGICAL
```

### Unit contract

`set_pet_position` (Rust) and `getCurrentWindow().outerPosition()` / `setPosition()` take
/return `PhysicalPosition` — **physical px**. `pet_get_work_area` returns **logical points**
plus `scale_factor`. The size constants in `petPosition.ts` (`PET_WINDOW_SIZE=120`,
`PET_PANEL_WIDTH=600`, margins) are **logical** (they mirror the `tauri.conf.json` window
sizes, which are logical). So:

- **Do all position math in logical points** (workArea is logical; constants are logical).
- **Multiply by `scale_factor` immediately before** any physical-px API
  (`set_pet_position`, `pet_panel_set_position`, `setPosition(new PhysicalPosition(...))`).
- **Divide by `scale_factor` immediately after** any physical-px read
  (`outerPosition()`, `probe.window_x/y` from `pet_cursor_probe`).
- **Persist saved positions as logical** (display-resolution-independent). A `petPosVersion`
  migration key discards pre-fix physical-px saved values (reset to `-1`) so the default
  branch re-runs.

`monitor.size` (the full monitor rect from `@tauri-apps/api/window`) IS physical px — do
NOT mix it with the logical work area. Use the Rust `pet_get_work_area` for both the work
area rect and the scale factor.

---

## Scenario: Secondary Opaque Panel Window (the `pet-panel` quick-action popup)

### 1. Scope / Trigger
- Trigger: adding a second top-level window that is **opaque** (not transparent), always-on-top,
  skipTaskbar, shown on demand from another window, and dismissed via close-button / Esc /
  second-click toggle. The `pet-panel` quick-action window (launcher grid + embedded chat) opened
  by left-clicking the desktop pet is the canonical case.
- This is the **opaque counterpart** to the transparent `pet` window above: same structural
  `tauri.conf.json` declaration + per-window capability file + hash-route mount, but the body
  background is the editor theme (NOT transparent) and the window hosts real interactive content.

### 2. Signatures
- `tauri.conf.json` `app.windows[]` entry — declared structurally, `visible: false` at launch:
  ```json
  {
    "label": "pet-panel",
    "url": "/#/pet-panel",
    "width": 600, "height": 840,
    "resizable": false,
    "decorations": false,
    "transparent": false,
    "alwaysOnTop": true,
    "skipTaskbar": true,
    "shadow": true,
    "visible": false,
    "focus": true,
    "dragDropEnabled": false
  }
  ```
- Frontend route switch in `main.tsx` (extends the `#/pet` switch — one hash route per secondary
  window):
  ```ts
  const hash = window.location.hash;
  const route = hash.startsWith('#/pet-panel') ? 'pet-panel'
              : hash.startsWith('#/pet')       ? 'pet'
              : 'main';
  route === 'pet-panel' ? <PetPanelApp /> : route === 'pet' ? <PetApp /> : <App />;
  // tag <html> with is-pet-panel-window for scoped CSS (opaque body bg)
  ```
- Rust commands (in `commands.rs`, registered in `lib.rs` `invoke_handler`) — custom `invoke`
  commands own all window mutation (show/hide/position/visibility). `pet_panel_show` calls
  `set_focus()` after `show()` so the panel receives the Esc keydown:
  ```rust
  #[tauri::command]
  pub async fn pet_panel_show(app: tauri::AppHandle) -> Result<(), String> {
      if let Some(w) = app.get_webview_window("pet-panel") {
          w.show().map_err(|e| e.to_string())?;
          w.set_focus().map_err(|e| e.to_string())?;
      }
      Ok(())
  }
  // pet_panel_hide, pet_panel_set_position { x: i32, y: i32 },
  // pet_panel_get_position -> {x,y}, pet_panel_is_visible -> bool
  ```

### 3. Contracts
- **Window label** `pet-panel` scopes `capabilities/pet-panel.json` (`"windows": ["pet-panel"]`).
- **ACL reality**: the panel frontend does NOT call `getCurrentWindow().<api>()` for show/hide/
  position — it uses custom `invoke('pet_panel_*')` commands, which **bypass the ACL** (only
  built-in `core:*` plugin commands are gated). The launcher dispatch's only ACL-gated call site
  is `@tauri-apps/api/event` `emit('pet://menu-action', {action})` → requires
  `core:event:allow-emit`. Over-granting `core:window:allow-*` in `pet-panel.json` is harmless
  (provides future flexibility) but **not required** by the launcher code.
- **Chat ACL reality (corrected)**: the embedded AI chat self-hosts a `CliAdapter` that spawns
  the `claude` CLI via the Tauri **shell plugin** (`shell:allow-spawn` / `shell:allow-execute`
  scoped to the `claude-cli` sidecar — same `/bin/sh` + `args: true` scope as the main window),
  streams stdin (`shell:allow-stdin-write`), and stops the process (`shell:allow-kill`). Its
  neutral `workingDir` lives under `appDataDir/pet-chat-tmp`, so the panel also needs an
  **appData-scoped** fs grant: `fs:allow-mkdir`, `fs:allow-exists`, `fs:allow-read-file`,
  `fs:allow-read-text-file`, `fs:allow-write-file`, `fs:allow-write-text-file`,
  `fs:create-app-specific-dirs`, `fs:scope-appdata-recursive`. Do NOT grant
  `fs:scope-home-recursive` or any vault scope — the chat is vault-free per the PRD. ACL
  permissions are **per-window-label**: the main window's shell/fs grant in
  `capabilities/default.json` does NOT extend to `pet-panel`; the panel must carry its own
  identical shell sidecar grant. Earlier drafts said "the panel frontend only needs
  `core:event:allow-emit`" — that was true for the launcher dispatch but NOT for the chat; a
  missing shell grant surfaces as `[错误] Command plugin: shell|spawn not allowed by ACL` on
  first `send()`.
- **Event channel**: reuses the existing `pet://menu-action` channel (same as the native right-
  click menu). The launcher buttons `emit` `{ action: PetMenuAction }`; the main window's existing
  `App.tsx` listener dispatches + `focusMain()`. No new event channel needed.
- **`PetMenuAction` extension**: the union was extended from 4 (native menu) to 9 (4 native +
  5 launcher-only: `daily-note`, `global-search`, `clip-from-url`, `command-palette`,
  `toggle-theme`). The Rust `pet_ctx_menu_action` mapping recognizes all 9 strings so the
  contract stays uniform even though the native menu only renders 4 — the launcher emits the
  other 5 directly from the frontend.

### 4. Validation & Error Matrix

| Frontend action | Mechanism | Required ACL | If missing |
|---|---|---|---|
| show / hide / position the panel | custom `invoke('pet_panel_*')` | none (custom cmds bypass ACL) | n/a — check `invoke_handler` registration |
| `emit('pet://menu-action', …)` from the panel | `@tauri-apps/api/event` | `core:event:allow-emit` on `pet-panel` | launcher button looks clicked but main window never receives the action |
| chat: spawn `claude` CLI via `CliAdapter` | `@tauri-apps/plugin-shell` `spawn`/`execute` | `shell:allow-spawn` + `shell:allow-execute` on `pet-panel` (scoped to `claude-cli` sidecar, same `/bin/sh` + `args: true` as main window) | `[错误] Command plugin: shell\|spawn not allowed by ACL` on first `send()` — chat inert |
| chat: stream stdin / kill process | shell `stdinWrite` / `kill` | `shell:allow-stdin-write` + `shell:allow-kill` on `pet-panel` | stream hangs / stop button no-ops |
| chat: read/write the neutral `workingDir` under appData | `@tauri-apps/plugin-fs` | `fs:allow-mkdir` + `fs:allow-exists` + `fs:allow-read-file` + `fs:allow-read-text-file` + `fs:allow-write-file` + `fs:allow-write-text-file` + `fs:create-app-specific-dirs` + `fs:scope-appdata-recursive` on `pet-panel` (appData-scoped only; NO vault scope) | adapter `start()` fails to create/use the workingDir |
| Esc / close-button / second-click dismiss | custom `invoke('pet_panel_hide')` | none | n/a |
| fullscreen guard before show | `invoke('pet_cursor_probe')` → `main_fullscreen` | none | n/a |
| on-screen position clamp | `invoke('pet_get_work_area')` + TS `computePanelPosition` | none | n/a |

### 5. Good / Base / Bad Cases
- **Good**: structural window in `tauri.conf.json` (`visible:false`); custom `invoke` commands for
  all mutation; position the panel via `pet_panel_set_position` BEFORE `pet_panel_show` so it
  appears at the right spot in one frame (no flash at the default origin); fullscreen guard first;
  attach the panel via `computePanelPosition` so one of the panel's four corners sits
  `PET_PANEL_GAP` away from the pet **mascot icon's** diagonally-opposite corner on BOTH axes — the
  visible mascot is `PET_MASCOT_SIZE` (88×88) centered inside the 120×120 `pet` window (16px
  transparent margin on each side; see `.pet-mascot` in `pet.css`), so attaching to the icon's
  corner (not the window's) makes the panel visually touch the mascot. The corner is picked by
  comparing the pet's center to the work-area center on each axis (4 quadrants), so the
  panel always extends into the quadrant with more room. The panel may overflow the work-area edge
  on the diagonal side in degenerate cases but never overlaps the icon (it CAN overlap the
  window's transparent 16px margin — that margin is transparent and click-through).
  `computePanelPosition` takes the **actual panel size** as a third arg (default constants for
  first-ever open, the clamped saved size for subsequent opens) so a user-resized panel's corner
  still tracks the pet — passing the hardcoded default 600×840 when the panel has been resized
  larger would leave the corner drifting off the pet.
- **Panel size version-gate (auto-invalidation on default bump)**: the saved `petPanelWidth/Height`
  in `settingsStore` is **version-gated** by `petPanelSizeVersion` (persisted) vs the
  `PET_PANEL_SIZE_VERSION` constant in `petPosition.ts`. The open gesture (`PetApp.tsx`) and the
  panel mount-restore (`PetPanelApp.tsx`) both call `resolvePanelSize(saved, savedVersion, workArea)`
  — a pure helper that returns the clamped saved size when the version matches, or the current
  default (`PET_PANEL_WIDTH`/`PET_PANEL_HEIGHT`) when it doesn't (mismatch or first-ever open with
  `saved.width <= 0`). After applying the default, the caller persists the new size + new version so
  subsequent opens are stable. The persist poll saves the version alongside the size so a user
  resize after a migration is respected on next open. **Bump `PET_PANEL_SIZE_VERSION` whenever the
  default size changes** — forgetting means users keep the old default (same as today's bug). The
  hard-replace policy: a version bump resets ALL user resizes (a user who resized before the bump
  sees the new default, not their old resize). `0` is reserved for "pre-versioning / unset" so any
  existing user with version `0` (or a missing field) mismatches the current constant and gets
  migrated on next open. Panel POSITION (`petPanelX/Y`) is NOT version-gated — it is recomputed
  every open via `computePanelPosition` and is therefore never stale.
- **Base**: the panel is a normal opaque window — `core:default` covers `invoke`/`listen`; only
  `core:event:allow-emit` must be added on top for the launcher's `emit`.
- **Bad**: calling `getCurrentWindow().show()` from the panel frontend without granting
  `core:window:allow-show` on the `pet-panel` label → silent swallow → panel never appears. Use
  custom `invoke` commands instead (bypass ACL, host controls focus/position atomically).

### 6. Tests Required
- **Event contract test**: the `PetMenuAction` union, `PET_MENU_ACTIONS`, `PET_NATIVE_MENU_ACTIONS`,
  and `PET_LAUNCHER_ACTIONS` arrays must stay in sync with the Rust `pet_ctx_menu_action`
  id→action map (assert in `PetContextMenu.test.tsx`). The native and launcher sets must be
  disjoint; their union must equal `PET_MENU_ACTIONS`.
- **Positioning unit test**: `computePanelPosition` (corner attaches to the pet **mascot icon**
  (88×88 centered in the 120×120 `pet` window — `PET_MASCOT_SIZE`) per quadrant —
  bottom-right pet → panel bottom-right at icon top-left minus gap on both axes; degenerate tiny
  work area still no-overlap with the icon bounds (panel may overlap the window's transparent
  16px margin); the actual panel size is passed as a third arg so a resized panel's corner
  still tracks the pet) + `clampPanelPosition` (all four edges + degenerate work area) — see
  `petPosition.test.ts`.
- **Launcher dispatch test**: each launcher button emits the correct `pet://menu-action` payload
  and calls `pet_panel_hide` for main-window-targeting actions; Clip-from-URL toggles the inline
  form instead (no emit, no hide) — see `PetLauncher.test.tsx`.

### 7. Wrong vs Correct

#### Wrong — drive the secondary window from frontend `getCurrentWindow()` calls
```ts
// panel frontend on mount
const win = getCurrentWindow();
await win.setPosition(new LogicalPosition(x, y));  // needs core:window:allow-set-position
await win.show();                                   // needs core:window:allow-show
await win.setFocus();                               // needs core:window:allow-set-focus
// forgetting any of the 3 capability entries → silent swallow → panel inert
```

#### Correct — custom `invoke` commands own all mutation; position before show
```ts
// caller (the pet window) opens the panel
const probe = await invoke<PetCursorProbe>('pet_cursor_probe');
if (probe.main_fullscreen) return;                       // R4 fullscreen guard
if (await invoke<boolean>('pet_panel_is_visible')) {     // toggle (R8)
  await invoke('pet_panel_hide');
  return;
}
const workArea = await invoke<WorkArea>('pet_get_work_area');
const size = resolvePanelSize(workArea);              // default constants OR clamped saved size
const pos = computePanelPosition({x: probe.window_x, y: probe.window_y}, workArea, size);
await invoke('pet_panel_set_position', pos);             // position FIRST
await invoke('pet_panel_show');                          // then show → no flash
// panel frontend: close button + Esc both call invoke('pet_panel_hide')
```

> **Why custom commands**: they bypass the ACL (so no per-API capability entries to forget),
> let the host set focus + position atomically, and keep all window-state logic in one Rust
> module — the frontend never reasons about `core:window:allow-*` for the panel.

> **Re-assert `set_position` AND `set_size` AFTER `pet_panel_show` too** (macOS hidden-window
> deferral). On macOS, `set_size` and `set_position` on a HIDDEN `NSPanel`/`NSWindow` may not
> take effect reliably — the window manager can defer the frame update until the window is
> ordered in, and `show()` can reset the frame to the last visible position/size. So the
> pre-show `set_position` / `set_size` is best-effort; the authoritative call is the
> **re-asserted** one on the now-visible window, immediately after `pet_panel_show`:
> ```ts
> await invoke('pet_panel_set_position', posPhysical);   // pre-show (best-effort, avoids flash)
> await invoke('pet_panel_set_size', sizePhysical);      // pre-show (best-effort)
> await invoke('pet_panel_show');
> await invoke('pet_panel_set_position', posPhysical);   // re-assert AFTER show (authoritative)
> await invoke('pet_panel_set_size', sizePhysical);      // re-assert AFTER show (authoritative)
> ```
> Same values, so no visible jump. This is also why the version-bump default size fix
> (`PET_PANEL_SIZE_VERSION`) needs the **post-show** `set_size` to take — the pre-show call on
> the hidden window may not apply. Do NOT add a post-show re-assert in `PetPanelApp.tsx`'s
> mount-restore effect — that path runs on a hidden window with no `show()` call to follow;
> the open gesture's re-assert is the authoritative size-set.

---

## Common Mistake: Secondary Window Hosting a CliAdapter Forgets Its Own Shell Grant

**Symptom**: the `pet-panel` embedded AI chat throws
`[错误] Command plugin: shell|spawn not allowed by ACL` on the first `send()`, even though
the same `CliAdapter` / `claude` CLI works perfectly in the main window.

**Cause**: ACL permissions are scoped **per window label**. The main window's
`capabilities/default.json` grants `shell:allow-spawn` (scoped to the `claude-cli` sidecar)
plus the `shell:allow-stdin-write` / `shell:allow-kill` / appData fs set the adapter needs —
but that grant is bound to `"windows": ["main"]` and does NOT extend to the `pet-panel` label.
A secondary window that self-hosts a `CliAdapter` (pet-panel's chat, any future floating AI
surface) must carry its own identical shell sidecar grant in `capabilities/<label>.json`.
Earlier panel-capability drafts only granted `core:default` + `core:event:allow-emit`, which
is sufficient for the launcher dispatch but leaves the chat's `spawn()` call ACL-denied at
runtime.

**Fix**: in `capabilities/pet-panel.json`, grant the same `shell:allow-spawn` /
`shell:allow-execute` sidecar scope as `default.json` (the spawn target is the same `claude`
CLI), plus `shell:allow-stdin-write` + `shell:allow-kill` for streaming/stop, plus an
**appData-scoped** fs set (`fs:allow-mkdir`, `fs:allow-exists`, `fs:allow-read-file`,
`fs:allow-read-text-file`, `fs:allow-write-file`, `fs:allow-write-text-file`,
`fs:create-app-specific-dirs`, `fs:scope-appdata-recursive`) for the neutral `workingDir`
under `appDataDir/pet-chat-tmp`. Do NOT grant `fs:scope-home-recursive` or any vault scope —
the chat is vault-free per the PRD.

**Prevention**: when a secondary window runs any code path that touches a Tauri plugin
(shell, fs, dialog, …), trace every plugin call site and add the matching permission to that
window's capability file. The main window's grant never "leaks" to another label.

---



```ts
// ❌ Hides permission gaps; the feature ships inert with no surfaced error
try { await win.hide(); } catch {}
```

**Why it's bad**: Tauri ACL denials throw at runtime; a `try/catch` with an empty handler
silently disables the call. The code reads as working, tests pass (no throw escapes), and the
bug only shows up in manual QA — exactly what happened with the pet fullscreen auto-hide.

**Instead**: grant the permission in the capability file, AND when you must guard a call, log
the error so a silent failure surfaces during development:
```ts
try { await win.hide(); } catch (e) { console.warn('[pet] hide failed', e); }
```

---

## Common Mistake: Per-Session CLI Adapter in a Secondary Window Imports the Main Window's `adapterManager`

**Symptom**: a secondary window that hosts a multi-session CLI chat (e.g. `pet-panel`'s chat
after it gained sessions) either fails to build, or pulls main-window-only store state into
the secondary window's bundle, breaking Tauri-window isolation.

**Cause**: the main window's `components/ai/adapterManager.ts` exports a `sessionAdapters` Map
+ `getAdapterForSession` that read `useSettingsStore`. A secondary window tempted to reuse it
imports a module that transitively couples to main-window stores (`aiStore`, etc.), violating
the rule that secondary-window code must not top-level import vault/editor/`aiStore`.

**Fix**: the secondary window holds its OWN module-local `Map<sessionId, CliAdapter>` +
`getAdapterForSession(sessionId)`, mirroring `adapterManager`'s shape but reading only stores
the secondary window legitimately owns (for `pet-panel`: `settingsStore` + `petChatStore`).
Do NOT import `@/components/ai/adapterManager` from any `components/pet/*` or `services/petChat*`
file.

**Why a local Map (not a single shared adapter)**: `claudeAdapter.send` spawns a fresh process
per call, but the adapter instance caches `this.sessionId` (from the last `session_id` event)
as the `--resume` fallback. A single shared adapter serving multiple sessions would leak the
previous session's id as the fallback on a new session's first send (which has no explicit
`resumeSessionId` yet) — silently resuming the wrong conversation. One adapter per session
keeps each session's cached id scoped. This is exactly why the main window's `adapterManager`
is per-session too.

```ts
// services/petChatService.ts — secondary-window-local, NOT imported from ai/adapterManager
const sessionAdapters = new Map<string, CliAdapter>();
function getAdapterForSession(sessionId: string): CliAdapter {
  const settings = useSettingsStore.getState();
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === settings.cliAdapter) return existing;
  const adapter = CliAdapterRegistry.getInstance().create(settings.cliAdapter);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}
```

**Prevention**: when a secondary window needs per-session CLI adapters, copy the
`Map<sessionId, CliAdapter>` + id-invalidation pattern locally; never reach for the main
window's `adapterManager`. Grep-verify: `grep -nE "from '@/components/ai/adapterManager'"
apps/desktop/src/components/pet apps/desktop/src/services/petChatService.ts` must be empty.

---

## Common Mistake: `session_id` Event Lands on the Wrong Session After a Mid-Stream Switch

**Symptom**: user sends in session A, switches to session B while A is still streaming, then
sends in B. The CLI's `session_id` event for A's send arrives late and writes A's
`cliSessionId` onto B (or onto "the current active session") — corrupting B's resume chain so
B's next send resumes A's conversation.

**Cause**: the `onEvent` handler registered for the send reads "the current active session"
from the store AT EVENT TIME (`useStore.getState().activeSessionId`). Because the user switched
sessions between send and the `session_id` event, "active" no longer points at the session that
triggered the send.

**Fix**: the `onEvent` handler must be **closed over the `sessionId` that triggered the send**
and attribute every event (especially `session_id`) to THAT id, never to "current active".
`text`/`error`/`done` callbacks the caller passes should likewise target the send's `sessionId`
(e.g. `appendToLastMessage(sessionId, chunk)`), not "active".

```ts
// services/petChatService.ts — handler closed over `sessionId` (the send's session)
async function sendPetChatMessage(sessionId: string, prompt: string, handlers) {
  const adapter = getAdapterForSession(sessionId);
  const resumeSessionId = usePetChatStore.getState().sessions.find(s => s.id === sessionId)?.cliSessionId ?? undefined;
  const handler = (event: CliStreamEvent) => {
    switch (event.type) {
      case 'text':       handlers.onToken?.(event.content); break;
      case 'session_id': usePetChatStore.getState().setCliSessionId(sessionId, event.sessionId); break; // ← sessionId, NOT active
      case 'error':      adapter.offEvent(handler); handlers.onError?.(event.content ?? 'LLM error'); break;
      case 'done':       adapter.offEvent(handler); handlers.onDone?.(); break;
    }
  };
  adapter.onEvent(handler);
  await adapter.send(prompt, { bare: true, resumeSessionId });
}
```

**Test**: start a send for session A, switch active to B before the `session_id` event fires,
emit the event, assert `cliSessionId` was set on A (the send's session), not B. This applies
to ANY session-switching CLI adapter surface, including the main-window AI panel — the handler
must always attribute by the send's session, not by "current active".

**Prevention**: never read `activeSessionId` inside an event handler that was registered for a
specific send. Capture the send's `sessionId` in the closure at registration time.

---



**Symptom**: a new transparent/persistent window is declared in `tauri.conf.json` but its
`@tauri-apps/api/window` calls all no-op at runtime.

**Cause**: `core:default` (granted to the main window via `capabilities/default.json`) does not
extend to the new window's label, and `core:default` omits `show`/`hide`/`is-visible`/`start-
dragging`/`set-ignore-cursor-events` even on its own window.

**Fix**: add `capabilities/<new-label>.json` with `"windows": ["<new-label>"]` and grant every
`core:window:allow-*` matching a frontend call site (see Validation & Error Matrix above).

**Prevention**: when adding a window, run the permission trace test — for every
`getCurrentWindow().<api>(` call site, assert `core:window:allow-<api>` exists for that label.

---

## Common Mistake: Transparent Window Inherits Opaque Body Background

**Symptom**: a transparent always-on-top window (e.g. the pet) renders as an opaque
light-gray square instead of just the sprite — the desktop is not visible through the
"transparent" regions, and click-through on those regions is defeated because there are
no truly transparent regions.

**Cause**: the secondary window reuses the main app's CSS entry (`index.css`), which sets
`html, body { background: var(--bg); }`. Under `[data-theme="light"]` `--bg` is an opaque
color (`#f0f2f8`). `index.html` also hardcodes `<html data-theme="light">`. So the secondary
window's `<body>` paints an opaque background over the Tauri window's transparent surface,
even though `tauri.conf.json` declares `"transparent": true`. Tauri window transparency
only clears the native surface — anything the webview paints on top is on its own.

**Fix**: scope a transparent background override to the secondary window only. The route
switch (`main.tsx` checks `window.location.hash === '#/pet'`) is the natural discriminator:
tag `<html>` with a class for that route, then override in CSS:

```ts
// main.tsx
const isPetWindow = window.location.hash === '#/pet';
if (isPetWindow) document.documentElement.classList.add('is-pet-window');
```

```css
/* pet.css — scoped so the main editor window's theming is untouched */
html.is-pet-window,
html.is-pet-window body {
  background: transparent !important;
}
```

Keep `--acc` available — the mascot uses `var(--acc, #3a6ef0)`, which resolves via fallback
even without a theme applied.

**Prevention**: when a secondary window must be transparent, audit every CSS rule that
sets `background` on `html`/`body`/root containers and confirm each is either scoped away
from the secondary window or overridden to `transparent`. A `transparent: true` flag in
`tauri.conf.json` is necessary but not sufficient — the webview's own background must also
be transparent.

---

## Common Mistake: Mixing Logical Points and Physical Pixels for Window Position

**Symptom**: the pet (or any positioned secondary window) renders in the **center of the
screen** instead of its computed bottom-right default. The diagnostic log shows
`set_pet_position ok` and `outerPosition` matching the expected value — no errors, no
throws, the position logic "works" but the window is in the wrong place.

**Cause**: `pet_get_work_area` returns `NSScreen.visibleFrame` in **logical points**, but
`set_pet_position` / `outerPosition()` / `setPosition()` use `PhysicalPosition` (**physical
px**). On a Retina display (`backingScaleFactor` = 2.0), a logical bottom-right coordinate
like `(1552, 815)` passed directly as physical px lands at logical `(776, 408)` — the
screen center. The code's own header comment even claimed "physical px throughout" while the
implementation fetched logical points from Rust, so the unit contract was self-contradictory.
A `try/catch` around `set_pet_position` does NOT catch this — the call succeeds, it just
places the window at the wrong coordinates. Compounding the silence: the `800ms` poller
reads the wrong physical position, divides nothing, and persists it, so the bug looks
"stable" across restarts.

**Fix**: `pet_get_work_area` now also returns `scale_factor`. Do all position math in
**logical points** (workArea is logical; `PET_WINDOW_SIZE` / margins / `PET_PANEL_*` are
logical because they mirror `tauri.conf.json` logical sizes). Convert only at the physical
boundary: `× scale_factor` immediately before `set_pet_position` / `setPosition(PhysicalPosition)`,
`÷ scale_factor` immediately after `outerPosition()` / `probe.window_x/y`. Persist saved
positions as logical (display-resolution-independent); a `petPosVersion` migration discards
pre-fix physical saved values. See the "Default & Restored Position via Work Area" scenario
for the full contract.

**Prevention**: never trust a comment that asserts the unit of a value — verify against the
producing API. `NSScreen.visibleFrame` is points; `PhysicalPosition` is px; `monitor.size`
is px; `tauri.conf.json` `width`/`height` are logical. When a value crosses a
points↔px boundary, the conversion (`× backingScaleFactor` / `÷ backingScaleFactor`) must
happen at the call site, not be assumed away. If a window is mysteriously centered despite
"correct" position math, suspect a unit mismatch on Retina — add a one-shot file-based
diagnostic (a Rust command that appends to `appDataDir/<name>.log`, bypassing the secondary
window's devtools and fs-permission limits) and read the actual `scale_factor` + the value
passed to `set_pet_position`.

---

## Common Mistake: Secondary Window Calls `useNavStore` Directly Instead of Emitting a Menu-Action

**Symptom**: a "打开设置" / "跳转到 X" button rendered in a secondary Tauri window (voice-orb, pet-panel, pet-bubble) calls `useNavStore.getState().setCurrentPage('settings')` + `setSettingsTab('ai')` and emits `pet://menu-action { action: 'show-main' }`. Clicking it focuses the main window but the main window stays on whatever page it was on — the user expected to land on Settings → AI tab.

**Cause**: secondary Tauri windows are separate JS realms. Each realm gets its OWN instance of every Zustand store (Zustand is module-scoped, and each window has its own module graph). `useNavStore.getState().setCurrentPage('settings')` mutates the SECONDARY window's store instance, which has no UI consuming it — the main window's `useNavStore` is untouched. The `show-main` action in `routePetMenuAction` only calls `focusMain()`, it does not navigate, so the main window comes forward but stays put.

This bug was latent in `PetChat.tsx` + `PetChatSessionHeader.tsx` (the "unconfigured AI" CTA) before being copy-pasted into `VoiceOrbApp.tsx` — three call sites all had the same wrong pattern.

**Fix**: emit a dedicated `pet://menu-action` payload and let the main window's listener (in the main realm) perform the navStore mutation. Pattern:

```ts
// In a secondary window (voice-orb, pet-panel, pet-bubble) — DO NOT call useNavStore
async function openAiSettingsFromOrb(): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import('@tauri-apps/api/event');
  await emit('pet://menu-action', { action: 'open-ai-settings' });
}
```

```ts
// In petHostRouter.ts (runs in the main window's realm) — owns the navStore mutation
case 'open-ai-settings':
  useNavStore.getState().setCurrentPage('settings');
  useNavStore.getState().setSettingsTab('ai');
  await focusMain();
  break;
```

Add the new action to the `PetMenuAction` union (`PetContextMenu.tsx`) so the type system catches future callers.

**Prevention**: any secondary window that needs to mutate a store owned by the main window (navStore, editorStore, searchStore, etc.) MUST go through the `pet://menu-action` channel — never call the store from the secondary window's realm. If a new navigation target is needed, add a new `PetMenuAction` value + a new `case` in `routePetMenuAction` rather than reusing `show-main` + a direct store call. The `show-main` action is focus-only by design.

---

## Scenario: Global Keyboard Shortcut (OS-wide, fires when app is unfocused)

### 1. Scope / Trigger
- Trigger: binding an OS-wide keyboard shortcut that fires even when the app is not focused (e.g. summon the pet-panel from any app, global quick-action hotkeys).
- The in-editor `ShortcutItem` keybindings (Cmd+S, Cmd+B, etc.) are NOT global shortcuts — they're consumed by EditorView's keymap and never registered with the OS. Only entries flagged as global (currently `togglePetPanel`) go through this path.

### 2. Signatures
- `Cargo.toml`: `tauri-plugin-global-shortcut = "2"`.
- `lib.rs` plugin registration with a single global handler:
  ```rust
  .plugin(
      tauri_plugin_global_shortcut::Builder::new()
          .with_handler(|app, _shortcut, event| {
              if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                  let _ = app.emit("pet://shortcut-toggle", ());
              }
          })
          .build(),
  )
  ```
- Custom Rust command to swap the bound accelerator at runtime:
  ```rust
  #[tauri::command]
  pub async fn pet_panel_set_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
      use tauri_plugin_global_shortcut::GlobalShortcutExt;
      app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
      if accelerator.is_empty() { return Ok(()); }
      app.global_shortcut().register(accelerator.as_str()).map_err(|e| e.to_string())?;
      Ok(())
  }
  ```
- Frontend accelerator converter: `keysToAccelerator(["⌘","Shift","Q"]) → "Cmd+Shift+Q"` (see `src/utils/shortcutAccelerator.ts`). Symbol→token map: `⌘→Cmd`, `Ctrl→Control`, `⌥→Alt`, `Shift→Shift`; single-letter keys uppercased; multi-char tokens (e.g. `F5`, `Space`) pass through.

### 3. Contracts
- **Single global handler, swappable accelerator**: the plugin's `with_handler` closure is set ONCE at plugin build time and emits `pet://shortcut-toggle` on every `Pressed` event. `pet_panel_set_shortcut` only swaps WHICH accelerator fires that handler (`unregister_all` + `register`). This keeps the swap atomic and avoids re-binding a closure per rebind.
- **Fire on Pressed only**: filter `event.state == ShortcutState::Pressed` so a single keypress toggles once (not twice on press+release).
- **Custom invoke bypasses ACL**: the frontend calls only `pet_panel_set_shortcut` (a custom `#[tauri::command]`); it never invokes the plugin's built-in `register`/`unregister` commands directly. Custom commands bypass the ACL, so **no capability JSON entry is needed** for global shortcuts. (If the frontend ever needs to call the plugin's built-in commands directly, add `global-shortcut:allow-register` / `allow-unregister` to the relevant window's capability.)
- **Event channel**: `pet://shortcut-toggle` follows the app-private `pet://` prefix convention; payload is `()` (the handler just signals "fire", the frontend decides what to do).
- **Lifecycle**: register the persisted accelerator on `PetApp` mount (the `pet` window is always alive while pet mode is on, so the registration survives main-window hide/show). The OS auto-unregisters on process exit; no explicit unregister-on-unmount is needed.
- **Rebind flow**: `SettingsPage.tsx` `ShortcutEditor`'s `handleKeyDown` calls `updateShortcut` (persists to settingsStore) THEN, if the changed shortcut id is `togglePetPanel`, invokes `pet_panel_set_shortcut` with the converted accelerator. The command's `unregister_all`+`register` makes the new combo take effect system-wide immediately.

### 4. Why
- The pet floats over other apps; the user must summon the panel without switching to Folyn first. In-app `keydown` listeners only fire when Folyn is focused, defeating the purpose.
- Routing through a custom Rust command (instead of the plugin's JS API) keeps the frontend dependency surface small (no `@tauri-apps/plugin-global-shortcut` npm package) and avoids the ACL capability dance for the built-in commands.
- macOS uses Carbon `RegisterEventHotKey` under the hood (via the `global-hotkey` crate) — does NOT require Accessibility permission, unlike CGEventTap-based approaches. No permission prompt on first use.

### 5. Failure / Edge Modes
- **Accelerator parse error**: `register("Cmd+Shift+")` (trailing `+`) returns an `Err`; the command propagates it as a `String` and the frontend logs `[settings] failed to re-register global shortcut`. The OLD accelerator was already unregistered at that point, so a malformed rebind leaves the user with no global shortcut — the frontend should validate before calling (the `ShortcutEditor` recording handler always produces a non-empty, well-formed combo, so this path is defensive only).
- **OS-level conflict**: if another app has the same combo registered globally, the OS resolves the conflict unpredictably (typically the last-registered app wins, but ordering is not guaranteed). Document as a known limitation; do NOT build conflict-detection UI for the MVP.
- **Cross-platform**: the plugin loads on all platforms, but pet mode is macOS-only at present. On non-macOS, no accelerator is registered until the frontend calls `pet_panel_set_shortcut` — harmless no-op.
- **Reset to defaults**: `resetShortcuts` restores `togglePetPanel` to `['⌘','Shift','Q']` in the store, but does NOT call `pet_panel_set_shortcut` — the rebind only takes effect on next app restart (the mount effect re-reads the store). If immediate reset-to-default is needed, wire `resetShortcuts` to also call `pet_panel_set_shortcut`.

### 6. Tests
- `keysToAccelerator` unit tests (`src/utils/shortcutAccelerator.test.ts`): symbol→token map, single-letter uppercasing, multi-char passthrough, empty input, order preservation.
- `settingsStore` test: `DEFAULT_SHORTCUTS` includes `togglePetPanel` with default `['⌘','Shift','Q']`.
- No Rust unit test for `pet_panel_set_shortcut` (it shells out to the plugin's `register`, which needs a live app handle — covered by manual integration testing).

---

## Scenario: Multiple OS-wide Shortcuts (dispatch by HotKey id)

### 1. Scope / Trigger
- Trigger: the app needs TWO or more OS-wide shortcuts at the same time (e.g. pet-panel toggle + voice push-to-talk). The single-shortcut `with_handler` closure from the [Global Keyboard Shortcut scenario](#scenario-global-keyboard-shortcut-os-wide-fires-when-app-is-unfocused) no longer suffices because there is only ONE handler closure for the whole plugin.

### 2. Signatures
- `lib.rs` catch-all dispatches by HotKey identity, not by assuming "the shortcut" = one bound accelerator:
  ```rust
  .plugin(
      tauri_plugin_global_shortcut::Builder::new()
          .with_handler(|app, shortcut, event| {
              // `shortcut: HotKey` — the actual accelerator that fired.
              let pressed = event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed;
              let released = event.state == tauri_plugin_global_shortcut::ShortcutState::Released;
              // Voice push-to-talk: Pressed→start, Released→stop.
              let voice_hotkey = app.state::<voice::VoiceState>();
              if let Some(vhk) = voice_hotkey.voice_hotkey() {
                  if shortcut == &vhk {
                      let _ = app.emit(if pressed { "voice://hotkey-press" } else { "voice://hotkey-release" }, ());
                      return;
                  }
              }
              // Pet-panel: only Pressed, release ignored.
              if pressed { let _ = app.emit("pet://shortcut-toggle", ()); }
          })
          .build(),
  )
  ```
- Per-feature command that registers ONLY its own HotKey (targeted `unregister(prev)` + `register(new)`), NOT `unregister_all`:
  ```rust
  #[tauri::command]
  pub async fn voice_set_global_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
      use tauri_plugin_global_shortcut::GlobalShortcutExt;
      let state = app.state::<VoiceState>();
      // Targeted unregister: only the previously-stored voice HotKey, leaving the
      // pet-panel accelerator intact. `unregister_all` here would wipe BOTH.
      if let Some(prev) = state.voice_hotkey() {
          let _ = app.global_shortcut().unregister(prev);
      }
      if accelerator.is_empty() {
          state.set_voice_hotkey(None);
          return Ok(());
      }
      app.global_shortcut().register(accelerator.as_str()).map_err(|e| e.to_string())?;
      state.set_voice_hotkey(app.global_shortcut().resolve(accelerator.as_str()).ok());
      Ok(())
  }
  ```
- `VoiceState` holds `voice_hotkey: Mutex<Option<HotKey>>` (mirrors `PetSizeState` pattern). `voice_hotkey()` / `set_voice_hotkey()` accessors.

### 3. Contracts
- **ONE `with_handler` closure per app**. Tauri-plugin-global-shortcut does NOT support per-shortcut handlers in Rust — every `register`'d accelerator fires the SAME `with_handler`. Dispatch is by `shortcut: HotKey` parameter inside the closure.
- **Gotcha — the JS API `register(shortcut, handler)` ALSO fires the catch-all**: `@tauri-apps/plugin-global-shortcut`'s `register(shortcut, handler)` does NOT replace the Rust `with_handler`; the JS handler AND the Rust catch-all both fire. For multi-shortcut apps, this means: (a) the JS `handler` for shortcut A would ALSO trigger the Rust catch-all that emits "shortcut B toggled" — a bug. Use the Rust-catch-all-dispatch-by-HotKey-id approach exclusively; do NOT mix in JS-side `register(handler)`.
- **Targeted unregister, never `unregister_all`**: each per-feature command (`voice_set_global_hotkey`, future `foo_set_shortcut`) unregisters ONLY its own previously-stored HotKey. `unregister_all` in any of them would silently wipe every other feature's accelerator — the cross-feature bug that targeted unregister prevents.
- **Event channels**: each feature owns its own `app-private-prefix://` event. Voice uses `voice://hotkey-press` / `voice://hotkey-release` (push-to-talk needs both edges); pet-panel uses `pet://shortcut-toggle` (Pressed only). Do NOT route two features through one channel — the handler closure's dispatch already separates them.
- **HotKey identity**: `shortcut == &stored_hotkey` compares the resolved HotKey object (modifier+key+side), not the accelerator string. Store the `HotKey` returned by `resolve(accelerator)` in the per-feature state, then compare by reference identity in the catch-all.

### 4. Validation & Error Matrix
| Condition | Result |
|---|---|
| Two features register the same accelerator | OS resolves last-registered wins; both catch-all branches see the HotKey but only the matching feature dispatches — the other feature's HotKey never matches, silent no-op. Document as a known limitation. |
| `voice_set_global_hotkey("Cmd+Shift+")` (malformed) | `register` returns `Err`; `set_voice_hotkey(None)` is NOT called, so the previous HotKey stays registered. Frontend should validate before invoke. |
| Pet-panel `pet_panel_set_shortcut` still uses `unregister_all` | ✅ backward-compatible for the SINGLE-shortcut case; but if voice is also active, calling `pet_panel_set_shortcut` would WIPE the voice accelerator. Migrate `pet_panel_set_shortcut` to targeted unregister when a second non-pet shortcut is introduced. |
| Frontend uses `@tauri-apps/plugin-global-shortcut` JS `register(shortcut, handler)` | Both the JS handler AND the Rust catch-all fire for that shortcut. The catch-all's dispatch-by-id still routes correctly IF the HotKey is also stored in `VoiceState` — but the JS handler is redundant and confusing. Don't do it. |

### 5. Good / Base / Bad Cases
- **Good**: two OS-wide shortcuts (pet + voice), each registered by its own per-feature command, catch-all dispatches by HotKey id → each fires its own `app-private-prefix://` event. No cross-fire.
- **Base**: single OS-wide shortcut (pet only). The catch-all falls through to `pet://shortcut-toggle` when `voice_hotkey` is None. Same behavior as the pre-voice spec.
- **Bad**: a per-feature command uses `unregister_all` → rebinding the voice hotkey wipes the pet-panel accelerator; the user's pet-panel toggle silently stops working until app restart.

### 6. Tests
- No Rust unit test for the catch-all (needs a live app handle + OS shortcut registration — manual integration testing).
- `shortcutAccelerator.test.ts` still covers the `keys → "Cmd+Shift+KeyX"` converter shared by both features' frontend rebind flows.
- Manual smoke: set voice hotkey to Cmd+Shift+V → pet-panel toggle (Cmd+Shift+Q) still works → rebinding voice to Cmd+Shift+D does not break pet-panel.

### 7. Wrong vs Correct

#### Wrong — per-feature command uses `unregister_all`
```rust
// voice_set_global_hotkey
app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;  // wipes pet-panel too!
app.global_shortcut().register(accelerator.as_str()).map_err(|e| e.to_string())?;
```

#### Correct — targeted unregister of the previously-stored HotKey only
```rust
if let Some(prev) = state.voice_hotkey() {
    let _ = app.global_shortcut().unregister(prev);  // pet-panel accelerator untouched
}
app.global_shortcut().register(accelerator.as_str()).map_err(|e| e.to_string())?;
state.set_voice_hotkey(app.global_shortcut().resolve(accelerator.as_str()).ok());
```

#### Wrong — frontend uses `@tauri-apps/plugin-global-shortcut` JS `register(shortcut, handler)` for the voice shortcut
```ts
// Frontend registers a JS handler — BUT the Rust with_handler catch-all ALSO fires.
await register('Cmd+Shift+V', (event) => {
  if (event.state === 'Pressed') invoke('voice_start');
});
// Result: the Rust catch-all dispatches by HotKey id → emits voice://hotkey-press
// (correct), AND the JS handler fires (also correct, but redundant). Worse: the
// pet-panel catch-all branch is in the SAME closure — if the JS handler ever
// short-circuits, the Rust branch is unaffected, giving inconsistent behavior.
```

#### Correct — frontend calls only the custom `voice_set_global_hotkey` invoke; Rust catch-all owns all dispatch
```ts
// Settings change → re-register via Rust (which owns HotKey storage + dispatch).
await invoke('voice_set_global_hotkey', { accelerator });
// App.tsx mount effect listens for voice://hotkey-press / voice://hotkey-release
// (emitted by the Rust catch-all) and calls useVoiceInput.getState().start()/stop().
```

**Reference implementation**: `apps/desktop/src-tauri/src/lib.rs` (catch-all dispatch), `apps/desktop/src-tauri/src/voice.rs` (`VoiceState` + `voice_set_global_hotkey`), `apps/desktop/src/App.tsx` (event listener).

## Scenario: Pet Bubble Notification + Configurable OS Notification

### 1. Scope / Trigger
- Trigger: surfacing a desktop-pet event (schedule reminder, pet-chat new message, task event, external push) to the user as EITHER an in-app speech bubble above the pet OR an OS native notification, with the form user-configurable (`bubble` | `system` | `both` | `off`).
- Three moving parts: a transparent `pet-bubble` NSPanel window (the bubble), a `tauri-plugin-notification` OS-notification path, and a main-window dispatcher that reads the user's `notificationForm` setting and routes a single `pet://notify` event to one or both.

### 2. Signatures
- **Tauri window** (`tauri.conf.json` `app.windows[]`): `label:"pet-bubble"`, `url:"/#/pet-bubble"`, `transparent:true`, `decorations:false`, `skipTaskbar:true`, `visible:false`, `focus:false`, `shadow:true`, size 320×120. Route mounted in `main.tsx` (`#/pet-bubble` → `<PetBubbleApp/>`), checked BEFORE `#/pet` (prefix collision).
- **Rust commands** (`commands.rs`, registered in `lib.rs`): `pet_bubble_show`, `pet_bubble_hide`, `pet_bubble_set_position { x: i32, y: i32 }` — mirror the `pet_panel_*` pattern; custom invoke bypasses the ACL.
- **NSPanel conversion**: `pet_panel_macos.rs` `convert_windows` label list must include `"pet-bubble"` so the bubble gains Dock level + `can_join_all_spaces | full_screen_auxiliary` (fullscreen coverage). A plain `alwaysOnTop` window CANNOT rise over a fullscreen app.
- **Event channels** (typed payload shared Rust↔TS):
  - `pet://notify` — `PetBubblePayload` — trigger sources emit this (the single entry point).
  - `pet://bubble-show` — `PetBubblePayload` — dispatcher re-emits to the `pet-bubble` window when `notificationForm` includes bubble.
  - `pet://bubble-action` — `{ type: 'navigate' | 'action'; actionId?: string; target?: PetBubbleTarget }` — bubble buttons/title AND OS-notification click both emit this; the main window's `handleBubbleAction` is the single routing exit.
- **Dispatcher** (`services/petNotifyDispatcher.ts`, main-window-only):
  - `decideNotification(form): { bubble: boolean; system: boolean }` — pure.
  - `dispatchNotification(payload)` — reads `settingsStore.notificationForm`, routes to bubble emit and/or `osNotify`.
  - `osNotify(payload)` — `requestPermission` → `registerActionTypes` (once) → `sendNotification({ id, title, body, actionTypeId, extra })`; stashes `target` in `Map<id, target>`.
  - `startNotificationClickListener()` → `onAction(cb)` → `targetById.get(notification.id)` → `emit('pet://bubble-action', { type:'navigate', target })`.

### 3. Contracts
- **`PetBubblePayload`** (the contract across Rust demo emit + all future trigger sources):
  `{ text: string; title?: string; kind?: 'info'|'reminder'|'message'|'event'; source?: string; target?: { kind: 'schedule'|'chat'|'task'|'file'; id: string }; actions?: { id: string; label: string; kind?: 'primary'|'ghost' }[] }`
- **`notificationForm`** (`settingsStore`, persisted, default `'bubble'` to preserve pre-feature behavior): `'bubble' | 'system' | 'both' | 'off'`. Hydrate coerces unknown/missing → `'bubble'`.
- **Capability scoping** (per-window-label, ACL reality):
  - `capabilities/pet-bubble.json` (`windows: ["pet-bubble"]`): `core:default` + `core:event:allow-listen` (hear `pet://bubble-show`) + `core:event:allow-emit` (fire `pet://bubble-action`). NO `core:window:*` — all window mutation goes through custom `pet_bubble_*` invoke (bypass ACL).
  - `capabilities/default.json` (`windows: ["main"]`): add `notification:default` — the OS notification is fired from the MAIN window's dispatcher only. The main window's grant does NOT extend to `pet` / `pet-panel` / `pet-bubble`.
- **OS-notification click→target contract**: pass an explicit numeric `id` in `sendNotification({ id, ... })`; stash `target` in a module-local `Map<id, target>`; on `onAction` click, look up by `notification.id`, `delete` (one-shot), emit `pet://bubble-action`. Do NOT rely on `extra` round-trip in the click event — research confirmed it is unreliable across platforms.

### 4. Validation & Error Matrix

| Frontend action | Mechanism | Required ACL | If missing / fails |
|---|---|---|---|
| bubble show/hide/position | custom `invoke('pet_bubble_*')` | none (custom cmds bypass ACL) | check `invoke_handler` registration in `lib.rs` |
| `emit('pet://bubble-show')` from main | `@tauri-apps/api/event` | `core:event:allow-emit` on `main` (in `default.json`) | bubble never shows; main already has it via `core:default`? — NO, `core:default` omits `allow-emit`; verify `default.json` grants it |
| `listen('pet://bubble-show')` in bubble window | `@tauri-apps/api/event` | `core:event:allow-listen` on `pet-bubble` | listener never registers → bubble inert (silent) |
| `emit('pet://bubble-action')` from bubble | event | `core:event:allow-emit` on `pet-bubble` | button click looks to work but main window never receives the jump |
| `sendNotification` / `registerActionTypes` / `onAction` | `@tauri-apps/plugin-notification` | `notification:default` on `main` | `[错误] notification not allowed by ACL` on first notify |
| OS notification permission | `requestPermission()` | n/a (OS gate, not ACL) | first notify triggers the macOS auth prompt; denied → `osNotify` returns early, bubble path (for `'both'`) still fires |

### 5. Good / Base / Bad Cases
- **Good**: trigger source emits `pet://notify` once → dispatcher reads `notificationForm` → routes to bubble and/or OS notification; OS-notification click → `onAction` → id-lookup → `pet://bubble-action` → `handleBubbleAction` jumps. Single routing exit, single entry point.
- **Base**: `'bubble'` (default) — only the in-app bubble fires; OS notification path is dormant. Existing behavior preserved.
- **Bad**: a trigger source emits `pet://bubble-show` directly (bypassing `pet://notify` + dispatcher) → the user's `notificationForm` setting is ignored (system-only users never see it). Always emit `pet://notify`; only the dispatcher emits `pet://bubble-show`.
- **Bad**: rely on `notification.extra.target` inside `onAction` instead of the `Map<id,target>` lookup → works on some platforms, silently returns `undefined` on others → click does nothing. Use `notification.id` lookup.

### 6. Tests Required
- **Dispatcher routing** (`services/petNotifyDispatcher.test.ts`): `decideNotification` over all 4 forms; `dispatchNotification` emits `pet://bubble-show` only when `bubble`, calls `osNotify` only when `system`, both for `'both'`, neither for `'off'`; OS click `onAction` → id-lookup → `emit('pet://bubble-action', { type:'navigate', target })` → entry deleted (one-shot). Mock `@tauri-apps/plugin-notification` via `vi.mock` (the plugin is NOT in `vitest.workspace.ts` tauriAlias by default — add an alias or `vi.mock` per test).
- **Bubble component** (`components/pet/PetBubbleApp.test.tsx`): TTL auto-dismiss, ✕ close, action/title → `pet://bubble-action` emit, in-flight replacement (no double TTL). The `pet://bubble-show` listener registers on an async microtask — `await waitFor` before asserting.
- **Positioning** (`components/pet/petPosition.test.ts`): `computeBubblePosition` — above pet when room, flips below at the menu-bar top, X clamps to work area, nonzero origin, small pet.
- **Settings** (`store/settingsStore.test.ts`): `notificationForm` default `'bubble'`; hydrate coerces invalid → `'bubble'`; persist round-trip.

### 7. Wrong vs Correct

#### Wrong — trigger source emits the bubble channel directly, ignoring the form setting
```ts
// some future schedule-reminder trigger
await emit('pet://bubble-show', payload);  // bypasses dispatcher
// user who picked 'system' never sees the reminder
```

#### Correct — single `pet://notify` entry point; dispatcher owns form-based routing
```ts
// any trigger source
await emit('pet://notify', payload);
// dispatcher (main window):
const form = useSettingsStore.getState().notificationForm;
const { bubble, system } = decideNotification(form);
if (bubble) await emit('pet://bubble-show', payload);
if (system) await osNotify(payload);
```

#### Wrong — trust `extra` in the OS click callback
```ts
onAction((n) => {
  const target = (n.extra as any)?.target;  // undefined on some platforms
  if (target) emit('pet://bubble-action', { type: 'navigate', target });
});
```

#### Correct — id-lookup in a module-local map
```ts
sendNotification({ id, title, body, actionTypeId, extra: { target } });
targetById.set(id, payload.target);
onAction((n) => {
  const target = targetById.get(n.id);
  if (target) { targetById.delete(n.id); emit('pet://bubble-action', { type: 'navigate', target }); }
});
```

---

## Common Mistake: `tauri-plugin-notification` Click API Name & `extra` Round-Trip

**Symptom**: OS notification shows, but clicking it does nothing (no jump). Or: code references `onNotificationEvent` / `onClicked` which don't exist — TS build fails or runtime `TypeError: onNotificationEvent is not a function`.

**Cause**: `@tauri-apps/plugin-notification` v2.3.3 exposes `onAction(cb: (notification: Options) => void)` — NOT `onNotificationEvent`, NOT `onClicked`. The click callback receives the full `Options` object (including the `id` you set), but `extra` round-trip in that callback is unreliable across platforms (sometimes `undefined`). Relying on `extra` for the jump target silently breaks on the affected platform.

**Fix**: register a single action type via `registerActionTypes([{ id, actions: [{ id: 'view', title: '查看详情' }] }])` (once per process, idempotent guard), pass `actionTypeId` + an explicit numeric `id` to `sendNotification`, stash the jump `target` in a module-local `Map<id, target>`, and in the `onAction` callback look up by `notification.id` (then `delete` — one-shot). The looked-up target is emitted on `pet://bubble-action` so the existing jump router handles it uniformly.

**Prevention**: when integrating any `@tauri-apps/plugin-*` click/event callback, verify the actual exported symbol name against `node_modules/.pnpm/@tauri-apps+plugin-*/node_modules/@tauri-apps/plugin-*/index.d.ts` before coding — the v2 plugin event API names are not stable across minor versions and several names that appear in docs/issues (`onNotificationEvent`, `onClicked`) do not exist in the shipped types. Do not trust callback-carried custom data (`extra`); pass an explicit `id` and keep a side-table.
