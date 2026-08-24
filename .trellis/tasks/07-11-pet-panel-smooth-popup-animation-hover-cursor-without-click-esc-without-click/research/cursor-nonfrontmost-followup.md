# Research: cursor-nonfrontmost-followup — why the crate's `tracking_area` (ActiveAlways + cursorUpdate) did NOT fix the hand cursor pre-click

- **Query**: The chunk-2 hover-cursor fix (crate `tracking_area` ActiveAlways on the `pet` window) did not work. Why? What is the correct fix?
- **Scope**: mixed (crate source + Apple docs knowledge)
- **Date**: 2026-07-11
- **Crate version pinned**: `tauri-nspanel` git branch `v2.1`, checkout hash `a3122e8` at `~/.cargo/git/checkouts/tauri-nspanel-cab3955568b3504c/a3122e8/`

## TL;DR (the bug + the fix)

**Root cause (source-confirmed):** The crate's `add_tracking_area` sets the
`NSTrackingArea` **owner = the panel's `contentView`** (a stock `NSView`),
but the `cursorUpdate:` override that forwards to the delegate lives on the
**panel subclass itself** (`NSPanel`, a window) — a *different object*. A
stock `NSView` does not override `cursorUpdate:`, and `cursorUpdate:` is
dispatched **directly to the TA owner**, not propagated up the responder chain
to the window. So `cursorUpdate:` is delivered to the `contentView`, the
`contentView`'s default impl swallows it (does nothing, does not forward), and
the panel's `__cursor_update` override — the one that forwards to the delegate
and fires `on_cursor_update` — **never runs**. The `on_cursor_update` /
`on_mouse_exited` callbacks the codebase wired in `pet_panel_macos.rs` never
fire. That is why the hand cursor never appears pre-click.

The prior research file (`nstrackingarea-cursor-hover.md`) claimed
`cursorUpdate:` on the contentView "propagates up the responder chain to the
panel subclass's override → delegate → callback. The WKWebView does not
intercept it." **That claim is wrong.** `cursorUpdate:` is direct-dispatched
to the TA owner; the stock-`NSView` owner does not forward it.

**Recommended fix (smallest diff):** Add the `NSTrackingArea` **manually** with
`owner = the panel` (`RawMochiPetPanel`, which already overrides
`cursorUpdate:` and forwards to the delegate), attached to the `contentView`
(or the WKWebView). Drop the crate's `with: { tracking_area }` block (it
hardcodes `owner: contentView`, panel.rs:676, which we cannot parameterize
without forking). This reuses the *existing* `__cursor_update` → delegate →
`on_cursor_update` wiring and the existing handler closure — only the TA
*attachment* changes. ~15 lines in `convert_windows`.

**Diagnostic to confirm before implementing (Q4):** add one `println!` (or
`os_log`) inside the `on_cursor_update` closure in `pet_panel_macos.rs`. If it
never prints while another app is frontmost → confirms "TA owner mismatch /
handler never fires" (root cause above). If it prints but the cursor stays
arrow → "set not sticking / cursor fight" (different fix needed). This is a
valid 1-line diagnostic and should be run FIRST to pick the right fix.

---

## Q1: Who owns the tracking area, and does that owner receive `cursorUpdate:`?

### Q1a — The `owner:` argument

Source: `tauri-nspanel/src/panel.rs:659-692` (`add_tracking_area`, the helper
the `with: { tracking_area }` macro block calls via `panel.rs:606-608`):

```rust
// panel.rs:661-662
let content_view: ...NSView = msg_send![panel, contentView];
// panel.rs:663-664
let bounds: NSRect = msg_send![&content_view, bounds];
// panel.rs:672-678
let area = msg_send![alloc,
    initWithRect: bounds,
    options: options.into(),
    owner: &*content_view,          // <-- OWNER = contentView (stock NSView)
    userInfo: nil];
// panel.rs:690
let _: () = msg_send![&content_view, addTrackingArea: &*tracking_area];
```

