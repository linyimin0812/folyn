# Redesign markdown editor and preview reading UI

## Goal

Make the markdown editing + preview experience calm and pleasant to read. The
current background tint, preview typography and component styling feel off.
Target: pure white background (light) / dark background (dark), with
comfortable text, refined hierarchy, unified components and a quiet interface.

## What I already know

User's four principles:

* 文字舒服 — moderate font size, generous line height, limited line length.
* 层次精致 — headings carry weight but are not oversized; natural paragraph spacing.
* 组件统一 — code blocks, tables, blockquotes, callouts blend into body text, not stitched-on cards.
* 界面安静 — reduce presence of borders, backgrounds and action buttons; content is the focus.

Current state (from repo):

* Theme tokens in `apps/desktop/src/index.css` `[data-theme="light"|"dark"]`.
  Light `--bg #f0f2f8` (blue-grey), `--surf #f8f9fd`; dark `--bg #0b0d14`, `--surf #13161f` (blue-tinted).
* Editor pane: `EditorPane.tsx` wraps CodeMirror in `bg-surf`; `.cm-gutters` use `--surf`.
* Preview pane: `PreviewPane.tsx` `.prev-body` has no bg → inherits WorkArea `bg-bg` (blue-grey).
* Preview typography: `.md-preview` rules in `index.css` ~L597–790. Body uses UI font (Sora, a wide
  geometric Latin face) at 14px / 1.6, max-width 800px. h1 28px with bottom border; inline code has
  border + bg; code blocks / tables / blockquotes are bordered surf cards; blockquote has accent bar + bg.
* Code blocks: `CodeBlockWrapper.tsx` + `.code-block-*` CSS (line-number column with its own bg + border-right).
* Callouts: `packages/container-extensions/src/extensions/CalloutExtension.tsx` — inline styles,
  hardcoded saturated colors + emoji icons, 1px colored border card.
* Preview floating buttons (markmap / outline / presentation / cursor-sync) in `PreviewPane.tsx`:
  bordered, shadowed 28px chips, always visible.
* Split-mode cursor sync depends on preview geometry (`rehypeBlankGap`, `gapCompensation`,
  `--md-gap-line`); paragraph margins/`.md-blank-gap { margin: -8px 0 }` are coupled to `p` margin 8px.
* Presentation mode scales `.md-preview` font sizes (`.presentation-mode .md-preview ...`).
* `.md-preview` is also reused in ActivityPage, ContainerPreview, translation result.

## Assumptions (temporary)

* Pure CSS/token + small TSX class changes; no new dependencies.

## Open Questions

## Requirements (evolving)

* Preview body font follows the UI font (`var(--font-ui)`, user-selectable in Appearance); only size,
  line height, spacing and measure change.
* Background scope = markdown area only (editor + preview of markdown tabs). Sidebar, tab bar and
  other file types keep the current theme. Editor and preview share the same surface color.
* Light: pure white reading surface. Dark: dark reading surface.
* Preview typography per the four principles.

* Preview floating buttons: no border/bg/shadow; icon opacity .35 at rest, .7 while hovering the
  preview, 1 + `--hov` bg on button hover; active state = icon in `--acc`.

## Design Spec

Tokens (new, in both theme blocks, scoped by use not by selector):
* `--doc-bg`: light `#ffffff`, dark `#16171b` (neutral, slightly lifted from app bg).
* `--doc-fill`: subtle fill for code blocks / table header / callouts — light `#f6f7f9`, dark `#1e1f24`.
* `--doc-line`: hairline for table rows / hr — light `#ebedf0`, dark `#2a2c33`.

Surfaces: markdown EditorPane body + CodeMirror gutters + PreviewPane `.prev-body` use `--doc-bg`
(markdown tabs only).

Preview typography:
* body 15px / line-height 1.75, `--t1` slightly softened; measure `max-width: 720px`.
* h1 26px/700, h2 21px/650, h3 17.5px/600, h4 15.5px/600, h5/h6 15px/600 `--t2`; no h1 bottom border;
  headings get more space above than below (e.g. h2 `1.8em 0 .6em`).
* p margin `0 0 1em`-ish (keep cursor-sync coupling: adjust `.md-blank-gap` negative margin to match).
* lists: 1.5em indent, li 0.3em; markers `--t3`.
* inline code: no border, `--doc-fill` bg, `.88em`.
* code blocks: `--doc-fill` bg, no border, 8px radius; line-number column transparent, no divider,
  `--t4` numbers; copy/run buttons stay hover-only.
* tables: no vertical borders, header bottom hairline + row hairlines, header weight 600 with no fill,
  font-size .92em; KEEP `width:100%; table-layout: fixed` (commit 62640728 made it fixed on purpose so
  split mode never scrolls horizontally).
* blockquote: 3px `--doc-line`-ish (`--brd2`) bar, no bg, `--t2` text.
* hr: hairline `--doc-line`, generous margin.
* links: `--acc`, subtle underline (`text-underline-offset`, translucent decoration).
* images: 6px radius, centered.
* Callout (`CalloutExtension`): soft tint bg (`color-mix(in srgb, <variant> 7%, transparent)`), no
  border, 8px radius, padding ~.9em 1.1em. Title row = small inline-SVG line icon (replacing emoji;
  container-extensions has no icon lib) + title in variant color, weight 600, same font size as body.
  Body text `--t1` inheriting preview size/line-height. Variant colors toned down (less saturated) and
  readable in both themes. First/last child margins collapsed inside.
* Presentation-mode scaling rules updated to the new base sizes.

## Acceptance Criteria (evolving)

* [ ] Markdown editor + preview backgrounds are pure white (light) / dark (dark).
* [ ] Preview body text, headings, lists, code, tables, blockquotes, callouts restyled per principles.
* [ ] Split-mode cursor sync alignment still works (existing cursorsync tests pass).

## Out of Scope (explicit)

* Global app theme tokens (`--bg`, `--panel`, ... ) and non-markdown file types.
* Other container extensions (card, tabs, steps, timeline …) — follow-up if needed.
* Syntax-highlight color palettes (`.hljs-*`) and user-selected code themes.
* New settings (reading font, measure width).

## Technical Notes

* Files: `apps/desktop/src/index.css`, `components/work-area/{PreviewPane,EditorPane}.tsx`,
  `components/file-types/markdown/CodeBlockWrapper.tsx`,
  `packages/container-extensions/src/extensions/CalloutExtension.tsx`.
* No whole-project builds (AGENTS.md).
