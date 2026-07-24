# notification cloudia template

## Goal

Add a new built-in bubble template `cloudia` that matches `/Users/yiminlin/Downloads/gemini-code-1784827539733.html` 1:1 — Cloudia mascot SVG, cream card, soft-blue title, peach/orange gradient button. Bubble window must dynamically size per-template (no fixed 320×120), so the Cloudia card can render at its natural 540×~280.

## Requirements

- New `BUILT_IN_TEMPLATES` entry `cloudia` with inlined mascot SVG (CSP forbids remote resources).
- `BubbleTemplate` interface gains optional `size?: {width:number; height:number}` (logical px). Missing → `{320, 120}` default (preserves existing templates).
- New Rust command `pet_bubble_set_size(width, height)` (physical px) mirrors `pet_panel_set_size`. Registered in `lib.rs` invoke handler. No capability file change needed (custom commands bypass ACL).
- `computeBubblePosition` takes an optional `bubbleSize` arg (defaults to `{PET_BUBBLE_WIDTH, PET_BUBBLE_HEIGHT}`) so the flip-above/below math tracks the actual card.
- `PetBubbleApp.tsx` resolves the active template's `size` (logical), invokes `pet_bubble_set_size` (physical), then calls `computeBubblePosition` with the actual size, then `pet_bubble_set_position` + `pet_bubble_show`.
- Cloudia template composes with existing payload: `{{title}}`, `{{text}}`, `{{#actions}}<button data-action="{{id}}">{{label}}</button>{{/actions}}`. Button `data-action="navigate"` or action id so click routing still works.

## Acceptance Criteria

- [ ] `cloudia` in `BUILT_IN_TEMPLATES` — mascot SVG + cream card + gradient button render from a sample payload.
- [ ] `bubbleTemplate.test.ts` smoke test passes for `cloudia` (auto-iterated).
- [ ] `pet_bubble_set_size` Rust command exists and is registered in `lib.rs`.
- [ ] `computeBubblePosition` respects `bubbleSize` arg; existing tests pass unchanged.
- [ ] `petPosition.test.ts` adds one test asserting a larger bubble clamps correctly with `bubbleSize`.
- [ ] When `cloudia` is active, the bubble window physically measures ~540×280 (verified by reading Tauri `outer_size` — or a manual visual check is acceptable for now).

## Definition of Done

- `pnpm typecheck` green.
- `pnpm test` green (existing + new assertions).
- Manual visual check: trigger a `pet://bubble-show` with `template: 'cloudia'` → card renders 1:1 vs the reference HTML (colors, mascot, gradient button).

## Out of Scope (explicit)

- Persisting per-template size across sessions (template declares its size — no storage).
- User-customizable Cloudia colors.
- Per-template aspect-ratio reflow for very small screens (work-area clamp still applies).
- Adding Quicksand webfont (CSP blocks remote; fall back to system sans-serif which is close enough).

## Technical Approach

**Files to touch:**
1. `apps/desktop/src-tauri/src/commands/pet_bubble.rs` — add `pet_bubble_set_size`.
2. `apps/desktop/src-tauri/src/lib.rs` — register the new command.
3. `apps/desktop/src/components/pet/bubbleTemplate.ts` — `BubbleTemplate.size?` field; new `cloudia` template entry.
4. `apps/desktop/src/components/pet/petPosition.ts` — `computeBubblePosition` optional `bubbleSize` arg.
5. `apps/desktop/src/components/pet/PetBubbleApp.tsx` — call `pet_bubble_set_size` before show; pass size to `computeBubblePosition`.
6. `apps/desktop/src/components/pet/petPosition.test.ts` — one new assertion for size-aware clamp.

**Cloudia HTML skeleton** (inlined mascot SVG, cream card, gradient button):
- Mascot SVG copied verbatim from the reference HTML.
- `<button data-action="navigate">` carries the gradient + glow.
- `{{#title}}` header, `{{text}}` body, `{{#actions}}` button row.

## Decision (ADR-lite)

**Context**: Bubble window was hardcoded 320×120; Cloudia reference is 540×~280. Other templates (default/glass/dark/minimal/colorful) are tuned for 320×120.
**Decision**: Make size per-template via optional `BubbleTemplate.size`. Default (no size) preserves 320×120 so existing templates are untouched. Add `pet_bubble_set_size` Rust command mirroring `pet_panel_set_size`.
**Consequences**: One new Tauri command + a few-line hook in `PetBubbleApp`. `computeBubblePosition` gains one optional param. Existing tests pass unchanged (default size). Future templates can declare their own size without code changes.

## Technical Notes

- `bubbleTemplate.ts:125` — `BUILT_IN_TEMPLATES` array.
- `PetBubbleApp.tsx:134` — `positionAndShowBubble` is where size+position+show chain runs.
- `pet_bubble.rs:35` — existing `pet_bubble_set_position` to mirror.
- `pet_panel.rs:216` — reference for `set_size` command shape.
- `tauri.conf.json` `pet-bubble` window — `resizable: false` blocks user drag, but programmatic `set_size` still works.
- CSP: `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:` — mascot must be inline SVG (no `<img src=...>`), no webfonts.