**The owner is the panel's `contentView`** — a stock `NSView`, NOT the panel
subclass and NOT a custom view. The crate does not swap the contentView's
class; `object_setClass` (panel.rs:580-586) is applied to the *window*
(`ns_window`), turning it into `Raw{ClassName}` (super = `NSPanel`), and the
contentView remains whatever `NSView` Tauri allocated. The WKWebView is a
*subview* of this contentView (panel.rs:611-624 iterates the contentView's
`subviews` to set autoresize masks, proving subviews already exist at
`to_panel()` time).

### Q1b — Where is `cursorUpdate:` overridden, and does the owner forward it?

`cursorUpdate:` is overridden on the **panel subclass** (`Raw{ClassName}`,
`unsafe(super = NSPanel)`), NOT on any contentView class:

```rust
// panel.rs:113-114
define_class!(
    #[unsafe(super = objc2_app_kit::NSPanel)]
    #[name = stringify!($class_name)]
    ...
// panel.rs:186-200
#[unsafe(method(cursorUpdate:))]
fn __cursor_update(&self, event: &NSEvent) {
    let delegate: Option<...NSWindowDelegate> = msg_send![self, delegate];
    if let Some(ref d) = delegate {
        let responds: bool = msg_send![&**d, respondsToSelector: sel!(cursorUpdate:)];
        if responds { let _: () = msg_send![&**d, cursorUpdate: event]; }
    }
}
```

`mouseEntered:` / `mouseExited:` / `mouseMoved:` are overridden on the same
panel class (panel.rs:138-184), all forwarding to the window delegate.

The delegate class generated by `panel_event!` (event.rs:111-182) implements
`cursorUpdate:` (event.rs:174-181) and `mouseEntered:`/`mouseExited:`/
`mouseMoved:` (event.rs:147-172), routing each to a `Box<dyn Fn>` cell.
`on_cursor_update` (event.rs:248-253) sets that cell.

### Q1c — Does the owner (contentView) receive and forward `cursorUpdate:`?

**No.** `cursorUpdate:` for an `NSTrackingArea` is dispatched by `NSWindow`
**directly to the TA owner** (the object passed as `owner:`), not to the
hit-tested topmost view and not through the normal mouse responder chain. The
owner here is a stock `NSView`. A stock `NSView` does **not** override
`cursorUpdate:`; `NSResponder`'s default `cursorUpdate:` "does nothing" (Apple,
`NSResponder cursorUpdate:`) — it does **not** call `nextResponder` to forward
the event up to the window.

Contrast with `mouseEntered:`/`mouseMoved:`: those are also dispatched to the
TA owner, but NSView's default implementations of the mouse-tracking methods
do forward to `nextResponder`, so they can reach the panel override. This is
why, even in the current broken state, you may still see `on_mouse_exited` /
`on_mouse_moved` activity while the cursor is over the panel — but
`on_cursor_update` stays silent.

**This IS the bug.** The override (panel.rs:186) and the owner
(panel.rs:676) are on different objects, and `cursorUpdate:` does not bridge
them. The handler closure (`handler.on_cursor_update(|_e| {
pointingHandCursor().set(); })` in `pet_panel_macos.rs`) never fires.

Evidence the crate's own design is internally inconsistent here: the
`__cursor_update` override forwards to the delegate *as if* `cursorUpdate:`
arrives at the panel, but `add_tracking_area` sets the owner to the
contentView. The flagship `examples/mouse_tracking` example only does
`println!` inside `on_cursor_update` — it never sets a cursor or asserts the
callback actually fires on a non-key window, so the bug ships unobserved.

> Note on confidence: the "TA owner receives `cursorUpdate:` directly, default
> does not forward" point is established AppKit behavior (Apple
> `NSResponder cursorUpdate:` + `NSTrackingArea` "sent to the owner"). The
> exact wording of the default's forwarding was not re-verified against live
> Apple docs in this session (no web tool available); the Q4 println!
> diagnostic below distinguishes this hypothesis from the alternatives
> definitively at runtime.

