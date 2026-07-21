# Excalidraw editor does not refresh after AI edits

## Goal

When an AI agent edits an open `.excalidraw` file, the visible Excalidraw editor does not update — the diagram stays at the pre-edit state until the user manually remounts (e.g. tab switch). Fix it so AI edits land in the editor the same way they do for Drawio.

## What I already know

* `ExcalidrawEditor.tsx:26` parses `content` once via `useState(() => parseContent(content))` — no effect listening to prop changes. Subsequent `content` updates never reach the Excalidraw component.
* `fileChangeApplier.ts:60-79` — for non-`useCodeMirror` handlers (excalidraw, drawio, mmap), `apply(change)` calls `updateTabContent(tabId, change.newContent)`. This updates `tabs[].content` but does NOT bump `externalContentVersion`.
* `WorkArea.tsx:326` mounts `<handler.Editor key={`${tabId}-${externalContentVersion}`}>` — version doesn't bump on AI apply, so ExcalidrawEditor doesn't remount, so `useState(parseContent)` never re-runs.
* `DrawioEditor.tsx:31-46` shows the correct pattern: a content-prop effect that diffs against a ref of last-loaded content and reloads when they differ. It also cancels any pending autosave timer so the user's stale in-iframe edit doesn't overwrite the AI's change after it lands.
* `ExcalidrawPreview.tsx:16-33` (preview mode via `:::file-preview{src=...}`) DOES re-render correctly on AI edits — but only because it's mounted when the tab is closed / viewed as preview, and `updateTabContent` doesn't bump `externalContentVersion` either. Worth confirming the preview path during the fix.
* Excalidraw API: pass an `excalidrawRef` to `<Excalidraw>` and call `excalidrawRef.current.updateScene({ elements, appState })` to imperatively update the scene without remount.

## Requirements

* After an AI `file_change` applies to an open `.excalidraw` tab, the Excalidraw component reflects the new diagram — no manual remount.
* The user's pending in-canvas edits (autosave timer not yet fired) are discarded on AI apply — matches Drawio behavior. Undo in-editor.
* No spurious re-sync when the user's own `onChange` flows back through `updateTabContent` (content === last loaded → no-op).

## Acceptance Criteria

* [ ] With an `.excalidraw` tab open, trigger an AI file change to that file — canvas updates to the new diagram without tab switch or reload.
* [ ] Edit the canvas as a user (don't save), then trigger an AI change — user's unsaved edit is discarded, AI's version shows.
* [ ] Editing the canvas as a user does NOT trigger a self-reload (content === last-loaded → no-op).
* [ ] Tab switch away and back still shows the current `tabs[].content`.

## Definition of Done

* Lint / typecheck green.
* Manual check in editor: AI apply, user edit, AI apply during user edit.
* No new tests required (small UI behavior fix).

## Technical Approach

Add a content-prop effect to `ExcalidrawEditor.tsx`, mirroring DrawioEditor:

1. Hold an `excalidrawRef` (Excalidraw's imperative API).
2. Track `loadedContentRef` — the last content fed to Excalidraw.
3. On `content` change, diff against `loadedContentRef.current`:
   - equal → no-op (user's own onChange flowing back).
   - differ → cancel pending autosave timer, parse content, call `excalidrawRef.current?.updateScene({ elements, appState })`, update `loadedContentRef`.
4. Initialize `loadedContentRef` to the initial `parseContent(content)` result so first mount doesn't double-apply.

## Decision (ADR-lite)

**Context**: Custom-editor refresh after AI edits was inconsistent — DrawioEditor had the content-prop effect, ExcalidrawEditor didn't.
**Decision**: Mirror DrawioEditor's pattern in ExcalidrawEditor (content-prop effect + ref-guarded updateScene). Do NOT bump `externalContentVersion` from `apply()` for non-codeMirror handlers — that would remount via WorkArea's key, losing user state and breaking the zero-regression contract from `fileChangeApplier.ts:73-75`.
**Consequences**: User's unsaved in-canvas edits are lost on AI apply (by design, matches Drawio, undo in-editor). If excalidraw's `updateScene` API can't fully replace a remount for some edge case (e.g. `files` binary blobs), fall back to remounting — but try updateScene first.

## Out of Scope

* Bumping `externalContentVersion` for non-codeMirror handlers — explicit non-goal (would remount and lose user state).
* Accept/reject UI for custom editors — ponytail deferral, see DrawioEditor.
* ExcalidrawPreview refresh — separate path; only verify it still works.

## Technical Notes

* `ExcalidrawEditor.tsx:1-63` — current impl.
* `DrawioEditor.tsx:18-46` — reference pattern.
* `fileChangeApplier.ts:60-79` — apply path for non-codeMirror.
* `WorkArea.tsx:326` — `key={tabId-externalContentVersion}` (version not bumped here).
* Excalidraw API: `excalidrawRef.current.updateScene({ elements, appState })` — see `@excalidraw/excalidraw` types.
