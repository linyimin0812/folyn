# Research: AI panel file-modification code paths (for .drawio live-refresh debugging)

- **Query**: Trace every code path the AI panel uses to modify a file's content, and which editorStore method each calls.
- **Scope**: internal
- **Date**: 2026-07-15

## Findings

### Origin: AI streams `file_change` events from the CLI

The AI panel does NOT write file content itself. The CLI backend writes to disk, then emits a `file_change` `CliStreamEvent`. Two event handlers consume it:

| File:Line | Handler | What it does |
|---|---|---|
| `apps/desktop/src/components/ai/AiPanel.tsx:302-304` | `case 'file_change'` → `addFileChange(event.fileChange, sid)` | UI chat panel path |
| `apps/desktop/src/services/featureAgentService.ts:376-377` | `case 'file_change'` → `ai.addFileChange(event.fileChange, sid)` | feature-agent path |

Both stream `done` handlers also call `useEditorStore.getState().checkDiskChanges()` then `resumeWatcher()` (AiPanel:315-317, featureAgentService:389-391). Watcher is paused during streaming (AiPanel:324, featureAgentService:398).

### `addFileChange` (the single entry point)

`apps/desktop/src/store/aiStore.ts:253-272`:
- Appends `FileChange` (status `pending`) to session.
- Calls `suppressWatcherFor(change.path)` (fileWatcher.ts:12) — disk writes for this path are ignored while suppressed.
- If a tab exists for the path AND `change.status === 'pending'` → calls `useEditorStore.getState().enterDiffReview(change.path, change.oldContent, change.newContent)` (line 270). **No `setContentExternal`, no `updateTabContent` here.** Just flips diff-review mode.

### `enterDiffReview` (editorStore.ts:238-245)

Sets `diffReviewMode: true`, `diffFilePath`, `diffOldContent`, `diffNewContent`. Does NOT touch `tabs[].content`, does NOT bump `externalContentVersion`. So no remount, no iframe reload.

### The "Accept Change" UI — only exists for CodeMirror editors

`apps/desktop/src/components/work-area/DiffReviewBar.tsx` is the only UI that renders Accept/Reject buttons. It is mounted exclusively inside `EditorPane` (`apps/desktop/src/components/work-area/EditorPane.tsx:173`), which is the CodeMirror branch.

`WorkArea.tsx:239-240`:
- `showCodeMirror = handler?.useCodeMirror && ...` → renders `EditorPane` (which mounts `DiffReviewBar`).
- `showCustomEditor = handler?.Editor && !handler.useCodeMirror && ...` → renders `<handler.Editor key={...} />` directly with **no `DiffReviewBar`**.

For `.drawio` (`apps/desktop/src/components/file-types/drawio/index.ts`: `useCodeMirror: false`, `Editor: DrawioEditor`), the editor takes the `showCustomEditor` branch. **No DiffReviewBar is ever rendered for drawio.** The user has no Accept button.

### `DiffReviewBar.handleAcceptAll` (the CodeMirror accept path) — DiffReviewBar.tsx:74-85

- Dispatches CodeMirror `acceptAllHunks` effect.
- Calls `updateTabContent(activeTab.id, diffNewContent)` — **`updateTabContent`, NOT `setContentExternal`.** No `externalContentVersion` bump. No remount. (CodeMirror is updated in place via `view.dispatch`.)
- Calls `exitDiffReview()`.

### `applyAcceptChange` / `applyRejectChange` (aiFileChangeActions.ts)

- `applyAcceptChange` (line 8-27): if tab exists → `useEditorStore.getState().setContentExternal(tabId, change.newContent)` (line 23). **This IS the version-bumping path.** Marks FileChange status `'accepted'`.
- `applyRejectChange` (line 29-55): writes `change.oldContent` to disk via `writeTextFile` (line 40), then `updateTabContent(tabId, change.oldContent)` (line 51). No version bump.

These are called from `aiStore.ts`:
- `acceptChange` (aiStore.ts:274-287) calls `applyAcceptChange`.
- `rejectChange` (aiStore.ts:289-300) calls `applyRejectChange`.
- `acceptAll` (aiStore.ts:302-309) loops `acceptChange`.
- `rejectAll` (aiStore.ts:311-318) loops `rejectChange`.

**Grep across `apps/desktop/src` shows NO UI button calls `acceptChange`/`rejectChange`/`acceptAll`/`rejectAll`** — only the store's own `acceptAll`/`rejectAll` (internal loops) and tests. The DiffReviewBar buttons call `handleAcceptAll`/`handleRejectAll` directly, which use `updateTabContent` and bypass `applyAcceptChange` entirely. So `applyAcceptChange`'s `setContentExternal` path is effectively dead for the diff-review flow.

### `checkDiskChanges` on stream `done` (editorStore.ts:611-638)