---

## Q2: Does the WKWebView covering the contentView prevent the TA from firing?

The pet window is a transparent `NSPanel` whose content is a `WKWebView`
(Tauri webview) filling the contentView. When the cursor is over the visible
pet, it is over the `WKWebView` subview, not the contentView directly.

- **`NSTrackingArea` cursor delivery is owner/rect-based, not hit-test-based.**
  Per Apple `NSTrackingArea`: a tracking area with `NSTrackingCursorUpdate`
  generates cursor-update events when the cursor enters/moves within the
  tracking *rect* (in the owner's coordinate system), and the
  `cursorUpdate:` message is sent to the **owner**, regardless of overlapping
  subviews. So the contentView's TA *would* fire `cursorUpdate:` even with the
  WKWebView on top — *if* the owner could receive it. The problem is not that
  the TA fails to fire; it is that the owner it fires *on* (stock contentView)
  does not override/forward `cursorUpdate:` (see Q1).
- **WKWebView cursor fight (real, but only post-click):** `WKWebView` (system
  class) manages its own cursor via `resetCursorRects` / the CSS `cursor:`
  property. When the panel is **key**, AppKit runs cursor rects for the
  webview, which can reset `[NSCursor set]` called from our handler on the
  next mouseMoved. But this only matters once the panel is key — i.e. *after*
  the click. Pre-click (the broken state) the panel is not key, AppKit does
  NOT run the webview's cursor rects, so there is no cursor fight. The
  pre-click failure is therefore *not* a cursor fight; it is the Q1
  owner-mismatch.

Conclusion for Q2: the WKWebView covering the contentView is **not** what
blocks the TA; the owner-mismatch (Q1) is.

---

## Q3: Correct approach to show a hand cursor over a WKWebView-in-a-nonactivating-NSPanel when NOT frontmost

### Q3a — Is the old "frontmost app owns the cursor" comment actually true?

`commands.rs` `pet_set_cursor` comment (~lines 656-661):

> "May not stick when the cursor is over another app's window (the frontmost
> app owns the cursor); reliable fix needs an `NSTrackingArea` with
> `NSTrackingActiveAlways` on the panel's content view, deferred until this
> proves insufficient."

This is a **misconception** for the `cursorUpdate:` + `ActiveAlways`
mechanism. The frontmost app owns the cursor only while the cursor is over
*that app's* window. When the cursor is over *our* panel's tracking area,
`ActiveAlways` delivers the `cursorUpdate:` event to us regardless of
activation state, and our handler's `[NSCursor set]` sticks — this is exactly
how menu-bar extras and floating tooltip windows change the cursor when not
frontmost. The old comment conflates two things: (1) calling `[NSCursor set]`
from a JS-invoke at arbitrary timing (the `pet_set_cursor` path — unreliable,
because the call is not synced to cursor-enter and the panel may not even
receive mouseMoved pre-key) vs. (2) `cursorUpdate:` from an `ActiveAlways` TA
(the sanctioned, timing-correct path). The comment's instinct ("needs an
NSTrackingArea with ActiveAlways") was right; the implementation just wired
the TA owner to the wrong object.

### Q3b — Candidate fixes, evaluated for THIS architecture

Architecture recap: Tauri `WKWebView` inside a nonactivating `NSPanel`,
`can_become_main_window: false`. Existing accessors: `with_webview` closure
gives `webview.inner()` (= `WKWebView` pointer) and `webview.ns_window()` (=
`NSWindow` / our `RawMochiPetPanel`); see `pet_make_transparent`
(`commands.rs:1244-1290`) and `pet_panel_show` `makeFirstResponder`
(`commands.rs:908-915`). `pet_show_context_menu` (`commands.rs:~665`) already
does raw objc on the pet ns_view — precedent for manual objc here.

