# Perf recon: large markdown file open lag (2026-11-22)

Measured on this machine with the repo's own node_modules (Node 27).

## Measured baseline

- 1MB prose doc (16k lines), full preview pipeline = **~4.5s** (remarkParse 266ms, +rehypeRaw ≈460ms, +rehypeHighlight ≈770ms, rehypeReact JSX-tree ≈3.7s). ~linear scaling → 10MB ≈ 45s.
- Math blocks ≈1–40ms each via rehype-mathjax sync SVG.
- `doc.toString()` on 5MB ≈ 1–6ms; `listSegments` 25ms/5MB; word-count `split(/\s+/).filter` 57ms/5MB.
- `mathFoldService` + `foldGutter` cost measured **43ms/keystroke on 5MB**.

## Findings

1. **Open flow**: `FilesPanel.tsx:103` → `editorIoService.openFile` (zustand `editorStore`) → single `readTextFile` (`packages/vault-provider/src/providers/tauriProvider.ts:70`, `externalFileProvider.ts:56-57`) into `tab.content`. Markdown handler `file-types/markdown/index.ts` has **defaultMode 'split'** → `WorkArea.tsx:37,58,170,180` (skeleton = 1 deferred frame, no work saved) → `PreviewPane.tsx:20` mounts MarkdownPreview immediately; `KEPT_PREVIEWS=8` keeps 8 full preview trees alive. Open-time cost = preview pipeline + React mount, not IO.
2. **Editor per-keystroke (smoking gun)**: `MarkdownMathExtension.ts:59` — `mathFoldService` calls `state.doc.toString()` (full-doc materialization) **before** its cursor-range early-return; `foldGutter()` (`EditorView.tsx:590`) rebuilds markers on every `docChanged`/`viewportChanged` (verified in @codemirror/language dist ~1590-1612), calling `foldable()` per viewport line → **~60 full-doc `toString()` per keystroke AND per scroll step**. Also `MarkdownMathExtension.ts:37,41` mathHighlight does toString+`findMathSegments` (→ `renderMarkdown.ts:24 listSegments`, per-char loop) per keystroke; `headingFoldExtension.ts` walks forward from each heading line. `EditorView.tsx:544-546`: toString + word-count regex split per keystroke.
3. **Preview pipeline**: `MarkdownPreview.tsx:188-219` — single sync `processSync` in a useMemo: transformMathBrackets/unwrapInlineMath (`renderMarkdown.ts:108,140`, listSegments ×2) + remarkParse/Gfm/Breaks/Directive + rehypeRaw + **rehypeHighlight (all lowlight grammars eager)** + **rehype-mathjax sync SVG** + rehypeReact whole tree. **No virtualization**; debounce exists only in `MarkdownPreview.tsx:39-41` (`PARSE_DEBOUNCE_CHARS=6000`, `PARSE_DEBOUNCE_MS=150`, `PARSE_MAX_WAIT_MS=500`) — caps *frequency*, not the 4.5s-per-1MB *cost*; re-runs fully on main thread while typing. Gap compensation `useLayoutEffect` at `MarkdownPreview.tsx:256-288` measures every top-level block (getBoundingClientRect). Mermaid: eager module import in `packages/container-extensions/.../MermaidExtension.tsx`, async render.
4. **Cursor sync**: `usePreviewCursorSync.ts:116,144,170,183,222` — per cursor move/keystroke (rAF-coalesced but per burst): `querySelectorAll('[data-source-line]')` over ALL blocks + `getClientRects()` per block + full-doc `parseRef.current.split('\n')` + `blockLastSrcLine` scans.
5. **Existing perf work**: debounce in MarkdownPreview/PreviewPane/usePreviewZoom/JSON viewers; throttle in PreviewPane/EditorView/Markmap; commits `18be546e` (P2 cursor-sync+debounce), `a1475c31` (skeleton), `ca556bbf` (per-tab preview scroll). **No requestIdleCallback, no useDeferredValue/startTransition, no preview virtualization** anywhere in the markdown path.
6. **Tests**: root `vitest.workspace.ts` → project `desktop` (jsdom, `apps/desktop/src/**`). Run one file: `sh node_modules/.bin/vitest run --project desktop <path>` from repo root (Node ≥20; on this machine Node 27 at `~/.nvm/versions/node/v27.0.0-alpha.0.0.0/bin`). Coverage: `MarkdownPreview.cursorsync*.test.tsx`, `renderMarkdown.test.ts`, `rehypeBlankGap/gapCompensation/blockAlignPoint/codeBlockAlign` tests.
7. **Double reads / images**: no double disk read — editor and preview share `tab.content`; `readFileByRoute` only serves embedded-file previews. `VaultImage.tsx` resolves each image via async Tauri IPC (high promise churn with many images, non-blocking).

## Ranked causes

**Open-time freeze**
1. `MarkdownPreview.tsx:188-219` sync full pipeline ~4.5s/1MB + full React mount, no virtualization
2. rehypeReact full JSX tree (~3.7s/1MB) + gap `useLayoutEffect:256` getBoundingClientRect over all blocks
3. rehypeHighlight all-grammars + rehype-mathjax sync SVG per code/math block
4. foldGutter × mathFoldService ~60 toString at mount (`MarkdownMathExtension.ts:59`)
5. split default + `KEPT_PREVIEWS=8` keeps N full trees; startup `restoreOpenTabs` re-reads all persisted tabs

**Typing lag**
1. mathFoldService: ~60 full-doc `toString()` per keystroke/scroll (43ms/keystroke on 5MB) — `MarkdownMathExtension.ts:59` + `EditorView.tsx:590`
2. mathHighlight full-doc scan per keystroke (`MarkdownMathExtension.ts:41`, 30ms/5MB)
3. `EditorView.tsx:544-546` toString + word-count (59ms/5MB)
4. every ≤500ms the full 4.5s-per-1MB pipeline re-runs on main thread (debounce caps frequency only)
5. `usePreviewCursorSync.ts:116,170` querySelectorAll + getClientRects + split per keystroke
6. `OutlineSidebar.tsx:54` unmemoized `extractHeadings` full scan per re-render

## Related specs

- `.trellis/spec/desktop/frontend/markdown-rendering.md` — pipeline contract (all 4 render sites MUST use renderMarkdown.ts; processSync; MathJax SVG sync)
- `.trellis/spec/desktop/frontend/file-type-editors.md`
- `.trellis/spec/desktop/frontend/component-guidelines.md`
