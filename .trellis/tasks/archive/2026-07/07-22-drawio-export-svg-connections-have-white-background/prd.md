# drawio export svg connections have white background

## Goal

Fix drawio export SVG so node text renders inside boxes and connections
don't have a white background. Currently the exported SVG (via the drawio
iframe's `xmlsvg` export action) shows text positioned/clipped wrong AND
white boxes that don't match the in-app preview.

## What I already know

- DrawioPreview renders an iframe via `react-drawio` with
  `urlParameters: { dark: theme === 'dark', chrome: true }`.
- Export (`services/export/drawio.ts`) sends
  `{ action: 'export', format: 'xmlsvg', spinKey: 'export' }` to the
  iframe and decodes the returned data-URI SVG.
- No background / fill options are passed to the export action.
- Screenshot OCR shows fragmented text (打开/页面/点击/按钮/重新输入/发送/
  请求/查询用/否存在) — text IS in the SVG but positioned/clipped wrong.
- The mmap enhancer already fixes a similar foreignObject-in-standalone-SVG
  issue by injecting `<style>foreignObject div, ... { ... !important }</style>`
  after `<svg>` opening tag. Same pattern likely applies to drawio.

## Root cause (hypothesis)

drawio's `xmlsvg` export wraps node text in `<foreignObject><div>` with
inline HTML. When the SVG is injected via `innerHTML` into the file-preview
body, the foreignObject divs inherit Quill's Tailwind reset + other CSS,
breaking their layout. The white boxes are drawio's default edge label
`<rect fill="#ffffff">` (so text is readable over edges) plus possibly a
page background rect.

## Requirements

- Exported drawio SVG renders node text inside boxes (not clipped /
  mispositioned).
- No white background on connections (edge labels transparent or stripped).
- Match mmap enhancer's pattern (inject scoped `<style>` after `<svg>`
  opening) for consistency.

## Acceptance Criteria

- [ ] Screenshot of exported drawio matches the in-app iframe preview
  (text inside boxes, no white boxes on connections).
- [ ] `tsc -b` clean.

## Definition of Done

- Manual export round-trip verified with a real .drawio file.
- ponytail: comment explains why the style injection is needed (mirror
  mmap's comment).

## Technical Approach

Two-part fix in `services/export/drawio.ts` `enhance()`:

### Root cause (from actual export SVG)

1. **Tiny text**: drawio SVG has `viewBox="0 0 452 1432"` (full diagram,
   1432 units tall). Current code forces `svgEl.setAttribute('height',
   '100%')` + body `height: 420px; overflow: hidden`. With
   `preserveAspectRatio: xMidYMid meet`, content scales to fit 420px
   height — scale factor ~0.29, 14px text becomes ~4px, invisible.
   The in-app iframe preview works because it renders at natural size
   with scroll.
2. **White edge-label bg**: every edge label div has inline
   `background-color: #ffffff` AND
   `background-color: var(--ge-adaptive-bg, #ffffff)`. drawio defaults
   edge labels to white bg so text is readable over crossing edges;
   in standalone export this shows as white boxes on connections.

### Fix

1. **SVG sizing**: don't force `height: 100%`. Use natural viewBox
   aspect ratio (remove `height` attribute). Body: `overflow: auto` +
   `max-height: 600px` so tall diagrams scroll instead of being
   crushed. Mirrors in-app iframe's scroll behavior.
2. **Edge label bg**: regex-replace `background-color:\s*#ffffff` and
   `background-color:\s*var\(--ge-adaptive-bg,\s*#ffffff\)` with
   `background-color: transparent` on the SVG string before
   `body.innerHTML = svgText`. Only targets edge label inline styles
   (node label divs don't have background-color); safe.

### What we skip

- No `<style>` injection (mmap pattern) — drawio's foreignObject divs
  already have correct inline styles; the issue was sizing, not styling.
- No `bg: 'none'` in postMessage — the page background isn't the issue
  (the SVG already has `style="background: none"`).
- No edge-label `<rect>` removal — drawio edge labels use foreignObject
  divs (no separate rect); only the div bg needs stripping.

## Decision (ADR-lite)

**Context**: drawio's `xmlsvg` export has correct foreignObject content
but the SVG's tall viewBox + our forced 420px height crushes text.
Edge labels carry inline white bg that's redundant in standalone export.

**Decision**: (1) Let SVG auto-size by viewBox aspect ratio; body scrolls
with max-height 600px. (2) Regex-strip edge label `background-color:
#ffffff` and `var(--ge-adaptive-bg, #ffffff)`.

**Consequences**: Exported drawio diagrams now scroll within the
file-preview body instead of being squashed. Diagrams taller than
600px need scrolling to view in full — acceptable trade-off for
readable text. The lazy regex could over-match if a node label div
ever gets `background-color: #ffffff` (currently they don't); revisit
if a regression appears.

## Out of Scope

- No change to drawio editor / preview iframe rendering.
- No change to PNG export path.
- No re-architecture of the export pipeline.

## Technical Notes

- drawio embed export protocol accepts `bg`, `shadow`, `border`, etc.
  as optional fields on the postMessage. `bg: 'none'` should produce a
  transparent background.
- mmap's style injection (`services/export/mmap.ts:60`) is the precedent
  for fixing foreignObject rendering in standalone SVG context.
- Need a real .drawio sample to inspect the actual exported SVG structure
  before locking the exact style rules.