| Option | Feasibility | Notes |
|---|---|---|
| **(a) TA with `owner: WKWebView`** | Low | `WKWebView` is a system class; it has its own cursor management and is unlikely to forward `cursorUpdate:` to our delegate. We cannot add our override onto a system class without swizzling. Reject. |
| **(b) Transparent overlay `NSView` on top of WKWebView** | Works, larger diff | Known-robust pattern (menu-bar-extra style). Custom `objc2` `NSView` subclass overriding `cursorUpdate:` → hand, owning an `ActiveAlways` TA, placed above the webview with the same frame. Needs `setHitTests:NO` so clicks fall through to the webview (pet drag, context menu). Caveat: must verify TA still fires with `hitTests=NO` (TA is owner/rect-based, so it should). This is the fallback if (d) proves insufficient at runtime. |
| **(c) CSS `cursor: pointer`** | Fails pre-click | macOS honors webview CSS cursor only when the window is **key** (AppKit cursor rects run per key window). Pre-click (panel not key) → no effect. This is exactly the state we are fixing. Reject as the primary fix (already what `commands.rs:656-657` observed). |
| **(d) TA with `owner: panel`, added manually** | **RECOMMENDED, smallest diff** | The panel (`RawMochiPetPanel`) ALREADY overrides `cursorUpdate:` (panel.rs:186) and forwards to the delegate. Making the TA `owner = &*panel` guarantees `cursorUpdate:` lands on the object with the override — no forwarding needed. Reuses the existing `on_cursor_update` / `on_mouse_exited` wiring unchanged. The crate's `add_tracking_area` hardcodes `owner: contentView` (panel.rs:676) and cannot be parameterized without forking, so drop the `with: { tracking_area }` block and add the TA by hand in `convert_windows`. |
| **(e) Crate-native `with:` option targeting the webview** | None exists | The crate only has the single `with: { tracking_area }` block, hardcoded to the contentView (panel.rs:659-692). No webview-targeted option. |

### Q3c — Recommendation

**Option (d): a manually-added `NSTrackingArea` with `owner = RawMochiPetPanel`
(the panel), attached to the contentView.**

Why it is the right pick on the ladder:
- It is the **root-cause fix**: the bug is "owner has no override"; this makes
  the owner the object that *has* the override. Not a symptom patch.
- It **reuses** the existing `__cursor_update` override (panel.rs:186-200), the
  existing delegate `cursor_update` (event.rs:174-181), and the existing
  `on_cursor_update` / `on_mouse_exited` closures already wired in
  `pet_panel_macos.rs`. No new objc class, no new delegate method.
- Smallest diff: remove the `with: { tracking_area }` block from the
  `panel!(MochiPetPanel { ... })` macro, and in `convert_windows` (after
  `to_panel` and before/after `set_event_handler`) add ~15 lines of raw objc
  (same `objc` 0.2 crate idiom already used by `pet_make_transparent` /
  `pet_show_context_menu`) to: get `contentView`, build the `NSTrackingArea`
  with `owner: &*panel` (`panel.as_panel()` cast to the Raw class) and the same
  options (`ActiveAlways | CursorUpdate | MouseEnteredAndExited |
  InVisibleRect`), `addTrackingArea:` to contentView.
- The `owner` and the `addTrackingArea:` target need not be the same object —
  `initWithRect:options:owner:userInfo:` lets the owner be any object; the TA
  is attached to the view whose coordinate system the rect is in.

