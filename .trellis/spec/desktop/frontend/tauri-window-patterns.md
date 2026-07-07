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
- Rust commands (in `commands.rs`, registered in `lib.rs` `invoke_handler`) for anything the
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

## Common Mistake: Declaring a Second Window but Forgetting the Capability File

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
