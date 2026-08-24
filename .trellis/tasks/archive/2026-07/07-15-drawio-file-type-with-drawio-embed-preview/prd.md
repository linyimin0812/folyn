# drawio file type with drawio embed preview

## Goal

Add `.drawio` (and `.dio`) file support to Folyn so users can open and edit draw.io diagrams in-place, mirroring the existing `excalidraw` handler. Backed by `react-drawio`'s `DrawIoEmbed` (iframe to draw.io's web editor), with debounced XML write-back to the underlying file.

## What I already know

### Folyn file-type system
- `apps/desktop/src/components/file-types/registry.ts:47` auto-globs `./*/index.{ts,tsx}` — **just drop a folder, no manual registration.**
- Handler contract: `apps/desktop/src/components/file-types/types.ts:27-39` (`FileTypeHandler`).
- Closest precedent: `excalidraw/` — `Editor`-only (no separate `Preview`), `supportedViewModes: ['edit']`, `needsFileContent: true`, `useCodeMirror: false`. Debounced 1s write-back via `onChange`, parses once per `tabId` with `useState`.
- `EditorProps` (types.ts:5-11): `content`, `tabId`, `filePath`, `onChange`, `onSave`.
- Extension dispatch: `editorStore.ts:27-35` (`detectFileType`) — pure extension lookup, no MIME sniffing.
- Icon: `FileIcon.tsx:getFileTypeIcon` has an ext→svg map that may need a `drawio` entry.

### Reference project (`next-ai-draw-io`)
- Dep: `react-drawio@^1.0.3` — wraps `https://embed.diagrams.net` in an iframe, `postMessage` protocol.
- `DrawIoEmbed` exposes a ref with `.load({xml})` and `.exportDiagram({format})` for moving XML in/out.
- `.drawio` files are XML (`<mxfile><diagram>…</diagram></mxfile>`); pages may be compressed (base64→deflate→URI-decode) but the embed handles that internally.
- **Reference does NOT bundle drawio assets locally** — defaults to the public CDN. Electron ipc-handlers reference `/drawio/index.html` but it's not committed; effectively online-only.

## Assumptions (temporary)

- Users will have internet access at view/edit time (MVP — online embed).
- Editing + write-back is in scope; static read-only view is NOT sufficient (matches excalidraw parity).
- `.drawio` is the primary extension; `.dio` is an alias some users use.
- Single-page diagrams only for MVP (multi-page `<mxfile>` renders, but page-switching UX is out of scope).

## Open Questions

(none — all resolved)

## Requirements