Fallback if (d) is insufficient at runtime (Q4 diagnostic shows handler fires
but cursor doesn't stick): escalate to **option (b)** overlay view. But start
with (d) + the 1-line diagnostic; (b) is ~40 lines and a new class, so it is
not the first rung.

---

## Q4: Diagnostic

Adding an `os_log`/`println!` as the first line inside the `on_cursor_update`
closure in `pet_panel_macos.rs`:

```rust
handler.on_cursor_update(|_event| {
    println!("[pet-cursor] cursorUpdate fired");  // <-- diagnostic
    let cursor = NSCursor::pointingHandCursor();
    cursor.set();
});
```

is a **valid, decisive 1-line diagnostic**. It cleanly distinguishes the two
failure modes:

- **Never prints while another app is frontmost + cursor over pet** → the TA
  is not delivering `cursorUpdate:` to an object that reaches our handler →
  confirms the Q1 owner-mismatch root cause → apply fix (d).
- **Prints but cursor stays arrow** → the handler fires (delivery is fine)
  but `[NSCursor set]` is reset by the webview's cursor rects / a cursor fight
  → fix (d) alone is insufficient → escalate to fix (b) overlay view.

Run this BEFORE implementing the fix (and again after, to confirm the fix
makes it print AND the cursor change stick). No test framework or fixture
needed.

---

## Files / source evidence

| Path | Description |
|---|---|
| `~/.cargo/git/checkouts/tauri-nspanel-cab3955568b3504c/a3122e8/src/panel.rs:113-202` | `define_class!` for the panel subclass (super=`NSPanel`); `cursorUpdate:`/`mouseEntered:`/`mouseExited:`/`mouseMoved:` overrides forwarding to the delegate |
| `.../src/panel.rs:559-628` | `from_window` — `object_setClass` onto the window (NOT contentView); calls `add_tracking_area` at 606-608 |
| `.../src/panel.rs:659-692` | `add_tracking_area` — `owner: &*content_view` (676), `addTrackingArea:` on contentView (690) |
| `.../src/event.rs:111-182` | delegate class; `cursorUpdate:` override (174-181), `mouseEntered:`/`mouseExited:`/`mouseMoved:` (147-172) |
| `.../src/event.rs:248-253` | `on_cursor_update` callback setter |
| `.../src/builder.rs:265-302` | `TrackingAreaOptions`: `active_always`, `cursor_update`, `mouse_entered_and_exited`, `in_visible_rect` |
| `.../examples/mouse_tracking/src-tauri/src/main.rs` | crate's flagship example — only `println!` in `on_cursor_update`, never sets a cursor / asserts non-key delivery, so the bug ships unobserved |
| `apps/desktop/src-tauri/Cargo.toml` | pins `tauri-nspanel = { git = ..., branch = "v2.1" }` |
| `apps/desktop/src-tauri/src/pet_panel_macos.rs` | the `panel!(MochiPetPanel { ... with: tracking_area ... })` config + the `on_cursor_update`/`on_mouse_exited` handler wiring in `convert_windows` |
| `apps/desktop/src-tauri/src/commands.rs:~644-662` | `pet_set_cursor` command + the "may not stick" comment (misconception, see Q3a) |
| `apps/desktop/src-tauri/src/commands.rs:908-915` | `pet_panel_show` `with_webview` + `makeFirstResponder: wk` — precedent for the `webview.inner()` / `ns_window()` raw-objc accessor pattern |
| `apps/desktop/src-tauri/src/commands.rs:1244-1290` | `pet_make_transparent` `with_webview` raw objc on the WKWebView — precedent for manual objc in this file |
| `apps/desktop/src/components/pet/PetApp.tsx:274-277` | frontend `pet_set_cursor` invoke calls already removed (kept only as a fallback) — cursor now solely managed by the TA handler |

## Caveats / Not Found

- The exact wording of `NSResponder cursorUpdate:`'s default-forwarding
  behavior was not re-verified against live Apple documentation in this
  session (no web-search tool was available to the agent). The conclusion
  rests on established AppKit behavior ("`cursorUpdate:` is dispatched to the
  TA owner; the default does nothing / does not forward to nextResponder").
  The Q4 `println!` diagnostic is the runtime arbiter — run it first; if it
  prints (handler fires) but the cursor does not change, the root cause is a
  cursor fight, not the owner mismatch, and fix (b) overlay view applies
  instead of (d).
- Whether a view with `setHitTests:NO` still receives `cursorUpdate:` from its
  own `ActiveAlways` TA (relevant only to fallback fix (b)) was not verified
  against docs; needs a runtime check if (b) is pursued.
