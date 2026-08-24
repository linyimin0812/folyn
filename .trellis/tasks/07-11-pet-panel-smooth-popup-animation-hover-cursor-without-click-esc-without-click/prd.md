# pet-panel: smooth popup animation + hover cursor without click + Esc without click

## Goal

Three pet-panel UX regressions reported by the user. All stem from the
`nonactivating_panel` NSPanel backend (`pet_panel_macos.rs`) not behaving like
a normal key/activating window:

1. **Popup animation flickers / not smooth** (闪动) when the panel opens.
2. **Cursor doesn't become a hand on first hover** over the pet mascot — a
   click is required first.
3. **Esc can't close the panel until the panel is clicked once** — keyboard
   focus isn't established on show.

Make the panel feel native: smooth open, hover-cursor without click, Esc
without click.

## What I already know (from repo inspection)

### Issue 1 — flicker on open
- `applyPanelFrame` ([PetApp.tsx:123-133](../../../apps/desktop/src/components/pet/PetApp.tsx#L123-L133)) order: `set_pos → set_size → pet_panel_show(=show+set_focus) → set_pos → set_size` (post-show re-assert).
- `pet_panel_show` ([commands.rs:865-879](../../../apps/desktop/src-tauri/src/commands.rs#L865-L879)) bundles `show()` + `set_focus()`.
- `set_focus()` fires `tauri://focus` → `PetPanelApp` `onFocusChanged` → `setVisible(true)` → CSS fade-in starts.
- The post-show `set_pos/size` re-assert runs AFTER `pet_panel_show` returns, i.e. DURING the 160ms fade → the panel moves/resizes while half-faded-in → 闪动.
- CSS ([pet.css:229-232](../../../apps/desktop/src/components/pet/pet.css#L229-L232)): `opacity:0 →1` + `transform: scale(0.96→1)`, `transform-origin: top left`, 160ms ease-out. The scale + top-left origin amplifies the mid-fade frame shift.
- The fade's stated purpose (pet.css:223-228): mask the frame re-assert flash from `applyPanelFrame`.

### Issue 2 — no hover cursor without click
- `pet_set_cursor` ([commands.rs:662-678](../../../apps/desktop/src-tauri/src/commands.rs#L662-L678)) calls `[NSCursor pointingHandCursor] set]` from `PetApp.handleMouseEnter` ([PetApp.tsx:262-274](../../../apps/desktop/src/components/pet/PetApp.tsx#L262-L274)).
- The pet panel is `nonactivating_panel` + `can_become_main_window: false` ([pet_panel_macos.rs:39-44](../../../apps/desktop/src-tauri/src/pet_panel_macos.rs#L39-L44)). When Folyn isn't frontmost, the frontmost app owns the cursor → `NSCursor set` doesn't stick. CSS `cursor:pointer` (PetApp.tsx:833) also doesn't apply until the panel is key (after a click).
- The code comment ([commands.rs:659-660](../../../apps/desktop/src-tauri/src/commands.rs#L659-L660)) already names the reliable fix: **`NSTrackingArea` with `NSTrackingActiveAlways`** on the panel's content view, `cursorUpdate` sets the hand cursor.

### Issue 3 — Esc needs a click first
- `pet_panel_show` calls `set_focus()` which activates the app + makes the window key, BUT the WKWebView's NSView is not necessarily first responder.
- `PetPanelApp`'s Esc listener is `document.addEventListener('keydown', …)` ([PetPanelApp.tsx:88-97](../../../apps/desktop/src/components/pet/PetPanelApp.tsx#L88-L97)). `document` only receives `keydown` when the webview is first responder. After show, window is key but webview isn't first responder → no keydown → Esc fails until a click makes the webview first responder.
- Fix direction: `window.makeFirstResponder(webview)` after `set_focus()` (Rust), OR focus an element on show.

## Assumptions (temporary)

- The 3 issues are independent enough to fix separately but share the NSPanel focus theme.
- macOS-only (the NSPanel backend is macOS; `FOLYN_PET_PANEL_BACKEND=legacy` fallback exists but is not the focus).
- No new Tauri plugin / dependency — use existing `cocoa` + `objc` crates already in the Rust deps (used by `pet_set_cursor`, `pet_show_context_menu`).

## Open Questions

- (Technical verification — delegated to research): exact safe objc pattern for `NSTrackingArea ActiveAlways` + `cursorUpdate` on a non-activating NSPanel's WKWebView content view; whether `makeFirstResponder(webview)` persists and is the right call.

## Requirements (evolving)

1. Panel opens with no visible frame jump / flicker during the fade-in.
   - **Decouple the fade trigger from `tauri://focus`**: `applyPanelFrame` emits a `pet://panel-fade-in` event AFTER the post-show frame re-assert; `PetPanelApp` listens and calls `setVisible(true)` then — so the fade starts from the stable final frame, not mid-re-assert.
   - **CSS softer entrance**: opacity ~180ms ease-out + subtle `scale(0.98→1)` from `transform-origin: center` (drop the `top-left` origin + the bigger `0.96` scale that amplified the mid-fade shift).
2. Hovering the pet mascot shows the hand cursor on first hover (no click needed), even when Folyn is not the frontmost app.
   - **Use the `tauri-nspanel` crate's native `tracking_area`** (`ActiveAlways | CursorUpdate | MouseEnteredAndExited | InVisibleRect`) on `FolynPetPanel` + a `panel_event!` `on_cursor_update`/`on_mouse_exited` handler that sets the NSCursor. `ActiveAlways` is the flag that delivers hover events when the app isn't frontmost. No raw objc.
   - Remove the redundant frontend `invoke('pet_set_cursor')` from `PetApp` once the tracking area works (verify in-app).
3. Esc closes the panel immediately on show (no click needed).
   - **Make the webview first responder on show**: after `set_focus()` in `pet_panel_show`, call `makeFirstResponder(webview)` (Rust, main thread) so `document` receives `keydown` → Esc works without a click.
   - **Autofocus the chat input on show**: on the `pet://panel-fade-in` (show) signal, focus the chat `<textarea>` so the user can type immediately (panel defaults to Chat tab — chat-first). Respect the Actions tab (don't force-focus input when the user is on Actions).
4. No regression to the just-fixed "panel blanks on file-upload" behavior (the `isVisible()` blur guard in `PetPanelApp.tsx`).

## Acceptance Criteria (evolving)

- [ ] Opening the panel (pet-click path AND global-shortcut path) shows no mid-open position/size jump — the fade-in starts from the final frame.
- [ ] First hover over the pet mascot (with Folyn NOT frontmost) shows the hand cursor; moving the cursor away restores the default cursor — no click required.
- [ ] After opening the panel via pet click, pressing Esc immediately hides it (no click on the panel first).
- [ ] On open with the Chat tab active, the chat input is focused and the user can type immediately; on the Actions tab, input is not force-focused.
- [ ] File upload (attach button) still does NOT blank the panel (regression of the prior `isVisible()` fix).
- [ ] Re-opening the panel repeatedly (hide→show cycle) still fades in each time (fade trigger re-arms).
- [ ] `cargo check` + frontend typecheck + existing pet/pet-panel tests green; new tests for the fade-trigger (PetPanelApp) and (if feasible) the textarea-focus-on-show.
- [ ] Manual in-app verification of all three issues (the Rust NSPanel behavior can't be unit-tested in jsdom).

## Definition of Done

- Rust changes compile (`cargo check`) + frontend typechecks + tests green.
- Manual verification in the running app (pet click open, hover cursor, Esc close, file-upload no-blank).
- Comments updated where behavior changes (the existing comments in commands.rs / pet_panel_macos.rs / PetPanelApp.tsx are detailed — keep them honest).
- No new dependencies.

## Out of Scope (explicit)

- "Restore previous frontmost app after panel hide" (already noted out-of-scope in commands.rs:876-877).
- Full rework of the NSPanel backend / legacy backend parity.
- Changing the pet mascot's other animations (breathe/hover/drag state keyframes).
- Cross-platform (Windows/Linux) cursor/keyboard handling — macOS NSPanel only.

## Technical Notes

- Files likely touched: `apps/desktop/src-tauri/src/commands.rs` (`pet_panel_show`, `pet_set_cursor`, maybe a new tracking-area setup), `apps/desktop/src-tauri/src/pet_panel_macos.rs` (panel setup), `apps/desktop/src/components/pet/PetApp.tsx` (`applyPanelFrame` fade-trigger emit), `apps/desktop/src/components/pet/PetPanelApp.tsx` (fade-trigger listener + Esc), `apps/desktop/src/components/pet/pet.css` (fade CSS).
- `pet_panel_show` is currently called only from `applyPanelFrame` (need to confirm no other callers before relying on that for the emit-after-reassert approach).
- Existing `core:window:allow-set-focus` + `core:event:allow-emit`/`allow-listen` are granted in `capabilities/pet-panel.json`; the pet window (`PetApp`) needs `core:event:allow-emit` to broadcast a fade-in event — verify `capabilities/pet.json`.
- Rust unsafe objc precedent: `pet_set_cursor`, `pet_show_context_menu`, `pet_make_transparent` already use `cocoa`/`objc` — match that style.

## Research References

- [`research/nstrackingarea-cursor-hover.md`](research/nstrackingarea-cursor-hover.md) — `tauri-nspanel` crate (already a dep) ships native `tracking_area` + `cursorUpdate`; `ActiveAlways` is the no-click-hover flag; no raw objc needed.
- [`research/makefirstresponder-keyboard.md`](research/makefirstresponder-keyboard.md) — `set_focus` makes the window key but not the WKWebView first responder; `makeFirstResponder(wkwebview)` after `set_focus` is the deterministic Esc fix; frontend textarea focus handles typing.

## Technical Approach

### Issue 1 — smooth open (frontend + CSS, no Rust)
- **Decouple the fade trigger from `tauri://focus`**: `applyPanelFrame` (PetApp.tsx) emits a `pet://panel-fade-in` event AFTER the post-show `set_pos/size` re-assert (the last step). `PetPanelApp` listens and calls `setVisible(true)` then — so the fade starts from the stable final frame, not mid-re-assert. The existing `onFocusChanged` keeps only the blur→hide-reset path (with the `isVisible()` guard from the prior fix); it no longer drives the show fade.
- **CSS softer entrance** (pet.css): `opacity 0→1` ~180ms ease-out + subtle `scale(0.98→1)` with `transform-origin: center` (drop the `0.96` scale + `top-left` origin that amplified the mid-fade shift).
- **Verify** `pet_panel_show` is only called from `applyPanelFrame` (both pet-click + shortcut paths route through it) before relying on the emit; if there's another caller, have it emit too (or move the emit into `pet_panel_show` Rust-side).

### Issue 2 — hover cursor without click (Rust, crate-native)
- Add `with: { tracking_area: { options: TrackingAreaOptions::new().active_always().cursor_update().mouse_entered_and_exited().in_visible_rect(), auto_resize: true } }` to the `FolynPetPanel` `panel!` macro in `pet_panel_macos.rs`.
- Define a `panel_event!` handler; wire `on_cursor_update` → `[NSCursor pointingHandCursor] set]` and `on_mouse_exited` → `[NSCursor arrowCursor] set]` (reuse the `pet_set_cursor` NSCursor logic). Attach in `convert_windows`.
- Once verified in-app, remove the now-redundant `invoke('pet_set_cursor')` calls from `PetApp.handleMouseEnter/Leave` (keep the command as a fallback or remove if unused).

### Issue 3 — Esc + typing without click (Rust + frontend)
- **Rust** (`pet_panel_show`): after `panel.set_focus()`, make the **WKWebView** first responder on the main thread — `makeFirstResponder(wkwebview)` (reuse the `pet_make_transparent` ns_view accessor; target the WKWebView, NOT the contentView). Deterministic Esc fix.
- **Frontend** (`PetPanelApp`): on `pet://panel-fade-in`, if `tab === 'chat'`, focus the chat `<textarea>` (PetChat exposes a focus contract — ref + imperative `focus()`, or PetChat listens for the same event). Gives immediate typing; also reinforces webview first-responder.
- Verify both: Esc fires without a click AND typing works immediately on open.

## Decision (ADR-lite)

**Context**: Three pet-panel UX regressions all rooted in the `nonactivating_panel` NSPanel backend not behaving like a normal key/activating window. The code comments already pointed at the fix directions (NSTrackingArea ActiveAlways; set_focus not enough for keyboard).

**Decision**:
- Issue 1: decouple the fade-in trigger from focus (emit after frame re-assert) + softer CSS entrance. Avoids touching Rust for the flicker.
- Issue 2: use the `tauri-nspanel` crate's built-in `tracking_area` + `cursorUpdate` (no raw objc) — reuse the dependency rather than hand-rolling NSTrackingArea.
- Issue 3: Rust `makeFirstResponder(wkwebview)` for deterministic Esc + frontend textarea focus for typing. Do both (both small); the Rust call is the sure fix for the reported Esc symptom, the textarea focus is the typing UX the user asked for.

**Consequences**:
- Issue 2 ties us to the `tauri-nspanel` crate's `tracking_area` API (acceptable — it's already a dep and this is its documented feature).
- Issue 3's frontend focus needs a focus contract between `PetPanelApp` and `PetChat` (small coupling; PetChat already owns the input).
- If `pet_panel_show` has callers beyond `applyPanelFrame`, the fade-emit must cover them (verify first).
- The prior `isVisible()` blur-guard fix (file-upload blank) stays; the fade-trigger refactor must not regress it.
