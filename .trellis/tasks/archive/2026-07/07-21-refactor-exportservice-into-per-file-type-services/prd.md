# refactor exportService into per-file-type services

## Goal

Split the 1159-line `exportService.ts` into per-file-type modules under
`services/export/`; `exportService` becomes an orchestrator with a Map
registry that dispatches by extension. Pure refactor, no behavior change.

## Requirements

- New `services/export/` subfolder with one module per file type:
  - `dbml.ts` — owns `enhanceX6Block` + `renderErLayoutToSvg` +
    `renderTableCardSvg` + `renderEnumCardSvg` + `escapeXml` +
    `ER_HEADER_H/ER_ROW_H` consts.
  - `excalidraw.ts` — owns `enhanceExcalidrawBlock` + `decodeDataUriSvg`.
  - `drawio.ts` — owns `enhanceDrawioBlock`.
  - `mmap.ts` — owns `enhanceMmapBlock` + `fixImageNodeLayout`.
  - `shared.ts` — owns all cross-type utils: `svgToPngBlob`,
    `renderFilePreviewToSvg`, `inlineSvgImages`, `inlineContainerImages`,
    `readImageAsDataUrl`, `inlineImages`, `downloadBlob`, `escapeHtml`,
    `showExportNotification`.
- Each per-type module exports `enhance(body, ctx)` with uniform signature
  `ctx: { src: string; filePath: string; vaultRoot: string }`. Module
  uses what it needs from `ctx`; unused fields are ignored, not enforced.
- `exportService.ts` keeps the HTML main pipeline
  (`renderMarkdownToHtmlViaDom`, `collectAppCss`, `processFilePreviews`,
  `resolveVaultPath`, `LIGHT/DARK_THEME_VARS`, `HTML_STYLES`,
  `hasContainerSyntax`, `buildExportComponentMap`, `renderMarkdownToHtml`
  legacy) and hosts a `REGISTRY: Record<string, (b, ctx) => Promise<void>>`
  for dispatch. `processFilePreviews` becomes a registry lookup, not an
  if/else chain.
- `useExport.ts` updates its import paths to pull shared utils from
  `services/export/shared`; re-exports (`ExportFormat`,
  `hasContainerSyntax`) keep pointing at `exportService`.

## Acceptance Criteria

- [ ] `exportService.ts` no longer contains per-type enhancer functions
      or their helpers (dbml SVG renderers, `fixImageNodeLayout`,
      `decodeDataUriSvg`, etc.).
- [ ] Each per-type module exports a single `enhance` function matching
      the uniform signature.
- [ ] `processFilePreviews` uses a `REGISTRY` lookup; no per-type
      branching in the orchestrator body.
- [ ] `exportService.test.ts` + `useExport.test.ts` pass with only
      import-path adjustments (no test logic changes).
- [ ] `tsc -b` clean.
- [ ] Manual export round-trip of HTML/PNG/SVG for a markdown doc with
      embedded dbml/excalidraw/drawio/mmap blocks is byte-identical to
      pre-refactor output.

## Definition of Done

- Tests green, tsc clean.
- No new dependencies added.
- `ponytail:` comments preserved alongside their logic.
- Spec gap noted: directory-structure.md says services are flat; this
  introduces a `services/export/` subfolder. Update spec or document the
  carve-out in PRD's ADR-lite.

## Technical Approach

### Module shape

```
services/
├── export/
│   ├── dbml.ts         // export async function enhance(body, ctx)
│   ├── excalidraw.ts  // export async function enhance(body, ctx)
│   ├── drawio.ts      // export async function enhance(body, ctx)
│   ├── mmap.ts        // export async function enhance(body, ctx)
│   └── shared.ts      // svgToPngBlob / renderFilePreviewToSvg / ...
├── exportService.ts   // 主管线 + REGISTRY dispatch + 主管线 utils
```

### Dispatch contract

```ts
type EnhanceCtx = { src: string; filePath: string; vaultRoot: string };
type EnhanceFn = (body: HTMLElement, ctx: EnhanceCtx) => Promise<void>;

const REGISTRY: Record<string, EnhanceFn> = {
  dbml: dbml.enhance,
  excalidraw: excalidraw.enhance,
  drawio: drawio.enhance,
  mmap: mmap.enhance,
};

// processFilePreviews body becomes:
const fn = REGISTRY[ext];
if (fn) await fn(body, { src, filePath, vaultRoot }).catch(() => {});
else { /* fall through: keep SVG or filename card */ }
```

### Implementation Plan (small PRs)

- **PR1 — Extract `shared.ts`**: move utils verbatim; `exportService.ts`
  re-exports them so external callers (useExport) still work. Tests pass
  unchanged. Risk: zero (pure move).
- **PR2 — Extract 4 per-type modules + REGISTRY dispatch**: each module
  owns its enhancer + helpers; `processFilePreviews` rewritten as a
  lookup. Tests pass (only test file imports may shift). Risk: low
  (logic preserved, dispatch shape changed).
- **PR3 — Update `useExport.ts` import paths**: pull shared utils from
  `services/export/shared`; drop re-exports from `exportService.ts`
  for the moved utils. Risk: zero (mechanical).

## Decision (ADR-lite)

**Context**: `exportService.ts` is 1159 lines, mixing the HTML export
pipeline with 4 file-type-specific enhancers (dbml/excalidraw/drawio/mmap)
and shared utils. New file types require editing the orchestrator.

**Decision**: Split into `services/export/{dbml,excalidraw,drawio,mmap,shared}.ts`
with a uniform `enhance(body, ctx)` signature; `exportService.ts` hosts a
`REGISTRY` map for dispatch. This violates directory-structure.md's
"services are flat" convention but co-locates cohesive per-type logic
and makes adding a new file type a single-file change.

**Consequences**:
- + Pro: new file type = new module + 1 line in REGISTRY.
- + Pro: per-type logic is grep-able in one file.
- − Con: introduces a `services/export/` subfolder, breaking the flat
  convention. Either update directory-structure.md or accept the
  carve-out.
- − Con: `useExport.ts` imports shift from one module to two.

## Out of Scope

- No behavior change to exported output (byte-identical).
- No new file types added.
- No public API rename in `useExport.ts` (export names unchanged).
- No refactor of `renderMarkdownToHtml` legacy (kept as-is).

## Technical Notes

- `enhanceX6Block` lazy-imports `parseDbml` + `erLayout` — keep that
  dynamic import in `dbml.ts` so the main bundle stays lean.
- `enhanceExcalidrawBlock` + `enhanceMmapBlock` both call
  `inlineSvgImages` — moved to `shared.ts`, imported by both.
- `showExportNotification` is called only from `downloadBlob` — keep it
  as a private (non-exported) function in `shared.ts`.
