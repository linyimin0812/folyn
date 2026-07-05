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

### Solution (best-effort polling)
Poll the screen cursor + the window's outer position (Rust `pet_cursor_probe` returns both),
compute whether the cursor is over the sprite rect, and toggle `setIgnoreCursorEvents`:

```ts
const probe = await invoke<PetCursorProbe>('pet_cursor_probe');
const overSprite = pointInRect(
  probe.cursorX - probe.winX,
  probe.cursorY - probe.winY,
  SPRITE_RECT,            // e.g. {x:20,y:20,w:80,h:80} within the 120x120 window
);
await win.setIgnoreCursorEvents(!overSprite);
```

**Limitation**: there is up to `<poll-interval>` latency (250ms) before the window re-enables
mouse events after the cursor enters the sprite — clicks landing in that window pass through.
Acceptable for MVP; a per-pixel hit-test via `NSWindow` hit-testing would remove the latency
but needs native bridging.

**Required ACL**: `core:window:allow-set-ignore-cursor-events`, `core:window:allow-outer-position`.
Both are absent from `core:default`.

---

## Don't: Wrap-and-Swallow Tauri Calls

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
