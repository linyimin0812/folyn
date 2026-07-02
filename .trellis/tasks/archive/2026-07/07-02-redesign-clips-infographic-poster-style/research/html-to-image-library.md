# Research: HTML-to-Image Library for Tauri PNG Export

- **Query**: Best library/approach for exporting a React-rendered DOM subtree (InfographicView poster) to PNG in Tauri 2 + React 18 + TS + Tailwind 3
- **Scope**: external (npm registry + project context)
- **Date**: 2026-07-02

## Context (Internal)

- Target DOM: `apps/desktop/src/components/file-types/clip/InfographicView.tsx` — pure Tailwind cards, CSS color tokens (`text-t1/t2/t3`, `text-acc`, `bg-acc/10`, `border-brd`, `bg-panel`, `bg-surf`, `bg-bg`), inline `<svg>` icons (see `SourceBlock`), no canvas/webgl, no external `<img>` tags, no web fonts beyond system stack.
- Stack: `apps/desktop/package.json` — Tauri 2 (`@tauri-apps/api ^2.11`), React 18.3, Vite 6, TS 5.7, Tailwind 3.4. Already installed `@tauri-apps/plugin-dialog ^2.2` and `@tauri-apps/plugin-fs ^2.2` for native save dialog + file write. Also note `html2pdf.js ^0.14` is already a dep (it bundles `html2canvas` internally — see gotchas).
- No existing image-export dependency; this is a greenfield addition for the clip infographic → PNG feature.

## Findings

### Library Comparison

| Library | Latest | Last Release | Bundle (unpacked) | Deps | Maintenance | Approach |
|---|---|---|---|---|---|---|
| `html-to-image` (bubkoo) | 1.11.13 | 2025-02-14 | 315 kB | 0 | Active, ~73 versions | SVG `foreignObject` + canvas |
| `html2canvas` (niklasvh) | 1.4.1 | 2022-01-22 | 3.4 MB | 2 (`css-line-break`, `text-segmentation`) | Stale (4+ years no release), open issues ~1500+ | Custom canvas re-render |
| `dom-to-image` (tsayen) | 2.6.0 | 2017-10-04 | — | — | Abandoned (8+ years) | SVG `foreignObject` |
| `dom-to-image-more` (1904labs) | 3.10.0 | recent | — | — | Community fork, active-ish | SVG `foreignObject` fork |
| Manual `foreignObject` | — | — | 0 | 0 | Self-maintained | Hand-rolled serialize + canvas draw |

### Per-Library Notes

#### 1. `html-to-image` (RECOMMENDED)