Runs after AI stream finishes. For each `needsFileContent` tab:
- Reads disk, compares to `tab.content`.
- If different AND `tab.id === activeTabId` → `enterDiffReview(...)` (line 627). **No content update, no version bump for the active tab.**
- If different AND not active → sets `tabs[].content = diskContent`, `isDirty: false`, bumps `externalContentVersion` (lines 629-634) → WorkArea remounts via key `${activeTab.id}-${externalContentVersion}` (WorkArea.tsx:301).

Early-return if `diffReviewMode` is already true (line 613).

### fileWatcher fallback (fileWatcher.ts:51-92)

Only relevant when watcher is running. For each modified path:
- Skips if `suppressedPaths.has(relativePath)` (line 71) — set by `suppressWatcherFor` in `addFileChange`.
- Skips if `tab.isDirty` (line 77).
- Otherwise reads disk and calls `setContentExternal` (line 87) → version bump → remount.

### RPC methods that modify file content (rpcBridge.ts)

| Line | Method | Mechanism |
|---|---|---|
| 349-362 | `fs:write` | `writeTextFile(abs, content)` — disk only, no editorStore touch. Relies on fileWatcher (skipped if suppressed or `tab.isDirty`). |
| 430-440 | `dialog:save` | `writeTextFile(filePath, content)` — disk only. |
| 454-466 | `vault:insert-content` | `store.updateTabContent(activeTab.id, activeTab.content + '\n' + content)` — **`updateTabContent`, no version bump.** |

No `setContentExternal` call anywhere in rpcBridge.

### WorkArea remount key (the live-refresh mechanism)

`apps/desktop/src/components/work-area/WorkArea.tsx:301`:
```
<handler.Editor
  key={`${activeTab.id}-${externalContentVersion}`}
  content={activeTab.content}
  ...
  onChange={(content) => updateTabContent(activeTab.id, content)}
/>
```
Only `externalContentVersion` bump remounts the custom Editor. `updateTabContent` does NOT bump it (editorStore.ts:227-236 — sets `tabs[].content` + `isDirty`, schedules autosave, nothing else).

### DrawioEditor's own iframe-refresh logic

`apps/desktop/src/components/file-types/drawio/DrawioEditor.tsx:27-35`: has a `content`-prop effect that calls `setLoadedXml(content)` when `content !== loadedXmlRef.current`. This is the ONLY path that reloads the iframe without a remount. It depends on the `content` prop actually changing in the parent's `activeTab.content`. `updateTabContent` does change `activeTab.content`, so in principle this effect should fire — but the parent uses `key={...externalContentVersion}` so when `setContentExternal` fires, the whole DrawioEditor remounts (fresh `useState(content)`), which is the more reliable reload path.

## Per-path summary table

| Path | editorStore method | Version bump? | Remount? | Applies to drawio? |
|---|---|---|---|---|
| `addFileChange` (file_change event) | `enterDiffReview` only | no | no | yes (enters diff mode, but no UI shown) |
| `DiffReviewBar.handleAcceptAll` (CodeMirror only) | `updateTabContent` | no | no | **no UI rendered** (DiffReviewBar is in EditorPane only) |
| `applyAcceptChange` (via `aiStore.acceptChange`/`acceptAll`) | `setContentExternal` | **yes** | **yes** | yes — but no UI calls `acceptChange` |
| `applyRejectChange` | `updateTabContent` + `writeTextFile` | no | no | yes — but no UI calls `rejectChange` |
| `checkDiskChanges` (on `done`), active tab | `enterDiffReview` | no | no | yes — for active drawio tab, this is the path hit, no reload |
| `checkDiskChanges` (on `done`), non-active tab | sets content + bumps version | **yes** | **yes** | yes — explains why closing/reopening shows new content (tab was non-active or reloaded on reopen) |
| fileWatcher (when not suppressed, not dirty) | `setContentExternal` | **yes** | **yes** | suppressed by `suppressWatcherFor` during AI stream |
| `rpcBridge vault:insert-content` | `updateTabContent` | no | no | yes (active tab) |
| `rpcBridge fs:write` / `dialog:save` | disk only | — | only via watcher | yes, but watcher is suppressed during AI stream |

## Related Specs

(None found under `.trellis/spec/` referencing these paths.)

## Caveats / Not Found

- No `.drawio`-specific branching anywhere in the AI/diff/RPC pipeline — all paths are generic by file type. The only drawio-specific code is the handler registration (`drawio/index.ts`) and `DrawioEditor.tsx` itself.
- `applyAcceptChange` (the version-bumping path) appears to have no live caller in the current UI — only `acceptAll`/`rejectAll` loops and tests. The DiffReviewBar Accept button bypasses it. This may be intentional or may be dead code; not for this researcher to judge.
- Did not trace `@folyn/cli-adapter` to confirm whether the CLI writes disk before or after emitting `file_change`; assumed disk is already written when the event arrives (matches user symptom: "closing/reopening shows new content").
