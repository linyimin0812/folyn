# Command Palette: Remove Backdrop Frame and Open Flicker

## Background

The Cmd+P command palette is rendered in-app as a React overlay that reuses the shared `.dlg-overlay` / `.dlg` CSS (defined in `apps/desktop/src/index.css`). Those shared styles were designed for full-screen modal dialogs: a dimmed+blurred full-screen backdrop (`rgba(0,0,0,.45)` + `backdrop-filter: blur(4px)`) and a heavy drop-shadow on the panel (`box-shadow: 0 20px 60px rgba(0,0,0,.3)`), plus mount animations (`fadeIn .15s` on the overlay, `slideUp .2s` on the panel).

For a quick-launch palette these have two costs the user flagged:

1. The dark + blurred backdrop and the heavy shadow make the palette look like a separate native Tauri window popped over a system modal — the "系统背景框" effect.
2. The `fadeIn` + `slideUp` mount animations produce a visible flicker at the moment of opening, while the list rows are rendering ("打开瞬间列表加载闪动").

## Requirements

- **R1 — No system-modal backdrop.** The palette must float over the app without dimming or blurring the underlying UI. Click-outside-to-close still works (already wired to `onMouseDown={close}` on the overlay).
- **R2 — No native-window frame look.** Drop the heavy drop-shadow on the panel so it reads as a floating palette, not a separate OS window. Keep the subtle border + radius so the panel still has visual separation from content behind.
- **R3 — No open-animation flicker.** The palette must appear instantly when `isOpen` flips true — no `fadeIn` on the overlay, no `slideUp` on the panel. Existing row hover/selection transitions (`transition-[background] duration-100` on `PaletteRow`) are unrelated and stay.
- **R4 — Localized.** Override only at the `CommandPalette` component level via inline styles. Do not touch the shared `.dlg-overlay` / `.dlg` rules — other dialogs depend on them.

## Out of scope

- Changes to scroll-into-view behavior, fuzzy match, keyboard nav, or store logic.
- Any change to other `.dlg` consumers.
- Backdrop-click affordance change (still works via `onMouseDown`).

## Implementation notes

Target file: `apps/desktop/src/components/shell/CommandPalette.tsx`.

Inline-style override on the overlay `<div>`:
- `background: 'transparent'`
- `backdropFilter: 'none'`
- `animation: 'none'`

Inline-style override on the panel `<div>` (currently `style={{ width: 560, maxHeight: '70vh' }}`):
- merge `boxShadow: 'none'`
- merge `animation: 'none'`

Border + `var(--panel)` background on `.dlg` stay as-is for readability.

## Verification

- Open the app, press Cmd+P → palette appears with no full-screen dim, no blur, no slide animation, no heavy shadow.
- Click outside → palette closes (unchanged behavior).
- Type a query → list filters as before, no animation replay.
- Run a command via Enter / click → executes as before.
