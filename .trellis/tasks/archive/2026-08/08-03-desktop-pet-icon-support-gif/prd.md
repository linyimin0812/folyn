# desktop-pet-icon-support-gif

## Goal

Allow users to set an animated GIF as the desktop pet mascot icon. Currently the upload picker only accepts `png/jpg/jpeg/webp/svg`; GIF is rejected at the extension gate even though the render path (`<img src={convertFileSrc(petIconPath)}>` in `PetMascot.tsx`) already animates GIFs natively in the Tauri webview.

## What I already know

- `PetMascot.tsx:62-78` renders custom icons via plain `<img>` — GIF animation is native, no renderer change needed.
- `PetSettings.tsx:64` `VALID_EXTS = ['png','jpg','jpeg','webp','svg']` is the sole gatekeeper; the dialog `filters` and the post-pick defensive check both reference it.
- `MAX_ICON_BYTES = 10MB` already covers reasonable GIF sizes; no size-policy change needed.
- `addPetIcon` stores the full path with `.gif` extension; `setPetIcon('custom', path)` flow already works for any extension.
- Cross-window broadcast (`pet://icon-changed`) is icon-agnostic — no change needed.

## Requirements

- Add `gif` to `VALID_EXTS` in `PetSettings.tsx`.
- Update the inline comment on the same line to mention `gif`.

## Acceptance Criteria

- [ ] In the settings icon picker, a user can select a `.gif` file and it is saved to `~/.folyn/pet-icon/pet-icon-<ts>.gif`.
- [ ] The pet window mascot renders the GIF and the animation plays.
- [ ] A `.gif` larger than 10MB is rejected with the existing `fileTooLarge` error.
- [ ] Builtin SVG path and existing png/jpg/webp/svg paths still render unchanged.

## Definition of Done

- Lint / typecheck / existing tests green.
- Manual check in Tauri: upload a GIF, confirm animation plays in the pet window.

## Technical Approach

One-line change: extend `VALID_EXTS` to include `'gif'`. No new dependencies, no renderer change, no store change, no new tests (existing upload test coverage is extension-agnostic; the gate now admits one more extension).

## Out of Scope

- Animated PNG (APNG), WebP animation — already in the list; WebP already animates, APNG support is implicit in `<img>` and not the user's ask.
- Per-frame control (pause/play, speed) — out of scope; the native `<img>` behavior is the desired UX.
- GIF frame extraction for static fallbacks — YAGNI.

## Technical Notes

- File: `apps/desktop/src/components/settings/PetSettings.tsx:64`.
- Render path verified: `apps/desktop/src/components/pet/PetMascot.tsx:62-78`.