- New `file-types/drawio/` folder with `index.ts` default-exporting a `FileTypeHandler`.
- `extensions: ['drawio', 'dio']` (`.dio` is a common alias).
- `supportedViewModes: ['edit']`, `defaultViewMode: 'edit'`.
- `needsFileContent: true`, `useCodeMirror: false`.
- `Editor` component wrapping `react-drawio`'s `DrawIoEmbed`:
  - On embed `onLoad`: call `ref.current.load({xml: content})` once per `tabId`.
  - On embed `onSave` auto-save event (`{xml}`): debounce 1s, call `onChange(xml)` (mirrors excalidraw's debounced write-back).
  - Reset load-ref on `tabId` change (mirrors excalidraw).
- File icon entry in `FileIcon.tsx` ext map (reuse `dataStructure` icon, same as `mmap` — no new SVG).
- Add `react-drawio` dep to `apps/desktop/package.json`.
- `ponytail:` comment on the online-embed ceiling and the offline upgrade path (Approach B).

## Acceptance Criteria

- [ ] Opening a `.drawio` file renders the draw.io editor inside Folyn (online embed loads).
- [ ] Edits in the embed fire the auto-save event and write XML back to the file (debounced ~1s), persisted on Cmd+S / auto-save.
- [ ] Re-opening a saved file shows the updated diagram (round-trip verified manually).
- [ ] `.dio` extension also opens this handler.
- [ ] File icon shows in the tab bar and file tree for `.drawio` / `.dio` files.
- [ ] No console errors on open / edit / save.
- [ ] Existing file types (excalidraw, mmap, markdown) still open.
- [ ] `ponytail:` comment marks the online-embed ceiling + offline upgrade path.

## Definition of Done

- Lint / typecheck / build green.
- Manually verified open → edit → save → reopen round-trip on at least one sample `.drawio` file.
- `ponytail:` comment marks the online-embed ceiling and the offline upgrade path.
- No new unrequested abstractions.

## Out of Scope (explicit)

- Offline drawio asset bundling (deferred — see Approach B).
- Multi-page diagram UX (page switcher, per-page export).
- AI / MCP integration like the reference project has.
- Import from / export to PNG/SVG (the embed itself supports this interactively; programmatic export is out).

## Research References

(none yet — research-first may not be needed; excalidraw precedent + reference project inspection already covers the design space.)

## Research Notes

### Feasible approaches

**Approach A: Online embed via `react-drawio`** (Recommended — lazy MVP)
- How: `Editor` renders `<DrawIoEmbed ref={ref} />`; on mount call `ref.current.load({xml: content})`; on embed change events, call `ref.current.exportDiagram({format:'xml'})` and write back via `onChange` (debounced 1s, mirroring excalidraw).
- Pros: ~50 LOC, one new dep, matches excalidraw architecture, ships today.
- Cons: Requires internet. diagrams.net CDN downtime = broken editor. `ponytail:` marks this clearly.
- Ceiling: network dependency. Upgrade path: Approach B when offline matters.

**Approach B: Offline bundled drawio web assets**
- How: Copy draw.io's `drawio-desktop`/`web` dist (~30MB) into `apps/desktop/public/drawio/`, point `DrawIoEmbed urlParameters={{ URL: '/drawio/index.html' }}` (or equivalent) at the local path. Electron `file://` loading needs CSP tweaks.
- Pros: Fully offline, desktop-appropriate.
- Cons: 30MB binary blob in repo (or vendored via postinstall script), CSP/CORS setup, non-trivial. Too big for a first cut.

**Approach C: Hand-rolled mxGraph XML viewer (no embed)**
- How: Parse `<mxGraphModel>` and render with a custom canvas. Edit would be out of scope → view-only.
- Pros: No iframe, no network, tiny.
- Cons: Reimplements what draw.io does; view-only; huge surface area for format edge cases. Reject.

## Decision (ADR-lite)

**Context**: draw.io's editor is a large web app. We need a `.drawio` file handler that fits Folyn's file-type registry and matches the excalidraw pattern (single `Editor` component with debounced write-back). Desktop offline support is desirable but not blocking.

**Decision**: Approach A — `react-drawio` `DrawIoEmbed` pointing at the public `embed.diagrams.net` CDN. The embed emits an auto-save `{xml}` event on edit, so write-back is a 1-line debounce, no `exportDiagram` polling needed. `['edit']` view mode only. `.drawio` + `.dio` extensions. Reuse the `dataStructure` icon (no new SVG).

**Consequences**: Requires internet at edit time — `ponytail:` comment marks the ceiling and the upgrade path (Approach B: bundle `drawio-desktop` web assets into `public/drawio/` and rewrite the embed URL, ~30MB blob, deferred to a follow-up task). diagrams.net CDN downtime breaks the editor but not the file (XML persists on disk). No new abstractions introduced — one folder, two files, one dep.

## Technical Notes

- Files to create:
  - `apps/desktop/src/components/file-types/drawio/index.ts`
  - `apps/desktop/src/components/file-types/drawio/DrawioEditor.tsx`
- Files to modify:
  - `apps/desktop/src/components/icons/FileIcon.tsx` (add `drawio` to ext map, if a dedicated icon is wanted)
  - `apps/desktop/package.json` (add `react-drawio` dep)
- Reference: `apps/desktop/src/components/file-types/excalidraw/ExcalidrawEditor.tsx` for the `onChange`-debounce + `tabId`-reset pattern.