- Modern ES module, zero deps, MIT.
- API: `toPng(node, { pixelRatio, backgroundColor, filter, ... })`, also `toSvg`, `toJpeg`, `toBlob`, `toCanvas`.
- **CSS variables / Tailwind**: Reads computed styles via `getComputedStyle` and inlines them into the cloned node. CSS custom properties (`--acc`, `--brd`, etc.) on `:root`/`html` resolve correctly because it serializes the cloned subtree with inline styles; Tailwind utility classes that compile to plain CSS (e.g. `.text-acc { color: var(--acc) }`) get their computed values inlined. Works well for the InfographicView token system.
- **Fonts**: Inlines web fonts by fetching `@font-face` src as data URLs. System fonts (used by InfographicView) just work. In Tauri, the app is served via `tauri://localhost` (or `http://localhost`) on Windows/Linux and `tauri://localhost` on macOS — fetch of same-origin font URLs is fine. No CORS issue for system fonts.
- **SVG**: Inline `<svg>` (as in `SourceBlock`) serializes correctly because it is part of the DOM subtree. External `<img src="*.svg">` would need same-origin. The poster only uses inline SVG, so this is safe.
- **Gotchas**: 
  - `pixelRatio` defaults to `window.devicePixelRatio` — set explicitly (e.g. `2`) for crisp poster output.
  - `backgroundColor` should be set to the page bg (`--bg`) because transparent areas may render as transparent PNG (not white).
  - `filter` can skip nodes (e.g. ignore `<a>` whose hover styles don't apply).
  - Large DOM: poster has ~10–30 cards, serializes in ms; fine.
- **Tauri-specific**: No special config. The library runs in webview JS; result is a `data:` URL string. Convert to `Uint8Array` and write via `@tauri-apps/plugin-fs` `writeFile` after `save({ defaultPath })` from `@tauri-apps/plugin-dialog`. No IPC needed.

#### 2. `html2canvas`

- Last release Jan 2022 (~4 years stale); maintainer `niklasvh` has a v2.0 rewrite in slow development.
- Bundle 3.4 MB (unpacked), 2 deps for line-breaking; ships a large UMD.
- **Does NOT support CSS custom properties well** — known issue: it re-implements CSS parsing and historically drops `var(--…)`. Many open issues (#2230, #2284, etc.) report broken `var()` rendering. With InfographicView relying entirely on `text-t1/acc/brd` tokens, this is a **blocking problem** unless the consumer inlines computed styles first.
- **Fonts**: Better than most at font metrics (its reason for `css-line-break`), but still struggles with web fonts loaded cross-origin.
- **SVG**: Renders inline SVG via its own painter; mostly works but has edge cases with `currentColor` and `viewBox`.
- Already transitively bundled via `html2pdf.js ^0.14` in this project — adding it directly would not strictly increase bundle, but the stale + CSS-var breakage makes it a poor fit.

#### 3. `dom-to-image` / `dom-to-image-more`

- Same `foreignObject` approach as `html-to-image` but unmaintained (original last release 2017). The `dom-to-image-more` fork (3.10.0) is the maintained community continuation.
- API is comparable but less ergonomic; fewer options for `pixelRatio`, `filter`, style inlining.
- No advantage over `html-to-image`; only consider if a specific bug in `html-to-image` blocks you.

#### 4. Manual SVG `foreignObject`

- Approach: `XMLSerializer.serializeToString(node)` → wrap in `<svg><foreignObject>` → `data:image/svg+xml` URL → draw to `<canvas>` → `canvas.toDataURL('image/png')`.
- Pros: zero deps, full control.
- Cons: 
  - Must manually inline computed styles (Tailwind classes won't travel with the serialized HTML) — non-trivial; you'd basically reimplement `html-to-image`.
  - `foreignObject` has cross-origin font/image restrictions in some webviews; tainting the canvas produces a SecurityError on `toDataURL`.
  - More code to maintain; not worth it for a single poster feature.

### Tauri 2 Specifics

- **Webview origin**: Tauri 2 serves the frontend from `http://localhost` (dev) and `tauri://localhost` / `http://tauri.localhost` (prod) depending on platform. The `data:` URL produced by `html-to-image` is same-origin safe; no `file://` CORS issues because the DOM is already in the webview.
- **Fonts**: InfographicView uses system fonts (no `@font-face`), so no font fetch / CORS concerns. If custom fonts are added later, ensure they are served from the same Tauri origin (not a remote CDN) so `html-to-image` can inline them without tainting.
- **Images**: Poster has no external `<img>`. If images are added later, they must be either inline SVG, bundled assets (same-origin), or data URLs — remote images with `crossorigin="anonymous"` would otherwise taint the canvas.
- **File save flow**: 
  ```ts
  import { save } from '@tauri-apps/plugin-dialog';
  import { writeFile } from '@tauri-apps/plugin-fs';
  import { toPng } from 'html-to-image';

  const dataUrl = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
  const path = await save({ defaultPath: 'infographic.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (path) await writeFile(path, bytes);
  ```
  No Rust-side command required; `plugin-fs` `writeFile` handles bytes directly.

## Recommendation

**Use `html-to-image` (`^1.11.13`).**

Reasoning:
1. **CSS-variable friendly** — critical because InfographicView's entire color system is `var(--acc/brd/t1…)`. `html-to-image` inlines computed styles; `html2canvas` (the main alternative) has long-standing bugs rendering `var()`.
2. **Actively maintained** — last release Feb 2025, zero runtime deps, modern ESM.
3. **Tiny** — 315 kB unpacked vs html2canvas's 3.4 MB.
4. **Inline SVG works** — `SourceBlock`'s `<svg>` icon serializes with the DOM; no special handling.
5. **Tauri-clean** — pure JS in webview, output is a `data:` URL string, write to disk via already-installed `plugin-dialog` + `plugin-fs`. No IPC, no Rust.
6. System fonts mean zero font-CORS risk; the existing token system means `html2canvas` would visibly break colors.

## Caveats / Not Found

- **Pixel ratio**: default follows `window.devicePixelRatio`; for a printable poster, pin `pixelRatio: 2` (or 3) at the call site.
- **Background**: PNG transparency — explicitly pass `backgroundColor` matching `--bg` to avoid transparent gaps between rounded cards.
- **`<a target="_blank">` in SourceBlock**: harmless for static image capture (no hover/focus styles), but if you want to drop the link visually, use the `filter` option to skip it.
- Did not benchmark `dom-to-image-more` head-to-head; `html-to-image` is the de-facto modern default and there is no InfographicView-specific reason to deviate.
- If a future requirement is **SVG vector export** (not just PNG), `html-to-image.toSvg(node)` returns an SVG string with `foreignObject` — same call site, different output. Note: that SVG will embed the inlined styles and is suitable for re-render in any browser, but is not a "true" vectorization of Tailwind classes.
- No project-spec document under `.trellis/spec/desktop/` currently mentions image export; this is net-new capability.
