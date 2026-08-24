# GrapesEditor Canvas Center and Hide Scrollbar

## Goal

Improve the GrapesJS visual editor canvas UX in `apps/desktop/src/components/file-types/html/`:
1. Hide the iframe's internal vertical scrollbar (the existing `iframe::-webkit-scrollbar` rule does NOT pierce the iframe boundary, so the iframe's body scrollbar still shows).
2. Center the canvas iframe within the available canvas container (currently `width: '100%'` makes the iframe left-fill the wrapper, leaving no centered "page sheet" feel).
3. Center the iframe's body content horizontally so narrower HTML bodies render centered rather than left-aligned.

## What I already know

- `GrapesEditor.tsx` renders the canvas column as `<div className="flex-1 flex flex-col overflow-hidden bg-surf2"><div ref={containerRef} className="flex-1 overflow-hidden" /></div>`.
- `grapesConfig.ts` sets `canvas: { styles: CANVAS_STYLES }` (external font URLs only) and `width: '100%'`, `height: '100%'`.
- `grapesTheme.css` already has `.gjs-cv-canvas iframe::-webkit-scrollbar { display: none; }` and `scrollbar-width: none` — but these target the iframe ELEMENT's scrollbar, not the iframe DOCUMENT's internal scrollbar (CSS doesn't pierce iframe boundary for same-origin documents in modern Chromium).
- `injectExternalLinks(editor, headContent)` already runs on `editor.on('load')` and has access to `editor.Canvas.getDocument()` — perfect place to inject a `<style>` tag into the iframe document.

## Requirements

- Inject a `<style>` tag into the canvas iframe document on `load` that:
  - Hides scrollbars on `html` and `body` (`scrollbar-width: none`, `::-webkit-scrollbar { display: none; width: 0; height: 0; }`).
  - Applies `body { margin: 0 auto; }` — lightweight centering that is a no-op for full-width bodies (which fill 100% regardless) but enables centering when the user's body has a max-width via their own CSS.
- The iframe itself stays full-width (`width: '100%'` unchanged) — no parent-document CSS changes.
- Must NOT modify the saved HTML output — injected CSS lives in the iframe document only, never reaches `editor.getCss()` / `editor.getHtml()`.

## Acceptance Criteria

- [ ] Switching to 可视化 mode shows no vertical scrollbar on the right edge of the iframe when the HTML body is taller than the iframe viewport (scroll still works via wheel / trackpad).
- [ ] When the HTML body has a max-width (via user CSS) narrower than the iframe, it appears centered rather than left-aligned.
- [ ] Full-bleed bodies (no max-width) still render full-width — preview appearance is unchanged aside from the hidden scrollbar.
- [ ] Selecting / dragging components on the canvas still works correctly (iframe size and position unchanged).
- [ ] Saving / exporting the HTML does NOT include the injected scrollbar-hiding or centering CSS — the saved file is unchanged from before.
- [ ] Existing unit tests in `grapesConfig.test.ts` / `grapesContentPipeline.test.ts` / `useGrapesEditor` tests still pass; new test covers the iframe `<style>` injection.

## Definition of Done

- Tests added or updated to cover the new iframe CSS injection (extend `injectExternalLinks` test or add a new test for the injected `<style>` content).
- Lint / typecheck / vitest green.
- Manual smoke test in the desktop app: open an HTML file, switch to 可视化, confirm centered + no scrollbar + selection still works.

## Decision (ADR-lite)

**Context**: The iframe scrollbar can't be hidden from the parent document (CSS doesn't pierce iframe boundary), and the user wants the visual page body content centered rather than left-aligned when it has a max-width.

**Decision**: Inject a `<style>` tag INTO the iframe document via `editor.Canvas.getDocument()` on `load`. The injected CSS hides scrollbars on `html`/`body` and applies `body { margin: 0 auto; }` for lightweight centering (no-op unless body has a max-width; does not break flex/grid layouts). No parent-document CSS changes — the iframe stays full-width.

**Consequences**:
- Injected CSS is preview-only — it does not get saved to the HTML file (verified by `editor.getCss()` reading from CssComposer, not the iframe DOM).
- Centering only visibly kicks in when the user's body has a max-width; full-bleed bodies remain full-bleed (intended — we don't want to alter the rendered preview's appearance beyond hiding the scrollbar).
- No risk to GrapesJS hit-testing since the iframe size and position are unchanged.

## Technical Approach

**File: `grapesConfig.ts`** — extend `injectExternalLinks` (or add a sibling `injectCanvasOverrideStyles`) to append a `<style>` tag into `editor.Canvas.getDocument().head` with:

```css
html, body {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
body {
  margin: 0 auto;
}
```

Call from the existing `onReady` handler in `useGrapesEditor.ts` (already invokes `injectExternalLinks`). No `grapesTheme.css` changes needed since the iframe stays full-width.

## Out of Scope

- Device-mode-specific centering (Desktop / Tablet / Mobile portrait all use the same centering rules).
- Customizable canvas max-width UI control.
- Touching the right panel (styles / layers / traits) — already handled with `mochi-no-scrollbar`.
- Source mode or Preview mode iframes — only 可视化 mode (GrapesJS) is in scope.

## Technical Notes

- Files inspected:
  - `apps/desktop/src/components/file-types/html/GrapesEditor.tsx`
  - `apps/desktop/src/components/file-types/html/useGrapesEditor.ts`
  - `apps/desktop/src/components/file-types/html/grapesConfig.ts`
  - `apps/desktop/src/components/file-types/html/grapesTheme.css`
  - `apps/desktop/src/components/file-types/html/HtmlVisualEditor.tsx`
- Related task: `06-23-grapesjs-migration` (the original migration; recent commit `f293deb` already hid right-panel scrollbar).
- Tests: `grapesConfig.test.ts`, `grapesContentPipeline.test.ts`, `grapesIntegration.test.ts` exist — extend `grapesConfig.test.ts` for the new injection.
